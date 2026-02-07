/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');
const { summarizeScenario, validateScenario } = require('../lib/scenarios/schema.ts') as typeof import('../lib/scenarios/schema');

async function main(): Promise<void> {
  const scenarioPath = path.join(process.cwd(), 'data', 'scenarios', 'storm-mansion.json');
  const rawJson = fs.readFileSync(scenarioPath, 'utf-8');
  const scenario = validateScenario(JSON.parse(rawJson));
  console.log('Scenario validation passed.');
  console.log(summarizeScenario(scenario));
}

main().catch(error => {
  console.error('Scenario validation failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
