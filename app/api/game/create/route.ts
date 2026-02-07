import { createSession, getScenarioById } from '@/lib/store/game-sessions';
import type { CreateGameRequest, CreateGameResponse } from '@/types/game';

export async function POST(req: Request): Promise<Response> {
  let body: Partial<CreateGameRequest>;

  try {
    body = (await req.json()) as Partial<CreateGameRequest>;
  } catch {
    body = {};
  }

  const scenarioId = body.scenarioId ?? 'storm-mansion';
  const scenario = getScenarioById(scenarioId);

  if (!scenario) {
    return Response.json({ error: 'Scenario not found' }, { status: 404 });
  }

  const session = createSession(scenarioId);

  const response: CreateGameResponse = {
    sessionId: session.id,
    scenario,
  };

  return Response.json(response);
}
