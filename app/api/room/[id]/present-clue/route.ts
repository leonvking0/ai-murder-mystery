import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { presentClue } from '@/lib/game-engine/room-investigation';
import { getAuthedPlayerId } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { projectRoomForPlayer } from '@/lib/scenarios/projection';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { publish } from '@/lib/realtime/room-bus';
import type { ChatMessage } from '@/types/game';

interface PresentClueBody {
  clueId?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: PresentClueBody;
    try {
      body = (await req.json()) as PresentClueBody;
    } catch {
      body = {};
    }

    const playerId = getAuthedPlayerId(req, id);
    if (!playerId) {
      return Response.json({ error: 'Not authenticated for this room' }, { status: 403 });
    }
    const clueId = body.clueId?.trim() ?? '';
    if (!clueId) {
      return Response.json({ error: 'clueId is required' }, { status: 400 });
    }

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

    // Presenting a clue is a discussion act — gate it exactly like group chat.
    if (!getPhaseConfig(room.currentPhase).allowsChat) {
      return Response.json({ error: `当前阶段不能出示线索：${room.currentPhase}` }, { status: 403 });
    }

    let systemMessages: ChatMessage[] = [];
    try {
      updateRoom(id, current => {
        const outcome = presentClue(current, scenario, playerId, clueId);
        systemMessages = outcome.systemMessages;
        return outcome.room;
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Present clue failed' },
        { status: 400 },
      );
    }

    // Broadcast the "clue presented" system message + a state signal so notebooks/facts refresh.
    for (const systemMessage of systemMessages) {
      publish(id, { type: 'group_message', message: systemMessage });
    }
    if (systemMessages.length > 0) {
      publish(id, { type: 'room_state' });
    }

    const updated = getRoom(id);
    const projection = updated ? projectRoomForPlayer(updated, scenario, playerId) : null;
    return Response.json({ view: projection });
  } catch (error) {
    console.error('Room present-clue failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
