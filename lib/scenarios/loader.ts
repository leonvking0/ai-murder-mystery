import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Scenario } from '../../types/game';
import { validateScenario } from './schema';

const SCENARIO_DIR = path.join(process.cwd(), 'data', 'scenarios');
const scenarioCache = new Map<string, Scenario>();

function assertScenarioId(scenarioId: string): void {
  if (!/^[a-z0-9-]+$/.test(scenarioId)) {
    throw new Error(`Invalid scenario id: ${scenarioId}`);
  }
}

export async function loadScenarioById(scenarioId: string): Promise<Scenario> {
  assertScenarioId(scenarioId);

  const cached = scenarioCache.get(scenarioId);
  if (cached) {
    return cached;
  }

  const filePath = path.join(SCENARIO_DIR, `${scenarioId}.json`);

  let rawJson: string;
  try {
    rawJson = await readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read scenario file: ${filePath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(`Invalid JSON in scenario file: ${filePath}`, { cause: error });
  }

  const validated = validateScenario(parsed);
  scenarioCache.set(scenarioId, validated);
  return validated;
}

export async function loadAllScenarios(): Promise<Scenario[]> {
  let files: string[];
  try {
    files = await readdir(SCENARIO_DIR);
  } catch (error) {
    throw new Error(`Failed to list scenarios in: ${SCENARIO_DIR}`, { cause: error });
  }

  const scenarioIds = files
    .filter(file => file.endsWith('.json'))
    .map(file => path.basename(file, '.json'))
    .sort();

  return Promise.all(scenarioIds.map(loadScenarioById));
}

export function clearScenarioCache(): void {
  scenarioCache.clear();
}
