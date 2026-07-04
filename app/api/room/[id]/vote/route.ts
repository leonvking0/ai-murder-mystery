import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { getAuthedPlayerId } from '@/lib/room/auth';
import { getRoomScenario } from '@/lib/scenarios/registry';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { publish } from '@/lib/realtime/room-bus';

interface VoteBody {
  accusedCharacterId?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: VoteBody;
    try {
      body = (await req.json()) as VoteBody;
    } catch {
      body = {};
    }

    const playerId = getAuthedPlayerId(req, id);
    if (!playerId) {
      return Response.json({ error: 'Not authenticated for this room' }, { status: 403 });
    }
    const accusedCharacterId = body.accusedCharacterId?.trim() ?? '';

    const room = getRoom(id);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getRoomScenario(room);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (!room.players.some(item => item.id === playerId)) {
      return Response.json({ error: 'Not a member of this room' }, { status: 403 });
    }

    if (!getPhaseConfig(room.currentPhase).allowsVoting) {
      return Response.json({ error: `当前阶段不能投票：${room.currentPhase}` }, { status: 403 });
    }

    if (!scenario.characters.some(character => character.id === accusedCharacterId)) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // One vote per player; changeable until the host advances to REVEAL.
    const updated = updateRoom(id, current => ({
      ...current,
      votes: { ...current.votes, [playerId]: accusedCharacterId },
    }));

    if (!updated) {
      return Response.json({ error: 'Vote failed' }, { status: 500 });
    }

    const voteCount = Object.keys(updated.votes).length;
    publish(id, { type: 'vote_update', voteCount });

    return Response.json({ ok: true, voteCount, youVotedFor: accusedCharacterId });
  } catch (error) {
    console.error('Room vote failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
