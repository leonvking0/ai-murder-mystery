import {
  canAdvance,
  getNextPhase,
  getPhaseConfig,
  PHASE_NARRATIONS,
} from '@/lib/game-engine/phase-manager';
import { getScenarioById, getSession, updateSession } from '@/lib/store/game-sessions';
import type { GamePhase, GameStateResponse } from '@/types/game';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function getRoundForPhase(phase: GamePhase, currentRound: number): number {
  if (phase === 'DISCUSSION_1' || phase === 'INVESTIGATION_1') {
    return 1;
  }

  if (phase === 'DISCUSSION_2' || phase === 'INVESTIGATION_2') {
    return 2;
  }

  if (phase === 'FINAL_DISCUSSION') {
    return 3;
  }

  return currentRound;
}

export async function POST(_req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  const session = getSession(id);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const scenario = getScenarioById(session.scenarioId);
  if (!scenario) {
    return Response.json({ error: 'Scenario not found' }, { status: 404 });
  }

  if (!canAdvance(session)) {
    return Response.json(
      { error: `Cannot advance from phase ${session.currentPhase}` },
      { status: 400 },
    );
  }

  const nextPhase = getNextPhase(session.currentPhase);
  if (!nextPhase) {
    return Response.json({ error: 'No next phase available' }, { status: 400 });
  }

  const nextSession = updateSession(id, current => ({
    ...current,
    currentPhase: nextPhase,
    round: getRoundForPhase(nextPhase, current.round),
  }));

  if (!nextSession) {
    return Response.json({ error: 'Failed to update session' }, { status: 500 });
  }

  const response: GameStateResponse & {
    transition: {
      from: GamePhase;
      to: GamePhase;
      narration: string;
      phaseConfig: ReturnType<typeof getPhaseConfig>;
    };
  } = {
    session: nextSession,
    scenario,
    transition: {
      from: session.currentPhase,
      to: nextPhase,
      narration: PHASE_NARRATIONS[nextPhase],
      phaseConfig: getPhaseConfig(nextPhase),
    },
  };

  return Response.json(response);
}
