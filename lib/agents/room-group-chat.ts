// Room-scoped group discussion: only NPC-controlled characters respond via the LLM. Human-controlled
// characters are driven by their players (their messages arrive through the group-chat route).
//
// Import discipline (mirrors lib/agents/npc-voter.ts): every runtime *value* import is a relative
// `.ts` path or a bare package, and npc-agent is loaded LAZILY (only when a turn actually streams), so
// this module — and its exported generator — stay loadable under `node --experimental-strip-types`
// for the offline tests. npc-agent statically imports the scenario registry (`@/data/*.json`), which
// the strip-types loader cannot resolve; deferring it keeps the not-configured / gate / throttle /
// injected-deps paths fully offline.

import { randomUUID } from 'node:crypto';

import { isLLMConfigured } from './llm-provider.ts';
import { tryReserveNpcTrigger } from './npc-voter.ts';
import { getPhaseConfig } from '../game-engine/phase-manager.ts';
import { toScenarioPublic } from '../scenarios/projection.ts';
import type { StreamNPCGroupResponseParams } from './npc-agent.ts';
import type { Character, Room, Scenario } from '@/types/game';

// Inlined from room-engine.npcCharacterIds so this module carries no `@/`-value import (room-engine
// pulls those in) and stays strip-types-loadable — same rationale as the inline in npc-voter.ts.
function npcCharacterIds(room: Room): string[] {
  return Object.entries(room.characterControl)
    .filter(([, control]) => control.kind === 'npc')
    .map(([characterId]) => characterId);
}

// D3(b): hard cap on how many NPCs may speak in a single group-chat turn — the initial pick (1-3
// from pickResponders) plus any cross-talk pull-ins. Pinned; it also bounds the pull-in loop so a
// room where every NPC names every other can never run away or loop forever.
export const MAX_RESPONDERS_PER_TURN = 4;

// One event per step of a group-chat turn. The route maps these onto public SSE `npc_*` events,
// owning `turnId`, the per-room lock, and persistence (it builds the ChatMessage with `id = messageId`
// on `done`). `messageId` is stable across a responder's start→chunk(s)→done.
export type NpcTurnEvent =
  | { kind: 'start'; characterId: string; messageId: string }
  | { kind: 'chunk'; characterId: string; messageId: string; text: string }
  | { kind: 'done'; characterId: string; messageId: string; content: string }
  | { kind: 'error'; characterId: string; messageId: string; reason: 'not_configured' | 'failed' };

// Injection seam for offline tests: the default wires the real config check + group-response stream.
// Production callers pass no deps (the exported 3-arg signature is unchanged); tests pass a fake
// `streamResponse` (and/or `isConfigured`) to exercise the success/failure paths without a live LLM.
export interface GroupResponseDeps {
  isConfigured: () => boolean;
  streamResponse: (params: StreamNPCGroupResponseParams) => AsyncIterable<string>;
}

