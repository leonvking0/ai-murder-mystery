import { randomUUID } from 'node:crypto';

import { runNpcVoting } from '@/lib/agents/npc-voter';
import { PHASE_NARRATIONS } from '@/lib/game-engine/phase-manager';
import { getAuthedPlayerId } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { projectRoomForPlayer } from '@/lib/scenarios/projection';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { advanceRoom, canAdvanceRoom } from '@/lib/game-engine/room-engine';
import { publish } from '@/lib/realtime/room-bus';
import type { ChatMessage } from '@/types/game';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    const playerId = getAuthedPlayerId(req, id);
    if (!playerId) {
      return Response.json({ error: 'Not authenticated for this room' }, { status: 403 });
    }

    const room = getRoom(id);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getScenarioById(room.scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (room.hostPlayerId !== playerId) {
      return Response.json({ error: '只有房主可以推进阶段' }, { status: 403 });
    }

    if (!canAdvanceRoom(room)) {
      return Response.json(
        { error: `当前阶段无法推进：${room.currentPhase}` },
        { status: 400 },
      );
    }

    // Append the GM narration for the new phase INSIDE the mutator so it persists atomically with the
    // phase change. Captured via closure to broadcast the exact same message (id) to live clients.
    let narration: ChatMessage | null = null;
    const updated = updateRoom(id, current => {
      if (current.hostPlayerId !== playerId) {
        return null;
      }
      const advanced = advanceRoom(current);
      if (!advanced) {
        return null;
      }
      const message: ChatMessage = {
        id: randomUUID(),
        role: 'system',
        content: PHASE_NARRATIONS[advanced.currentPhase] ?? '',
        timestamp: Date.now(),
      };
      narration = message;
      return { ...advanced, groupChatHistory: [...advanced.groupChatHistory, message] };
    });

    if (!updated || !narration) {
      return Response.json({ error: '推进失败' }, { status: 409 });
    }
    // Capture into a const: `narration` is closure-assigned, so its narrowing would widen back across
    // the publish() calls below.
    const narrationMessage = narration;

    publish(id, { type: 'phase_change', phase: updated.currentPhase, round: updated.round });
    // GM narration on every phase change (same event the group-chat route uses for system messages).
    publish(id, { type: 'group_message', message: narrationMessage });
    publish(id, { type: 'room_state' });
    if (updated.currentPhase === 'REVEAL') {
      publish(id, { type: 'reveal' });
    }

    // On entering VOTING, have every NPC cast a vote (+ post a one-line reason). Fire-and-forget on
    // this long-running Node server: the rule-based fallback resolves without any network, so votes
    // land even with no LLM configured; NPC votes let the host advance VOTING → REVEAL.
    if (updated.currentPhase === 'VOTING') {
      void runNpcVoting(id, scenario).catch(error => console.error('NPC voting failed:', error));
    }

    return Response.json(projectRoomForPlayer(updated, scenario, playerId));
  } catch (error) {
    console.error('Advance room failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
