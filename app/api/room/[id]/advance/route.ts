import { randomUUID } from 'node:crypto';

import { runNpcVoting } from '@/lib/agents/npc-voter';
import { PHASE_NARRATIONS } from '@/lib/game-engine/phase-manager';
import { getAuthedPlayerId } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { applyTieRevote, projectRoomForPlayer, tallyVotes } from '@/lib/scenarios/projection';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { advanceRoom, canAdvanceRoom } from '@/lib/game-engine/room-engine';
import { publish } from '@/lib/realtime/room-bus';
import type { ChatMessage, GamePhase } from '@/types/game';

interface AdvanceBody {
  // C2 / KI-049: if provided, the mutator refuses to advance unless the room is still on this phase —
  // a double-click or stale retry becomes a 409 no-op instead of skipping a phase.
  expectedPhase?: GamePhase;
  // C9 / KI-043: host-only override of the "all connected humans have voted" gate.
  force?: boolean;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: AdvanceBody;
    try {
      body = (await req.json()) as AdvanceBody;
    } catch {
      body = {};
    }
    const expectedPhase = body.expectedPhase;
    const force = body.force === true;

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

    // Everything below runs INSIDE the atomic mutator so the stale-phase guard, the vote gate, and the
    // tie-revote decision all see one consistent snapshot and persist together. Distinct failure reasons
    // are surfaced through the `failure` closure; the GM narration / revote message via their closures.
    let failure: { status: number; body: Record<string, unknown> } | null = null;
    let narration: ChatMessage | null = null;
    let revoteMessage: ChatMessage | null = null;
    let didRevote = false;

    const updated = updateRoom(id, current => {
      if (current.hostPlayerId !== playerId) {
        failure = { status: 403, body: { error: '只有房主可以推进阶段' } };
        return null;
      }

      // C2: idempotent stale-phase guard. A retry that raced another advance is a no-op, not a skip.
      if (expectedPhase && current.currentPhase !== expectedPhase) {
        failure = { status: 409, body: { error: '阶段已推进，请刷新', code: 'stale_phase' } };
        return null;
      }

      // C9: vote gate. In VOTING, distinguish "not everyone voted yet" (host can force) from a generic
      // "can't advance" so the UI can offer the force button.
      if (!canAdvanceRoom(current, { force })) {
        if (current.currentPhase === 'VOTING' && Object.keys(current.votes).length > 0 && !force) {
          failure = { status: 400, body: { error: '还有玩家未投票（房主可强制推进）', code: 'awaiting_votes' } };
        } else {
          failure = { status: 400, body: { error: `当前阶段无法推进：${current.currentPhase}` } };
        }
        return null;
      }

      // C9: tie → exactly one revote. When leaving VOTING with a tie and no revote spent yet, clear the
      // votes, mark the revote, post a GM prompt, and STAY in VOTING (do not advance to REVEAL).
      if (current.currentPhase === 'VOTING') {
        const { isTie } = tallyVotes(current, scenario);
        if (isTie && (current.voteRevoteCount ?? 0) < 1) {
          const revote = applyTieRevote(current);
          revoteMessage = revote.message;
          didRevote = true;
          return revote.room;
        }
      }

      // Normal advance: append the new phase's GM narration atomically with the phase change.
      const advanced = advanceRoom(current, { force });
      if (!advanced) {
        failure = { status: 400, body: { error: `当前阶段无法推进：${current.currentPhase}` } };
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

    if (failure) {
      const { status, body: errorBody } = failure;
      return Response.json(errorBody, { status });
    }
    if (!updated) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    // Tie-revote path: phase is unchanged (still VOTING). Broadcast the GM prompt + a state signal, then
    // re-run NPC voting so NPCs re-cast (their old votes were cleared) — same fire-and-forget pattern.
    if (didRevote && revoteMessage) {
      const gmMessage = revoteMessage;
      publish(id, { type: 'group_message', message: gmMessage });
      publish(id, { type: 'room_state' });
      void runNpcVoting(id, scenario).catch(error => console.error('NPC voting failed:', error));
      return Response.json(projectRoomForPlayer(updated, scenario, playerId));
    }

    if (!narration) {
      // Should be unreachable: a non-failing, non-revote mutation always set narration.
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
