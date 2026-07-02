// Regression tests for scenario startup validation (E3 / KI-056 = KI-028).
// Covers validateScenario's structural invariants that keep a bad scenario from bricking a game:
//   - exactly one killer (0 or >1 isKiller flags are data errors)
//   - availableInRound is a positive integer
//   - relationship.characterId referential integrity
//   - (existing) cross-location clue-id uniqueness still fires
// Run: npm test   (node --experimental-strip-types; no extra deps)

// VALUE import must use a relative .ts path — the @/ alias resolves only for `import type`.
const { validateScenario, ScenarioValidationError } = await import('../lib/scenarios/schema.ts');
// The shipped scenario is the real-data fixture.
import scenario from '../data/scenarios/storm-mansion.json' with { type: 'json' };

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log('  ✓', name);
  } else {
    fail += 1;
    console.log('  ✗ FAIL:', name);
  }
}

// Deep clone so each mutation starts from the pristine, valid fixture.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clone(): any {
  return structuredClone(scenario);
}

// Runs `mutate` on a fresh clone and reports whether validateScenario threw the right error type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function throwsOn(mutate: (s: any) => void): boolean {
  const s = clone();
  mutate(s);
  try {
    validateScenario(s);
    return false;
  } catch (err) {
    return err instanceof ScenarioValidationError;
  }
}

console.log('Scenario validation (E3 / KI-056):');

// Baseline: the real shipped scenario must validate cleanly (guards against a check that bricks startup).
let baselineOk = false;
try {
  validateScenario(clone());
  baselineOk = true;
} catch (err) {
  console.log('    (baseline threw:', (err as Error).message, ')');
}
check('real storm-mansion scenario validates without throwing', baselineOk);

// Exactly one killer.
check('two killers (a second character isKiller=true) throws', throwsOn(s => {
  const other = s.characters.find((c: { isKiller: boolean }) => !c.isKiller);
  other.isKiller = true;
}));
check('zero killers (sole killer isKiller=false) throws', throwsOn(s => {
  const killer = s.characters.find((c: { isKiller: boolean }) => c.isKiller);
  killer.isKiller = false;
}));

// availableInRound must be a positive integer.
check('clue availableInRound = 0 throws', throwsOn(s => {
  s.locations[0].clues[0].availableInRound = 0;
}));
check('clue availableInRound = 1.5 (non-integer) throws', throwsOn(s => {
  s.locations[0].clues[0].availableInRound = 1.5;
}));

// Relationship referential integrity.
check("relationship characterId 'does-not-exist' throws", throwsOn(s => {
  const withRel = s.characters.find((c: { relationships: unknown[] }) => c.relationships.length > 0);
  withRel.relationships[0].characterId = 'does-not-exist';
}));

// The existing cross-location graph check must still fire on a duplicated clue id.
check('duplicate clue id across two locations throws (existing graph check still fires)', throwsOn(s => {
  const dupId = s.locations[0].clues[0].id;
  // Point a clue in a different location at the same id.
  const otherLoc = s.locations.find((l: { clues: { id: string }[] }) => l.clues.length > 0 && l.clues[0].id !== dupId)
    ?? s.locations[1];
  otherLoc.clues[0].id = dupId;
}));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
