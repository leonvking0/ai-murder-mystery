import { randomUUID } from 'node:crypto';

import stormMansion from '@/data/scenarios/storm-mansion.json';
import { initializeMemory } from '@/lib/game-engine/memory-manager';
import type { GameSession, Scenario } from '@/types/game';

const scenarios: Record<string, Scenario> = {
  [stormMansion.id]: stormMansion as Scenario,
};

const gameSessions = new Map<string, GameSession>();

function createEmptyChatHistories(scenario: Scenario): Record<string, GameSession['chatHistories'][string]> {
  return Object.fromEntries(scenario.characters.map(character => [character.id, []]));
}

function createCharacterMemories(scenario: Scenario): GameSession['characterMemories'] {
  return Object.fromEntries(
    scenario.characters.map(character => [character.id, initializeMemory(character)]),
  );
}

export function getScenarioById(scenarioId: string): Scenario | undefined {
  return scenarios[scenarioId];
}

export function createSession(scenarioId: string): GameSession {
  const scenario = scenarios[scenarioId];

  if (!scenario) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }

  const session: GameSession = {
    id: randomUUID(),
    scenarioId,
    currentPhase: 'READING',
    round: 1,
    startedAt: Date.now(),
    characterMemories: createCharacterMemories(scenario),
    discoveredClues: [],
    votes: {},
    chatHistories: createEmptyChatHistories(scenario),
    groupChatHistory: [],
  };

  gameSessions.set(session.id, session);
  return session;
}

export function getSession(id: string): GameSession | undefined {
  return gameSessions.get(id);
}

export function updateSession(
  id: string,
  updates: Partial<GameSession> | ((session: GameSession) => GameSession),
): GameSession | undefined {
  const current = gameSessions.get(id);

  if (!current) {
    return undefined;
  }

  const next = typeof updates === 'function'
    ? updates(current)
    : {
      ...current,
      ...updates,
    };

  gameSessions.set(id, next);
  return next;
}
