import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { getScenarioById, getSession, updateSession } from '@/lib/store/game-sessions';
import type { VoteResponse } from '@/types/game';

interface VoteRequestBody {
  accusedCharacterId?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const PLAYER_VOTER_ID = 'player';
const DEFAULT_KILLER_ID = 'wang-daming';

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: VoteRequestBody;
    try {
      body = (await req.json()) as VoteRequestBody;
    } catch {
      body = {};
    }

    const accusedCharacterId = body.accusedCharacterId?.trim();
    if (!accusedCharacterId) {
      return Response.json({ error: 'accusedCharacterId is required' }, { status: 400 });
    }

    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const scenario = getScenarioById(session.scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (!getPhaseConfig(session.currentPhase).allowsVoting) {
      return Response.json(
        { error: `Voting is disabled during phase ${session.currentPhase}` },
        { status: 403 },
      );
    }

    if (session.votes[PLAYER_VOTER_ID]) {
      return Response.json({ error: 'Vote already submitted' }, { status: 409 });
    }

    const accusedCharacter = scenario.characters.find(character => character.id === accusedCharacterId);
    if (!accusedCharacter) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const killerId = scenario.characters.find(character => character.isKiller)?.id ?? DEFAULT_KILLER_ID;
    const isCorrect = accusedCharacterId === killerId;

    const nextSession = updateSession(id, current => ({
      ...current,
      votes: {
        ...current.votes,
        [PLAYER_VOTER_ID]: accusedCharacterId,
      },
    }));

    if (!nextSession) {
      return Response.json({ error: 'Failed to update session' }, { status: 500 });
    }

    const response: VoteResponse = {
      success: true,
      accusedId: accusedCharacterId,
      isCorrect,
    };

    return Response.json(response);
  } catch (error) {
    console.error('Vote route failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
