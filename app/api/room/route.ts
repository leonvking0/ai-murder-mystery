import { withAuthCookie } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { createRoom } from '@/lib/store/rooms';

interface CreateRoomBody {
  scenarioId?: string;
  hostName?: string;
}

export async function POST(req: Request): Promise<Response> {
  try {
    let body: CreateRoomBody;
    try {
      body = (await req.json()) as CreateRoomBody;
    } catch {
      body = {};
    }

    const scenarioId = body.scenarioId?.trim() || 'storm-mansion';
    const scenario = getScenarioById(scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    const hostName = (body.hostName ?? '').slice(0, 40);
    const room = createRoom({ scenarioId, hostName });
    const host = room.players[0];

    // Seat the host: bind their playerId into a signed httpOnly per-room cookie. The response body no
    // longer needs to be trusted for auth — the cookie is the only credential the server verifies.
    return withAuthCookie(
      Response.json({ roomId: room.id, code: room.code, playerId: host.id }),
      room.id,
      host.id,
    );
  } catch (error) {
    console.error('Create room failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
