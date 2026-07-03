// Per-player investigation for rooms. Returns ONLY the clues found in this search (closes the
// "investigate returns all clues" leak). Public clues become shared; private clues stay with the player.

import { randomUUID } from 'node:crypto';

import type { ChatMessage, Clue, GamePhase, Room, Scenario } from '@/types/game';

// Relative + explicit `.ts` so the strip-types test runner resolves this value import at runtime
// (`@/` aliases resolve only for type-only imports there). See tests/gameplay-reveal.test.ts.
import { FLOWS } from './flow.ts';

// C8 / KI-042: how many independent searches a single player may run within one investigation phase.
// One investigateRoom() call = one unit, regardless of how many clues that search turned up. The budget
// is tracked per (playerId, phase) in room.investigationCounts and resets naturally each phase (the key
// embeds the phase). Enforced inside investigateRoom() so the atomic updateRoom() transaction rolls the
// whole search back when the budget is exhausted.
export const INVESTIGATION_BUDGET = 2;

// F4-b: flow- + scenario-aware investigation ceiling. Replaces the old fixed INVESTIGATION_1→1 /
// INVESTIGATION_2→2 map so a room can carry a shorter `phaseSequence` (the 'quick' flow) without
// stranding round-2 clues. Rule: the LAST investigation phase in the room's flow exposes EVERY clue
// round the scenario authored; earlier investigation phases expose only their ordinal.
//
// Standard flow (investigation phases = [INVESTIGATION_1, INVESTIGATION_2]) is unchanged:
//   INVESTIGATION_1 → idx 0, not last → 1.  INVESTIGATION_2 → idx 1, last → max(clueMax=2, 2) = 2.
// Quick flow (investigation phases = [INVESTIGATION_1]):
//   INVESTIGATION_1 → idx 0, last → max(clueMax=2, 1) = 2, so all clues stay reachable.
function investigationCeiling(room: Room, scenario: Scenario): number | null {
  const seq = room.phaseSequence ?? FLOWS.standard;
  const invPhases: GamePhase[] = seq.filter(p => p === 'INVESTIGATION_1' || p === 'INVESTIGATION_2');
  const idx = invPhases.indexOf(room.currentPhase);
  if (idx === -1) {
    return null; // current phase is not an investigation phase
  }
  const ordinal = idx + 1;
  const isLast = idx === invPhases.length - 1;
  if (!isLast) {
    return ordinal;
  }
  // Last investigation phase: expose every clue round the scenario authored (never strand a clue).
  return scenario.locations
    .flatMap(l => l.clues.map(c => c.availableInRound))
    .reduce((m, r) => Math.max(m, r), ordinal);
}

// D6: a clue is gated behind an optional `prerequisite` clue id. It becomes offerable only once that
// prerequisite is in `knownClueIds` — the requesting player's OWN known set (their discovered clues ∪
// the room's public clues). Never consults another player's private discoveries.
function cluePrerequisiteMet(clue: Clue, knownClueIds: Set<string>): boolean {
  return clue.prerequisite === undefined || knownClueIds.has(clue.prerequisite);
}

export interface RoomInvestigationResult {
  locationName: string;
  round: number;
  newlyFound: Clue[];
}

/**
 * Apply an investigation by `playerId` at `locationId`. Returns the updated room plus the clues this
 * player newly found. Public clues are appended to room.publicClues + NPC knownFacts + a system
 * message in group chat; private clues go only to that player's notebook.
 */
