import { getAuthedPlayerId } from '@/lib/room/auth';
import { getRoomScenario } from '@/lib/scenarios/registry';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { publish } from '@/lib/realtime/room-bus';

// Host-only removal of a lobby player (KI-041). Lets the host clear a ghost/flood seat before the
// game starts so it can't brick the round. Target is addressed by the non-secret `publicId` (the
// client never sees another player's real auth id). Only permitted pre-start (status === 'lobby').
interface KickBody {
  publicId?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: KickBody;
    try {
      body = (await req.json()) as KickBody;
    } catch {
      body = {};
    }

    const targetPublicId = body.publicId?.trim() ?? '';

    const playerId = getAuthedPlayerId(req, id);
    if (!playerId) {
      return Response.json({ error: 'Not authenticated for this room' }, { status: 403 });
    }

    const room = getRoom(id);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getRoomScenario(room);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (room.hostPlayerId !== playerId) {
      return Response.json({ error: '只有房主可以移除玩家' }, { status: 403 });
    }

    if (room.status !== 'lobby') {
      return Response.json({ error: '游戏已开始，无法移除玩家' }, { status: 409 });
    }

    const target = room.players.find(player => player.publicId === targetPublicId);
    if (!target) {
      return Response.json({ error: '找不到该玩家' }, { status: 404 });
    }
    if (target.id === room.hostPlayerId) {
      return Response.json({ error: '不能移除房主' }, { status: 400 });
    }

    const updated = updateRoom(id, current => {
      if (current.status !== 'lobby') {
        return null;
      }
      return {
        ...current,
        players: current.players.filter(player => player.publicId !== targetPublicId),
      };
    });

    if (!updated) {
      return Response.json({ error: '移除失败' }, { status: 409 });
    }

    publish(id, { type: 'room_state' });

    return Response.json({ ok: true });
  } catch (error) {
    console.error('Kick player failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
