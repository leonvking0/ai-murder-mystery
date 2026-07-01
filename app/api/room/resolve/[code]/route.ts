import { getScenarioById } from '@/lib/scenarios/registry';
import { getRoomByCode } from '@/lib/store/rooms';

interface RouteContext {
  params: Promise<{ code: string }>;
}

// Public lookup so the /room/[code] join page can resolve a code → room id + basic info,
// before the visitor has joined (no secrets here).
export async function GET(_req: Request, context: RouteContext): Promise<Response> {
  try {
    const { code } = await context.params;
    const room = getRoomByCode(code);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getScenarioById(room.scenarioId);

    return Response.json({
      roomId: room.id,
      code: room.code,
      status: room.status,
      playerCount: room.players.length,
      scenarioTitle: scenario?.title ?? room.scenarioId,
    });
  } catch (error) {
    console.error('Resolve room failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
