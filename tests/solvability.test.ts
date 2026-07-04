// Regression tests for offline structural solvability analysis (F2-tail).
// Proves the SHIPPED storm-mansion scenario is solvable under BOTH flows (standard + quick) — the key
// F4-b regression (quick mode must not strand round-2 clues) — and that each solvability check fires on
// a deliberately broken fixture. Solvability BUILDS ON validateScenario; it never re-implements it.
// Run: npm test   (node --experimental-strip-types; no extra deps)

// VALUE imports must use relative .ts paths — the @/ alias resolves only for `import type`.
const { validateScenario } = await import('../lib/scenarios/schema.ts');
const { analyzeSolvability, analyzeAllFlows } = await import('../lib/scenarios/solvability.ts');
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

function hasError(report: { issues: { severity: string; code: string }[] }, code: string): boolean {
  return report.issues.some(i => i.severity === 'error' && i.code === code);
}
function hasWarning(report: { issues: { severity: string; code: string }[] }, code: string): boolean {
  return report.issues.some(i => i.severity === 'warning' && i.code === code);
}

console.log('Scenario solvability (F2-tail):');

// ---- The REAL shipped scenario is solvable under BOTH flows (the key regression) ---------------
const validated = validateScenario(clone());
check('real storm-mansion passes validateScenario (baseline for solvability)', !!validated);

const reports = analyzeAllFlows(validated);
check('analyzeAllFlows returns exactly two reports (standard + quick)', reports.length === 2);
check(
  'analyzeAllFlows covers both flow ids',
  reports.some(r => r.flowId === 'standard') && reports.some(r => r.flowId === 'quick'),
);
check('every flow report is solvable (no error issues)', reports.every(r => r.solvable));
check('every flow report has zero error-severity issues', reports.every(r => !r.issues.some(i => i.severity === 'error')));

const standard = analyzeSolvability(validated, 'standard');
const quick = analyzeSolvability(validated, 'quick');
check('storm-mansion solvable under STANDARD flow', standard.solvable);
check('storm-mansion solvable under QUICK flow (round-2 clues not stranded)', quick.solvable);
check('quick flow strands no clue by round (no clue_unreachable_by_round)', !hasError(quick, 'clue_unreachable_by_round'));
check('standard flow reports no prerequisite_unreachable', !hasError(standard, 'prerequisite_unreachable'));

// ---- error: prerequisite_unreachable — prereq authored in a LATER round than its dependent -----
check('prerequisite authored in a later round than its dependent → prerequisite_unreachable', (() => {
  const s = clone();
  const allClues = s.locations.flatMap((l: { clues: { id: string; availableInRound: number; prerequisite?: string }[] }) => l.clues);
  const early = allClues.find((c: { availableInRound: number }) => c.availableInRound === 1);
  const late = allClues.find((c: { availableInRound: number }) => c.availableInRound === 2);
  early.prerequisite = late.id; // round-1 clue now needs a round-2 clue: chain not walkable
  // Still passes validateScenario (prereq exists + acyclic); solvability catches the round violation.
  const v = validateScenario(s);
  const r = analyzeSolvability(v, 'standard');
  return hasError(r, 'prerequisite_unreachable') && !r.solvable;
})());

// ---- error: prerequisite_unreachable — prereq missing (defensive) -------------------------------
check('prerequisite referencing a non-existent clue → prerequisite_unreachable (defensive)', (() => {
  const s = clone();
  s.locations[0].clues[0].prerequisite = 'no-such-clue';
  const r = analyzeSolvability(s, 'standard'); // bypass validateScenario (which would reject it)
  return hasError(r, 'prerequisite_unreachable') && !r.solvable;
})());

// ---- error: dangling_timeline_character (NOT validated upstream — genuine additional check) -----
check('timeline referencing an unknown character id → dangling_timeline_character', (() => {
  const s = clone();
  s.timeline[0].involvedCharacters = ['ghost-who-does-not-exist'];
  const v = validateScenario(s); // validateScenario does NOT check timeline char refs → passes
  const r = analyzeSolvability(v, 'standard');
  return hasError(r, 'dangling_timeline_character') && !r.solvable;
})());

