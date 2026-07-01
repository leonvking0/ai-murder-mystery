import { getScenarioById } from '@/lib/scenarios/registry';
import { projectRoomForPlayer } from '@/lib/scenarios/projection';
import { getRoom } from '@/lib/store/rooms';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function resolvePlayerId(req: Request): string {
  const url = new URL(req.url);
  return (url.searchParams.get('playerId') ?? req.headers.get('x-player-id') ?? '').trim();
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const playerId = resolvePlayerId(req);

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
      // Unknown playerId for this room → not a member.
      return Response.json({ error: 'Not a member of this room' }, { status: 403 });
    }

    return Response.json(view);
  } catch (error) {
    console.error('Room state failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
