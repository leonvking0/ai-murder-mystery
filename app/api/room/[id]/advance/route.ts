import { randomUUID } from 'node:crypto';

import { runNpcVoting } from '@/lib/agents/npc-voter';
import { narrationForPhase } from '@/lib/game-engine/phase-manager';
import { getAuthedPlayerId } from '@/lib/room/auth';
import { getRoomScenario } from '@/lib/scenarios/registry';
import { applyTieRevote, projectRoomForPlayer, tallyVotes } from '@/lib/scenarios/projection';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { advanceRoom, canAdvanceRoom, phaseDeadlineFor } from '@/lib/game-engine/room-engine';
import { publish } from '@/lib/realtime/room-bus';
import type { ChatMessage, GamePhase } from '@/types/game';

interface AdvanceBody {
  // C2 / KI-049: if provided, the mutator refuses to advance unless the room is still on this phase —
  // a double-click or stale retry becomes a 409 no-op instead of skipping a phase.
  expectedPhase?: GamePhase;
  // C9 / KI-043: host-only override of the "all connected humans have voted" gate.
  force?: boolean;
  // F4-d: deadline-based auto-advance. When true, ANY room member may advance — but only once the
  // persisted `phaseDeadline` has passed — and the VOTING gate is treated as forced (async play never
  // stalls on an absent human). When absent/false, behavior is the host-only manual path, unchanged.
  auto?: boolean;
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
    const auto = body.auto === true;
    // F4-d: an auto-advance implies force semantics for the VOTING gate (never stall on an absent human).
    // Manual path: `auto` is false, so `effectiveForce === force` — byte-for-byte unchanged.
    const force = body.force === true;
    const effectiveForce = force || auto;

    const playerId = getAuthedPlayerId(req, id);
    if (!playerId) {
      return Response.json({ error: 'Not authenticated for this room' }, { status: 403 });
    }

    const room = getRoom(id);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getRoomScenario(room);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    // Manual advance is host-only. Auto-advance is open to any member (re-validated in the mutator:
    // membership + deadline). The signed seat cookie already proves room membership via getAuthedPlayerId.
    if (!auto && room.hostPlayerId !== playerId) {
      return Response.json({ error: '只有房主可以推进阶段' }, { status: 403 });
    }

    // Everything below runs INSIDE the atomic mutator so the stale-phase guard, the vote gate, and the
    // tie-revote decision all see one consistent snapshot and persist together. Distinct failure reasons
    // are surfaced through the `failure` closure; the GM narration / revote message via their closures.
    let failure: { status: number; body: Record<string, unknown> } | null = null;
    let narration: ChatMessage | null = null;
    let revoteMessage: ChatMessage | null = null;
    let didRevote = false;

    const now = Date.now();
    const updated = updateRoom(id, current => {
      if (auto) {
        // F4-d auto-advance authorization: any room member may fire it, but ONLY once the persisted
        // deadline has genuinely passed. Belt-and-suspenders membership check (the cookie already proves
        // it). Multiple clients firing the timer collapse to a no-op via this + the C2 guard below.
        if (!current.players.some(player => player.id === playerId)) {
          failure = { status: 403, body: { error: '不是房间成员' } };
          return null;
        }
        if (current.autoAdvance !== true || current.phaseDeadline === undefined || now < current.phaseDeadline) {
          failure = { status: 409, body: { error: '未到自动推进时间', code: 'deadline_not_reached' } };
          return null;
        }
      } else if (current.hostPlayerId !== playerId) {
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
      if (!canAdvanceRoom(current, { force: effectiveForce })) {
        if (current.currentPhase === 'VOTING' && Object.keys(current.votes).length > 0 && !effectiveForce) {
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
          // F4-d: a revote stays in VOTING but gets a FRESH deadline so the clock restarts.
          return { ...revote.room, phaseDeadline: phaseDeadlineFor(revote.room, scenario, now) };
        }
      }

      // Normal advance: append the new phase's GM narration atomically with the phase change.
      const advanced = advanceRoom(current, { force: effectiveForce });
      if (!advanced) {
        failure = { status: 400, body: { error: `当前阶段无法推进：${current.currentPhase}` } };
        return null;
      }
      const message: ChatMessage = {
        id: randomUUID(),
        role: 'system',
        content: narrationForPhase(advanced.currentPhase, scenario),
        timestamp: Date.now(),
      };
      narration = message;
      // F4-d: stamp the new phase's deadline (undefined when auto-advance off or entering REVEAL).
      return {
        ...advanced,
        groupChatHistory: [...advanced.groupChatHistory, message],
        phaseDeadline: phaseDeadlineFor(advanced, scenario, now),
      };
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