// ---- error: multiple_killers (defensive; validateScenario would normally reject upstream) -------
check('two isKiller characters → multiple_killers (defensive)', (() => {
  const s = clone();
  const other = s.characters.find((c: { isKiller: boolean }) => !c.isKiller);
  other.isKiller = true;
  const r = analyzeSolvability(s, 'standard');
  return hasError(r, 'multiple_killers') && !r.solvable;
})());

// ---- error: no_killer (defensive) ---------------------------------------------------------------
check('zero isKiller characters → no_killer (defensive)', (() => {
  const s = clone();
  const killer = s.characters.find((c: { isKiller: boolean }) => c.isKiller);
  killer.isKiller = false;
  const r = analyzeSolvability(s, 'standard');
  return hasError(r, 'no_killer') && !r.solvable;
})());

// ---- error: dangling_relationship (defensive) ---------------------------------------------------
check('relationship to unknown character id → dangling_relationship (defensive)', (() => {
  const s = clone();
  const withRel = s.characters.find((c: { relationships: unknown[] }) => c.relationships.length > 0);
  withRel.relationships[0].characterId = 'does-not-exist';
  const r = analyzeSolvability(s, 'standard');
  return hasError(r, 'dangling_relationship') && !r.solvable;
})());

// ---- warning: killer_no_incriminating_clue — WARNING, solvable stays TRUE -----------------------
check('no clue significance mentions the killer → killer_no_incriminating_clue WARNING, still solvable', (() => {
  const s = clone();
  const killer = s.characters.find((c: { isKiller: boolean }) => c.isKiller);
  // Scrub any mention of the killer's id/name from every clue's significance.
  for (const loc of s.locations) {
    for (const cl of loc.clues) {
      cl.significance = cl.significance.split(killer.id).join('X').split(killer.name).join('X');
    }
  }
  const v = validateScenario(s); // still well-formed
  const r = analyzeSolvability(v, 'standard');
  return hasWarning(r, 'killer_no_incriminating_clue') && r.solvable; // warnings never block
})());

// ---- warning: character_no_clue_coverage — WARNING, solvable stays TRUE -------------------------
check('character absent from all clues + timeline → character_no_clue_coverage WARNING, still solvable', (() => {
  const s = clone();
  // Add an isolated non-victim character referenced by no clue significance and no timeline event.
  s.characters.push({
    id: 'ghost-npc',
    name: '幽灵',
    age: 30,
    occupation: 'nobody',
    personality: 'x',
    speakingStyle: 'x',
    publicInfo: 'x',
    privateScript: 'x',
    isKiller: false,
    relationships: [],
    objectives: [],
    alibi: { claimed: 'x', truth: 'x' },
    secrets: [],
  });
  const r = analyzeSolvability(s, 'standard'); // direct (added char is not fully schema-valid)
  return hasWarning(r, 'character_no_clue_coverage') && r.solvable; // warnings never block
})());

// ---- warnings alone never flip solvable to false ------------------------------------------------
check('a report carrying ONLY warnings is still solvable', (() => {
  const s = clone();
  s.characters.push({
    id: 'ghost-npc-2', name: '幽灵二', age: 30, occupation: 'x', personality: 'x', speakingStyle: 'x',
    publicInfo: 'x', privateScript: 'x', isKiller: false, relationships: [], objectives: [],
    alibi: { claimed: 'x', truth: 'x' }, secrets: [],
  });
  const r = analyzeSolvability(s, 'standard');
  const onlyWarnings = r.issues.length > 0 && r.issues.every(i => i.severity === 'warning');
  return onlyWarnings && r.solvable;
})());

// ---- the shipped scenario raises NO warnings either (well-authored) -----------------------------
check('shipped storm-mansion raises zero issues at all under standard', standard.issues.length === 0);
check('shipped storm-mansion raises zero issues at all under quick', quick.issues.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
