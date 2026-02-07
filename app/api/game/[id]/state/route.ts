import { getScenarioById, getSession } from '@/lib/store/game-sessions';
import type { GameStateResponse } from '@/types/game';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  const session = getSession(id);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const scenario = getScenarioById(session.scenarioId);
  if (!scenario) {
    return Response.json({ error: 'Scenario not found' }, { status: 404 });
  }

  const response: GameStateResponse = {
    session,
    scenario,
  };

  return Response.json(response);
}
