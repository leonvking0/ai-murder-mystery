import { getAuthedPlayerId } from '@/lib/room/auth';
import { getRoomScenario } from '@/lib/scenarios/registry';
import { projectRoomForPlayer } from '@/lib/scenarios/projection';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { phaseDeadlineFor, startGame } from '@/lib/game-engine/room-engine';
import { publish } from '@/lib/realtime/room-bus';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

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
      return Response.json({ error: '只有房主可以开始游戏' }, { status: 403 });
    }

    if (room.status !== 'lobby') {
      return Response.json({ error: '游戏已经开始' }, { status: 409 });
    }

    const updated = updateRoom(id, current => {
      if (current.status !== 'lobby' || current.hostPlayerId !== playerId) {
        return null;
      }
      // F4-d: stamp the READING phase's auto-advance deadline (undefined when auto-advance is off).
      const started = startGame(current, scenario);
      return { ...started, phaseDeadline: phaseDeadlineFor(started, scenario, Date.now()) };
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
