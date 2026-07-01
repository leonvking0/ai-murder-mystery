import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { investigateRoom, type RoomInvestigationResult } from '@/lib/game-engine/room-investigation';
import { getAuthedPlayerId } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { toClueView } from '@/lib/scenarios/projection';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { publish } from '@/lib/realtime/room-bus';
import type { ChatMessage } from '@/types/game';

interface InvestigateBody {
  locationId?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: InvestigateBody;
    try {
      body = (await req.json()) as InvestigateBody;
    } catch {
      body = {};
    }

    const playerId = getAuthedPlayerId(req, id);
    if (!playerId) {
      return Response.json({ error: 'Not authenticated for this room' }, { status: 403 });
    }
    const locationId = body.locationId?.trim() ?? '';

    const room = getRoom(id);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getScenarioById(room.scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (!room.players.some(item => item.id === playerId)) {
      return Response.json({ error: 'Not a member of this room' }, { status: 403 });
    }

    if (!getPhaseConfig(room.currentPhase).allowsInvestigation) {
      return Response.json({ error: `当前阶段不能搜证：${room.currentPhase}` }, { status: 403 });
    }

    let result: RoomInvestigationResult | null = null;
    let systemMessages: ChatMessage[] = [];

    try {
      updateRoom(id, current => {
        const outcome = investigateRoom(current, scenario, playerId, locationId);
        result = outcome.result;
        systemMessages = outcome.systemMessages;
        return outcome.room;
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Investigation failed' },
        { status: 400 },
      );
    }

    if (!result) {
      return Response.json({ error: 'Investigation failed' }, { status: 500 });
    }

    // Broadcast public-clue system messages + a state signal so everyone's notebook updates.
    for (const systemMessage of systemMessages) {
      publish(id, { type: 'clue_public', message: systemMessage });
    }
    if (systemMessages.length > 0) {
      publish(id, { type: 'room_state' });
    }

    const safeResult = result as RoomInvestigationResult;
    return Response.json({
      result: {
        locationName: safeResult.locationName,
        round: safeResult.round,
        newlyFound: safeResult.newlyFound.map(toClueView),
      },
    });
  } catch (error) {
    console.error('Room investigate failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
