import { getAuthedPlayerId } from '@/lib/room/auth';
import { getRoom } from '@/lib/store/rooms';
import { subscribe } from '@/lib/realtime/room-bus';
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

      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
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
