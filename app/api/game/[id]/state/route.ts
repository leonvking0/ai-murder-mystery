import { getScenarioById, getSession } from '@/lib/store/game-sessions';
import type { GameStateResponse } from '@/types/game';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext): Promise<Response> {
  try {
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
  } catch (error) {
    console.error('Get state route failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
