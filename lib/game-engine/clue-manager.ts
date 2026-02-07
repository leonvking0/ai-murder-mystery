import { randomUUID } from 'node:crypto';

import type { Clue, GameSession, Scenario } from '@/types/game';

export interface InvestigationResult {
  locationId: string;
  locationName: string;
  round: number;
  newlyFound: Clue[];
  alreadyFound: Clue[];
  publicClues: Clue[];
  privateClues: Clue[];
}

function getInvestigationRound(session: GameSession): number | null {
  if (session.currentPhase === 'INVESTIGATION_1') {
    return 1;
  }

  if (session.currentPhase === 'INVESTIGATION_2') {
    return 2;
  }

  return null;
}

function addPublicFactsToMemories(
  session: GameSession,
  publicClues: Clue[],
): GameSession['characterMemories'] {
  if (publicClues.length === 0) {
    return session.characterMemories;
  }

  const publicFacts = publicClues.map(clue => `公共线索：${clue.content}`);

  return Object.fromEntries(
    Object.entries(session.characterMemories).map(([characterId, memory]) => {
      const mergedFacts = [...memory.knownFacts];

      for (const fact of publicFacts) {
        if (!mergedFacts.includes(fact)) {
          mergedFacts.push(fact);
        }
      }

      return [
        characterId,
        {
          ...memory,
          knownFacts: mergedFacts,
        },
      ];
    }),
  );
}

export function investigateLocation(
  session: GameSession,
  scenario: Scenario,
  locationId: string,
): { nextSession: GameSession; result: InvestigationResult } {
  const location = scenario.locations.find(item => item.id === locationId);
  if (!location) {
    throw new Error(`Location not found: ${locationId}`);
  }

  const round = getInvestigationRound(session);
  if (!round) {
    throw new Error(`Investigation is not allowed during phase ${session.currentPhase}`);
  }

  const availableClues = location.clues.filter(clue => clue.availableInRound <= round);
  const discoveredIds = new Set(session.discoveredClues.map(clue => clue.id));

  const newlyFound = availableClues
    .filter(clue => !discoveredIds.has(clue.id))
    .map(clue => ({
      ...clue,
      foundBy: 'player',
      foundAt: locationId,
    }));

  const alreadyFound = availableClues.filter(clue => discoveredIds.has(clue.id));
  const publicClues = newlyFound.filter(clue => clue.type === 'public');
  const privateClues = newlyFound.filter(clue => clue.type === 'private');

  const systemMessages = publicClues.map(clue => ({
    id: randomUUID(),
    role: 'system' as const,
    content: `【公共线索】${location.name}：${clue.content}`,
    timestamp: Date.now(),
  }));

  const nextSession: GameSession = {
    ...session,
    discoveredClues: [...session.discoveredClues, ...newlyFound],
    groupChatHistory: [...session.groupChatHistory, ...systemMessages],
    characterMemories: addPublicFactsToMemories(session, publicClues),
  };

  return {
    nextSession,
    result: {
      locationId: location.id,
      locationName: location.name,
      round,
      newlyFound,
      alreadyFound,
      publicClues,
      privateClues,
    },
  };
}
