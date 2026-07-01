// Per-player investigation for rooms. Returns ONLY the clues found in this search (closes the
// "investigate returns all clues" leak). Public clues become shared; private clues stay with the player.

import { randomUUID } from 'node:crypto';

import type { ChatMessage, Clue, GamePhase, Room, Scenario } from '@/types/game';

function investigationRound(phase: GamePhase): number | null {
  if (phase === 'INVESTIGATION_1') {
    return 1;
  }
  if (phase === 'INVESTIGATION_2') {
    return 2;
  }
  return null;
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

  const round = investigationRound(room.currentPhase);
  if (!round) {
    throw new Error(`Investigation is not allowed during phase ${room.currentPhase}`);
  }

  const available = location.clues.filter(clue => clue.availableInRound <= round);

  const playerFound = room.discoveredClues[playerId] ?? [];
  const playerFoundIds = new Set(playerFound.map(clue => clue.id));
  const publicFoundIds = new Set(room.publicClues.map(clue => clue.id));

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
  };

  return {
    room: nextRoom,
    result: { locationName: location.name, round, newlyFound },
    systemMessages,
  };
}
