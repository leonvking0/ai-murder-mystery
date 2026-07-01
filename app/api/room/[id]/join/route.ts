import { getScenarioById } from '@/lib/scenarios/registry';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { addPlayer, maxHumanPlayers } from '@/lib/game-engine/room-engine';
import { publish } from '@/lib/realtime/room-bus';

interface JoinBody {
  name?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: JoinBody;
    try {
      body = (await req.json()) as JoinBody;
    } catch {
      body = {};
    }

    const room = getRoom(id);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getScenarioById(room.scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (room.status !== 'lobby') {
      return Response.json({ error: '游戏已开始，无法加入' }, { status: 409 });
    }

    if (room.players.length >= maxHumanPlayers(scenario)) {
      return Response.json({ error: '房间已满' }, { status: 409 });
    }

    const name = (body.name ?? '').slice(0, 40);
    let newPlayerId = '';

    const updated = updateRoom(id, current => {
      if (current.status !== 'lobby' || current.players.length >= maxHumanPlayers(scenario)) {
        return null;
      }
      const { room: next, player } = addPlayer(current, name);
      newPlayerId = player.id;
      return next;
    });

    if (!updated || !newPlayerId) {
      return Response.json({ error: '加入失败，房间可能已满或已开始' }, { status: 409 });
    }

    publish(id, { type: 'room_state' });

    return Response.json({ roomId: id, code: updated.code, playerId: newPlayerId });
  } catch (error) {
    console.error('Join room failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
