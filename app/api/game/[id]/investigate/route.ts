import { investigateLocation } from '@/lib/game-engine/clue-manager';
import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { getScenarioById, getSession, updateSession } from '@/lib/store/game-sessions';

interface InvestigateRequestBody {
  locationId?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: InvestigateRequestBody;

    try {
      body = (await req.json()) as InvestigateRequestBody;
    } catch {
      body = {};
    }

    const locationId = body.locationId?.trim();
    if (!locationId) {
      return Response.json({ error: 'locationId is required' }, { status: 400 });
    }

    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const scenario = getScenarioById(session.scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (!getPhaseConfig(session.currentPhase).allowsInvestigation) {
      return Response.json(
        { error: `Investigation is disabled during phase ${session.currentPhase}` },
        { status: 403 },
      );
    }

    try {
      const { nextSession, result } = investigateLocation(session, scenario, locationId);
      const saved = updateSession(id, nextSession);

      if (!saved) {
        return Response.json({ error: 'Failed to update session' }, { status: 500 });
      }

      return Response.json({
        session: saved,
        scenario,
        result,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Investigation failed' },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error('Investigate route failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
