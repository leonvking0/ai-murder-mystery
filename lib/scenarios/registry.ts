// Single source of truth for scenarios at runtime. Validates each scenario at module load
// (previously validation only ran in a dead script — KI-005/KI-028).

import stormMansion from '@/data/scenarios/storm-mansion.json';
import type { Scenario } from '@/types/game';
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
