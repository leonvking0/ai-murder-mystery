import { getAuthedPlayerId } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { projectRoomForPlayer } from '@/lib/scenarios/projection';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { advanceRoom, canAdvanceRoom } from '@/lib/game-engine/room-engine';
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

    const scenario = getScenarioById(room.scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (room.hostPlayerId !== playerId) {
      return Response.json({ error: '只有房主可以推进阶段' }, { status: 403 });
    }

    if (!canAdvanceRoom(room)) {
      return Response.json(
        { error: `当前阶段无法推进：${room.currentPhase}` },
        { status: 400 },
      );
    }

    const updated = updateRoom(id, current => {
      if (current.hostPlayerId !== playerId) {
        return null;
      }
      return advanceRoom(current);
    });

    if (!updated) {
      return Response.json({ error: '推进失败' }, { status: 409 });
    }

    publish(id, { type: 'phase_change', phase: updated.currentPhase, round: updated.round });
    publish(id, { type: 'room_state' });
    if (updated.currentPhase === 'REVEAL') {
      publish(id, { type: 'reveal' });
    }

    return Response.json(projectRoomForPlayer(updated, scenario, playerId));
  } catch (error) {
    console.error('Advance room failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
