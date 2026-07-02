import { getAuthedPlayerId } from '@/lib/room/auth';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { markConnected, markDisconnected, publish, subscribe } from '@/lib/realtime/room-bus';
import { encodeSSE, encodeSSEComment, sseHeaders } from '@/lib/realtime/sse';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string }>;
}

// SSE stream of public room events. The client refetches the projected /state on signal events
// (room_state / phase_change / reveal) and applies group_message / npc_* directly.
export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  const room = getRoom(id);
  if (!room) {
    return Response.json({ error: 'Room not found' }, { status: 404 });
  }

  // KI-038: the stream carries live group chat / clues, so only verified members may subscribe.
  // EventSource sends same-origin cookies automatically, so no client header work is needed.
  const playerId = getAuthedPlayerId(req, id);
  if (!playerId || !room.players.some(player => player.id === playerId)) {
    return Response.json({ error: 'Not a member of this room' }, { status: 403 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(chunk);
        } catch {
          // controller already closed
        }
      };

      // Tell the client to pull the current projected state immediately.
      safeEnqueue(encodeSSE({ type: 'room_state' }));

      const unsubscribe = subscribe(id, event => safeEnqueue(encodeSSE(event)));

      const heartbeat = setInterval(() => safeEnqueue(encodeSSEComment('ping')), 25000);

      // D2 presence: refcount this player's live streams. Only the 0→1 transition flips them online, so
      // a second tab / reconnect overlap never falsely toggles presence. If this returning human's seat
      // had been taken over by an NPC, RECLAIM it here.
      const { firstConnection } = markConnected(id, playerId);
      if (firstConnection) {
        const now = Date.now();
        let reclaimedCharacterId: string | null = null;
        const updated = updateRoom(id, current => {
          const players = current.players.map(player =>
            player.id === playerId
              ? { ...player, connected: true, disconnectedAt: undefined, lastSeenAt: now }
              : player,
          );
          const characterControl = { ...current.characterControl };
          for (const [characterId, control] of Object.entries(characterControl)) {
            if (control.kind === 'npc' && control.takenOverFromPlayerId === playerId) {
              characterControl[characterId] = { kind: 'human', playerId };
              reclaimedCharacterId = characterId;
            }
          }
          return { ...current, players, characterControl };
        });
        const self = updated?.players.find(player => player.id === playerId);
        if (self) {
          publish(id, { type: 'presence', publicId: self.publicId, connected: true });
          // Only publicId leaves the server — never the real playerId.
          if (reclaimedCharacterId) {
            publish(id, { type: 'seat_takeover', characterId: reclaimedCharacterId, publicId: self.publicId });
            publish(id, { type: 'room_state' });
          }
        }
      }

      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();

        // D2 presence: only the LAST stream closing marks the player offline (multi-tab safe).
        const { lastConnection } = markDisconnected(id, playerId);
        if (lastConnection) {
          const now = Date.now();
          const updated = updateRoom(id, current => ({
            ...current,
            players: current.players.map(player =>
              player.id === playerId
                ? { ...player, connected: false, disconnectedAt: now, lastSeenAt: now }
                : player,
            ),
          }));
          const self = updated?.players.find(player => player.id === playerId);
          if (self) {
            publish(id, { type: 'presence', publicId: self.publicId, connected: false });
          }
        }

        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
