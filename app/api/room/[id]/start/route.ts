import { getScenarioById } from '@/lib/scenarios/registry';
import { projectRoomForPlayer } from '@/lib/scenarios/projection';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { startGame } from '@/lib/game-engine/room-engine';
import { publish } from '@/lib/realtime/room-bus';

interface StartBody {
  playerId?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: StartBody;
    try {
      body = (await req.json()) as StartBody;
    } catch {
      body = {};
    }

    const playerId = body.playerId?.trim() ?? '';

    const room = getRoom(id);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getScenarioById(room.scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (room.hostPlayerId !== playerId) {
      return Response.json({ error: '只有房主可以开始游戏' }, { status: 403 });
    }

    if (room.status !== 'lobby') {
      return Response.json({ error: '游戏已经开始' }, { status: 409 });
    }

    const updated = updateRoom(id, current => {
      if (current.status !== 'lobby' || current.hostPlayerId !== playerId) {
        return null;
      }
      return startGame(current, scenario);
    });

    if (!updated || updated.status !== 'in_progress') {
      return Response.json({ error: '开始游戏失败' }, { status: 409 });
    }

    publish(id, { type: 'phase_change', phase: updated.currentPhase, round: updated.round });
    publish(id, { type: 'room_state' });

    return Response.json(projectRoomForPlayer(updated, scenario, playerId));
  } catch (error) {
    console.error('Start room failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
