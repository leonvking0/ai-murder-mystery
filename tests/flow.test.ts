// Regression tests for F4-a flow data-ization (zero behavior change).
// Covers the new flow.ts data source and the parametrized phase-manager helpers:
//   - resolveFlow() / resolveFlow('standard') equal the historical 10-phase walk
//   - resolveFlow() returns a FRESH array (mutation does not leak into FLOWS.standard)
//   - getNextPhase walks the standard sequence (and returns null past the end / on unknown)
//   - getNextPhase honors a custom sequence argument (proves it's parametrized)
//   - roundForPhase pins the round-locked phases (KI-032) and passes others through
// Run: npm test   (node --experimental-strip-types; no extra deps)

// VALUE imports must use relative `.ts` paths — the `@/` alias resolves only for `import type`.
import { resolveFlow, FLOWS } from '../lib/game-engine/flow.ts';
import { getNextPhase, roundForPhase, PHASE_SEQUENCE } from '../lib/game-engine/phase-manager.ts';
import type { GamePhase } from '@/types/game';

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

function arrEq(a: GamePhase[], b: GamePhase[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

console.log('Flow data-ization (F4-a):');

const HISTORICAL: GamePhase[] = [
  'LOBBY',
  'READING',
  'INTRO',
  'DISCUSSION_1',
  'INVESTIGATION_1',
  'DISCUSSION_2',
  'INVESTIGATION_2',
  'FINAL_DISCUSSION',
  'VOTING',
  'REVEAL',
];

// resolveFlow equals the historical sequence, with and without the explicit id.
check('resolveFlow() equals the historical 10-phase sequence', arrEq(resolveFlow(), HISTORICAL));
check("resolveFlow('standard') equals the historical 10-phase sequence", arrEq(resolveFlow('standard'), HISTORICAL));
check('FLOWS.standard equals the historical sequence', arrEq(FLOWS.standard, HISTORICAL));
check('PHASE_SEQUENCE still equals the historical sequence', arrEq(PHASE_SEQUENCE, HISTORICAL));

// resolveFlow returns a fresh copy — mutating it must not corrupt the shared FLOWS table.
const copy = resolveFlow();
copy.push('LOBBY');
copy[0] = 'REVEAL';
check('resolveFlow() returns a fresh array (mutation does not affect FLOWS.standard)', arrEq(FLOWS.standard, HISTORICAL));
check('two resolveFlow() calls return distinct array instances', resolveFlow() !== resolveFlow());

// getNextPhase walks the standard sequence.
check('getNextPhase LOBBY → READING', getNextPhase('LOBBY') === 'READING');
check('getNextPhase READING → INTRO', getNextPhase('READING') === 'INTRO');
check('getNextPhase INTRO → DISCUSSION_1', getNextPhase('INTRO') === 'DISCUSSION_1');
check('getNextPhase DISCUSSION_1 → INVESTIGATION_1', getNextPhase('DISCUSSION_1') === 'INVESTIGATION_1');
check('getNextPhase INVESTIGATION_1 → DISCUSSION_2', getNextPhase('INVESTIGATION_1') === 'DISCUSSION_2');
check('getNextPhase DISCUSSION_2 → INVESTIGATION_2', getNextPhase('DISCUSSION_2') === 'INVESTIGATION_2');
check('getNextPhase INVESTIGATION_2 → FINAL_DISCUSSION', getNextPhase('INVESTIGATION_2') === 'FINAL_DISCUSSION');
check('getNextPhase FINAL_DISCUSSION → VOTING', getNextPhase('FINAL_DISCUSSION') === 'VOTING');
check('getNextPhase VOTING → REVEAL', getNextPhase('VOTING') === 'REVEAL');
check('getNextPhase REVEAL → null (last phase)', getNextPhase('REVEAL') === null);
check('getNextPhase unknown phase → null', getNextPhase('NOT_A_PHASE' as GamePhase) === null);

// getNextPhase honors a custom sequence argument (proves parametrization).
const custom: GamePhase[] = ['LOBBY', 'VOTING', 'REVEAL'];
check('getNextPhase(LOBBY, custom) → VOTING', getNextPhase('LOBBY', custom) === 'VOTING');
check('getNextPhase(VOTING, custom) → REVEAL', getNextPhase('VOTING', custom) === 'REVEAL');
check('getNextPhase(REVEAL, custom) → null (last in custom)', getNextPhase('REVEAL', custom) === null);
check('getNextPhase(READING, custom) → null (absent from custom)', getNextPhase('READING', custom) === null);

// roundForPhase (KI-032): pins the round-locked phases, passes others through unchanged.
check('roundForPhase DISCUSSION_1 → 1', roundForPhase('DISCUSSION_1', 99) === 1);
check('roundForPhase INVESTIGATION_1 → 1', roundForPhase('INVESTIGATION_1', 99) === 1);
check('roundForPhase DISCUSSION_2 → 2', roundForPhase('DISCUSSION_2', 99) === 2);
check('roundForPhase INVESTIGATION_2 → 2', roundForPhase('INVESTIGATION_2', 99) === 2);
check('roundForPhase FINAL_DISCUSSION → 3', roundForPhase('FINAL_DISCUSSION', 99) === 3);
check('roundForPhase INTRO (non-pinned) passes currentRound through (7)', roundForPhase('INTRO', 7) === 7);
check('roundForPhase LOBBY (non-pinned) passes currentRound through (1)', roundForPhase('LOBBY', 1) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
