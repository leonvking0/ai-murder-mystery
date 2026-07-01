import { getAuthedPlayerId } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { projectRoomForPlayer } from '@/lib/scenarios/projection';
import { getRoom } from '@/lib/store/rooms';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    // Auth comes ONLY from the signed cookie — never a ?playerId= query (KI-034/KI-061). This is what
    // guarantees the projection is built for the caller and can't be pointed at another player's seat.
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

    const view = projectRoomForPlayer(room, scenario, playerId);
    if (!view) {
      // Cookie is valid but the id is no longer a member of this room.
      return Response.json({ error: 'Not a member of this room' }, { status: 403 });
    }

    return Response.json(view);
  } catch (error) {
    console.error('Room state failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