function buildGroupContext(room: Room, scenario: Scenario): string {
  const characterName = new Map(scenario.characters.map(character => [character.id, character.name]));
  const playerName = new Map(room.players.map(player => [player.id, player.name]));

  return room.groupChatHistory
    .slice(-24)
    .map(message => {
      if (message.role === 'system') {
        return `【线索】${message.content}`;
      }
      if (message.role === 'npc' && message.characterId) {
        return `${characterName.get(message.characterId) ?? message.characterId}: ${message.content}`;
      }
      if (message.role === 'player') {
        // A human speaking as their assigned character (fall back to player name).
        const speaker = message.characterId
          ? characterName.get(message.characterId) ?? '玩家'
          : (message.playerId && playerName.get(message.playerId)) || '玩家';
        return `${speaker}: ${message.content}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

// NPCs a human named directly in the trigger text — by character name or id. Mentioned NPCs bypass
// the per-room cooldown (a pointed question deserves an answer) and are prioritized as responders.
function mentionedNpcIds(scenario: Scenario, room: Room, triggerText: string): string[] {
  const normalized = triggerText.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const nameById = new Map(scenario.characters.map(character => [character.id, character.name]));
  return npcCharacterIds(room).filter(id => {
    const name = nameById.get(id)?.toLowerCase() ?? '';
    return (name && normalized.includes(name)) || normalized.includes(id.toLowerCase());
  });
}

function pickResponders(scenario: Scenario, room: Room, mentioned: string[]): string[] {
  const npcIds = npcCharacterIds(room);
  if (npcIds.length === 0) {
    return [];
  }

  // Order remaining NPCs by who has spoken least recently.
  const recent = room.groupChatHistory
    .filter(message => message.role === 'npc' && message.characterId)
    .slice(-12);
  const speakCount = new Map<string, number>();
  for (const message of recent) {
    if (message.characterId) {
      speakCount.set(message.characterId, (speakCount.get(message.characterId) ?? 0) + 1);
    }
  }
  const quietest = [...npcIds].sort((a, b) => (speakCount.get(a) ?? 0) - (speakCount.get(b) ?? 0));

  const ordered = [...mentioned, ...quietest].filter((id, index, list) => list.indexOf(id) === index);

  // 1-3 responders: prioritize mentioned, otherwise a couple of the quietest.
  const limit = mentioned.length > 0 ? Math.min(3, ordered.length) : Math.min(2, ordered.length);
  return ordered.slice(0, Math.max(1, limit));
}

export async function* manageRoomGroupResponse(
  room: Room,
  scenario: Scenario,
  triggerText: string,
  deps?: GroupResponseDeps,
): AsyncIterable<NpcTurnEvent> {
  // Unified chat gate: NPCs speak in exactly the phases that allow chat (INTRO + discussions). This is
  // the single source of truth — the group-chat route enforces the same gate before calling us.
  if (!getPhaseConfig(room.currentPhase).allowsChat) {
    return;
  }

  if (npcCharacterIds(room).length === 0) {
    return;
  }

  const mentioned = mentionedNpcIds(scenario, room, triggerText);

  // Throttle BEFORE any LLM work: a mention bypasses the cooldown; everything obeys the token bucket.
  // When throttled we intentionally yield nothing — not every human line should drag an NPC in.
  if (!tryReserveNpcTrigger(room.id, mentioned.length > 0)) {
    return;
  }

  // `responders` is intentionally MUTABLE: D3(b) cross-talk appends any NPC a responder names during
  // its own turn (see the pull-in below). `scheduled` guards against double-adds — including against
  // the initial pick — so a named-but-already-queued NPC never gets a second start/done. Throttling is
  // NOT re-checked here: the route already reserved one token for this POST, and cross-talk pull-ins
  // are "always allowed but capped" by MAX_RESPONDERS_PER_TURN.
  const responders = pickResponders(scenario, room, mentioned);
  if (responders.length === 0) {
    return;
  }
  const scheduled = new Set<string>(responders);
  const npcIds = new Set<string>(npcCharacterIds(room));

  // C6: not-configured is a SINGLE terminal event for the whole turn — no per-NPC `start`, no persist,
  // no degraded canned line. Attribute it to the first responder so the client can address the event.
  const isConfigured = deps?.isConfigured ?? isLLMConfigured;
  if (!isConfigured()) {
    yield { kind: 'error', characterId: responders[0], messageId: randomUUID(), reason: 'not_configured' };
    return;
  }

  // Resolve the streaming impl. Lazy import (see the import-discipline note above) keeps every path
  // above this line — including not-configured — loadable under strip-types.
  const streamResponse =
    deps?.streamResponse ?? (await import('./npc-agent.ts')).streamNPCGroupResponse;

  // Base context from the STORED history (persistence happens in the route AFTER each `done`, so it
  // does not yet contain this turn's replies). Computed once; the per-responder context is this base
  // plus the in-turn lines accumulated below.
  const baseGroupContext = buildGroupContext(room, scenario);
  const characterNameById = new Map(scenario.characters.map(character => [character.id, character.name]));
  // C10 (KI-011/021): responders speak sequentially within a single turn. Without this, the 2nd/3rd
  // NPC could not see what earlier responders just said (that text is not persisted until the route
  // handles their `done`). Accumulate each responder's final line in-memory and append it — labeled by
  // speaker — to the context handed to subsequent responders. No store round-trip.
  const inTurnLines: string[] = [];
  // Pass the RAW player text through — npc-agent wraps it in <玩家发言> delimiters (or falls back
  // to a self-prompt when empty). Never prefix/format player text here.
  const scenarioPublic = toScenarioPublic(scenario);

  // Index/while walk over the mutable `responders` array: `responders.length` is re-read each
  // iteration, so any id appended by the cross-talk pull-in below is processed later in this same turn.
  for (let index = 0; index < responders.length; index += 1) {
    const characterId = responders[index];
    const character: Character | undefined = scenario.characters.find(item => item.id === characterId);
    const memory = room.characterMemories[characterId];
    if (!character || !memory) {
      continue;
    }

    // One id per responder, stable across start→chunk(s)→done, reused as the persisted ChatMessage.id.
    const messageId = randomUUID();
    const knownClues = [
      ...memory.discoveredClues.map(clue => clue.content),
      ...memory.knownFacts,
    ];

    // Context for THIS responder: the stored base plus any lines earlier responders produced this turn.
    const groupContext = [baseGroupContext, ...inTurnLines].filter(Boolean).join('\n');

    yield { kind: 'start', characterId, messageId };

    let content = '';
    try {
      const stream = streamResponse({
        character,
        allCharacters: scenario.characters,
        memory,
        gameState: {
          phase: room.currentPhase,
          knownClues,
          emotionalState: memory.emotionalState,
        },
        groupContext,
        playerMessage: triggerText,
        scenarioPublic,
      });

      for await (const chunk of stream) {
        if (chunk) {
          content += chunk;
          yield { kind: 'chunk', characterId, messageId, text: chunk };
        }
      }
    } catch (error) {
      // C6: a mid-generation failure is this responder's terminal event. Never persist a partial
      // message; continue to the next responder.
      console.error(`NPC group stream failed for ${characterId}:`, error);
      yield { kind: 'error', characterId, messageId, reason: 'failed' };
      continue;
    }

    // Feed this responder's line to subsequent responders in the same turn (C10). Only non-empty
    // content is carried forward — matches the route, which persists non-empty turns only.
    const finalText = content.trim();
    if (finalText) {
      inTurnLines.push(`${characterNameById.get(characterId) ?? characterId}: ${finalText}`);

      // D3(b) NPC cross-talk: if this responder named another NPC (by name or id), pull that NPC into
      // the SAME turn so a pointed remark gets an in-character reply. Reuses mentionedNpcIds (which
      // already filters to NPCs and dedupes) against the responder's OWN finalText; we additionally
      // skip self and anyone already scheduled, and never exceed MAX_RESPONDERS_PER_TURN.
      if (responders.length < MAX_RESPONDERS_PER_TURN) {
        for (const mentionedId of mentionedNpcIds(scenario, room, finalText)) {
          if (responders.length >= MAX_RESPONDERS_PER_TURN) {
            break;
          }
          if (mentionedId !== characterId && npcIds.has(mentionedId) && !scheduled.has(mentionedId)) {
            scheduled.add(mentionedId);
            responders.push(mentionedId);
          }
        }
      }
    }

    // C4: a responder that started and did not throw always gets exactly one terminal `done` (even
    // when `content` is empty). The route persists non-empty content and skips empty, but still emits
    // the terminal event either way.
    yield { kind: 'done', characterId, messageId, content };
  }
}