export function investigateRoom(
  room: Room,
  scenario: Scenario,
  playerId: string,
  locationId: string,
): { room: Room; result: RoomInvestigationResult; systemMessages: ChatMessage[] } {
  const location = scenario.locations.find(item => item.id === locationId);
  if (!location) {
    throw new Error(`Location not found: ${locationId}`);
  }

  const round = investigationCeiling(room, scenario);
  if (!round) {
    throw new Error(`Investigation is not allowed during phase ${room.currentPhase}`);
  }

  // C8 / KI-042: enforce the per-phase search budget BEFORE doing any work. The key embeds the current
  // phase so INVESTIGATION_1 and INVESTIGATION_2 have independent budgets.
  const budgetKey = `${playerId}:${room.currentPhase}`;
  const usedThisPhase = room.investigationCounts?.[budgetKey] ?? 0;
  if (usedThisPhase >= INVESTIGATION_BUDGET) {
    throw new Error('本阶段搜证次数已用完');
  }

  const playerFound = room.discoveredClues[playerId] ?? [];
  const playerFoundIds = new Set(playerFound.map(clue => clue.id));
  const publicFoundIds = new Set(room.publicClues.map(clue => clue.id));

  // D6 prerequisite gating: the player's OWN known set = their discovered clues ∪ the room's public
  // clues. A gated clue is only offered once its prerequisite is in this set (the pinned decision).
  const knownClueIds = new Set([...playerFoundIds, ...publicFoundIds]);

  const available = location.clues.filter(
    clue => clue.availableInRound <= round && cluePrerequisiteMet(clue, knownClueIds),
  );

  // New to THIS player (public clues already revealed publicly are not "new" findings for them).
  const newlyFound = available
    .filter(clue => !playerFoundIds.has(clue.id) && !(clue.type === 'public' && publicFoundIds.has(clue.id)))
    .map(clue => ({ ...clue, foundBy: playerId, foundAt: location.name }));

  const newPublic = newlyFound.filter(clue => clue.type === 'public');
  const newPrivate = newlyFound.filter(clue => clue.type === 'private');

  // Public clues: add to shared pool (dedup) + NPC memory facts + a system message for everyone.
  const nextPublicClues = [...room.publicClues];
  for (const clue of newPublic) {
    if (!nextPublicClues.some(item => item.id === clue.id)) {
      nextPublicClues.push(clue);
    }
  }

  const publicFacts = newPublic.map(clue => `公共线索：${clue.content}`);
  const nextMemories = Object.fromEntries(
    Object.entries(room.characterMemories).map(([characterId, memory]) => {
      const mergedFacts = [...memory.knownFacts];
      for (const fact of publicFacts) {
        if (!mergedFacts.includes(fact)) {
          mergedFacts.push(fact);
        }
      }
      return [characterId, { ...memory, knownFacts: mergedFacts }];
    }),
  );

  const systemMessages = newPublic.map(clue => ({
    id: randomUUID(),
    role: 'system' as const,
    content: `【公共线索·${location.name}】${clue.content}`,
    timestamp: Date.now(),
  }));

  // D6 fuzzy hint: if this search turned up ≥1 NEW private clue, broadcast a SINGLE content-free hint
  // to the whole table. It names ONLY the (already public) location — never the clue content,
  // significance, id, count, or the finder's playerId. One hint per search, not one per clue.
  if (newPrivate.length > 0) {
    systemMessages.push({
      id: randomUUID(),
      role: 'system' as const,
      content: `【搜证】有人在「${location.name}」里似乎发现了什么线索…`,
      timestamp: Date.now(),
    });
  }

  // Private clues: only this player's notebook.
  const nextPlayerClues = [...playerFound];
  for (const clue of newPrivate) {
    if (!nextPlayerClues.some(item => item.id === clue.id)) {
      nextPlayerClues.push(clue);
    }
  }
  // Public clues are also visible in the player's own notebook for convenience.
  for (const clue of newPublic) {
    if (!nextPlayerClues.some(item => item.id === clue.id)) {
      nextPlayerClues.push(clue);
    }
  }

  const nextRoom: Room = {
    ...room,
    publicClues: nextPublicClues,
    characterMemories: nextMemories,
    discoveredClues: { ...room.discoveredClues, [playerId]: nextPlayerClues },
    groupChatHistory: [...room.groupChatHistory, ...systemMessages],
    // C8: consume one budget unit for this successful search.
    investigationCounts: { ...(room.investigationCounts ?? {}), [budgetKey]: usedThisPhase + 1 },
  };

  return {
    room: nextRoom,
    result: { locationName: location.name, round, newlyFound },
    systemMessages,
  };
}

/**
 * Present a clue the player already discovered to the whole table, making it public. Mirrors the
 * public-clue path of `investigateRoom`: the clue joins `room.publicClues` (dedup by id), the fact is
 * merged into every NPC's `knownFacts`, and a `system` message is posted to group chat. Idempotent —
 * presenting an already-public clue is a no-op. Throws if the player never discovered the clue.
 *
 * NEVER exposes `clue.significance`: only `clue.content` is surfaced to NPC memory + group chat.
 */
export function presentClue(
  room: Room,
  scenario: Scenario,
  playerId: string,
  clueId: string,
): { room: Room; systemMessages: ChatMessage[] } {
  const playerClues = room.discoveredClues[playerId] ?? [];
  const clue = playerClues.find(item => item.id === clueId);
  if (!clue) {
    throw new Error(`未在你的笔记中找到该线索：${clueId}`);
  }

  // Idempotent: already public → nothing to do.
  if (room.publicClues.some(item => item.id === clue.id)) {
    return { room, systemMessages: [] };
  }

  const presenter = room.players.find(item => item.id === playerId);
  const presenterName = presenter?.name ?? '玩家';

  // Add to the shared public pool.
  const nextPublicClues = [...room.publicClues, clue];

  // Merge the public fact into every NPC's known facts (never the GM-only significance).
  const publicFact = `公共线索：${clue.content}`;
  const nextMemories = Object.fromEntries(
    Object.entries(room.characterMemories).map(([characterId, memory]) => {
      const mergedFacts = memory.knownFacts.includes(publicFact)
        ? memory.knownFacts
        : [...memory.knownFacts, publicFact];
      return [characterId, { ...memory, knownFacts: mergedFacts }];
    }),
  );

  const systemMessage: ChatMessage = {
    id: randomUUID(),
    role: 'system',
    content: `【出示线索·${presenterName}】${clue.content}`,
    timestamp: Date.now(),
  };

  const nextRoom: Room = {
    ...room,
    publicClues: nextPublicClues,
    characterMemories: nextMemories,
    groupChatHistory: [...room.groupChatHistory, systemMessage],
  };

  return { room: nextRoom, systemMessages: [systemMessage] };
}
