// Single source of truth for scenarios at runtime. Validates each scenario at module load
// (previously validation only ran in a dead script — KI-005/KI-028).

import stormMansion from '@/data/scenarios/storm-mansion.json';
import type { Scenario, ScenarioCard } from '@/types/game';
import { validateScenario } from './schema';

const scenarios: Record<string, Scenario> = {};

function register(raw: unknown): void {
  const scenario = validateScenario(raw);
  scenarios[scenario.id] = scenario;
}

register(stormMansion);

export function getScenarioById(scenarioId: string): Scenario | undefined {
  return scenarios[scenarioId];
}

export function listScenarios(): Scenario[] {
  return Object.values(scenarios);
}

// Project a scenario to its public catalog card. Built field-by-field ON PURPOSE — never spread the
// scenario, which would leak characters / case.truth / isKiller / secrets / clues into the catalog.
export function toScenarioCard(scenario: Scenario): ScenarioCard {
  return {
    id: scenario.id,
    title: scenario.title,
    description: scenario.description,
    playerCount: scenario.playerCount,
    difficulty: scenario.difficulty,
    estimatedDuration: scenario.estimatedDuration,
    atmosphere: scenario.setting.atmosphere,
  };
}

export function listScenarioCards(): ScenarioCard[] {
  return listScenarios().map(toScenarioCard);
}
