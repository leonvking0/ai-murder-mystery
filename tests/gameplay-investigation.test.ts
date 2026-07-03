// F4-b: flow-aware investigation ceiling (investigateRoom).
// Proves:
//   - STANDARD flow is UNCHANGED — at INVESTIGATION_1 only round-1 clues surface; at INVESTIGATION_2
//     round-2 clues surface (the historical behavior; the old fixed INVESTIGATION_1→1/INVESTIGATION_2→2
//     map must remain equivalent).
//   - QUICK flow keeps the case SOLVABLE — a room carrying FLOWS.quick at INVESTIGATION_1 (its ONLY, and
//     therefore LAST, investigation phase) surfaces BOTH round-1 AND round-2 clues, so the round-2 key
//     evidence is never stranded.
// Uses the real storm-mansion scenario (its `study` location has availableInRound 1 and 2 clues).
// Run: node --experimental-strip-types tests/gameplay-investigation.test.ts   (no extra deps)

// VALUE imports must use relative `.ts` paths — the `@/` alias resolves only for `import type`.
import stormMansionRaw from '../data/scenarios/storm-mansion.json' with { type: 'json' };
import { investigateRoom } from '../lib/game-engine/room-investigation.ts';
import { validateScenario } from '../lib/scenarios/schema.ts';
import { FLOWS } from '../lib/game-engine/flow.ts';
import type { GamePhase, Scenario } from '@/types/game';

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

const scenario: Scenario = validateScenario(stormMansionRaw);

// The `study` location authors clues at rounds [1, 1, 2, 2] with no prerequisites — ideal for exercising
// the round ceiling. Pin the exact ids so a single search's `newlyFound` can be checked by round.
const study = scenario.locations.find(location => location.id === 'study')!;
const round1Ids = study.clues.filter(clue => clue.availableInRound === 1).map(clue => clue.id);
const round2Ids = study.clues.filter(clue => clue.availableInRound === 2).map(clue => clue.id);

function baseRoom(phaseSequence: GamePhase[], currentPhase: GamePhase) {
  return {
    id: 'room-inv',
    code: 'ABCDE',
    scenarioId: scenario.id,
    status: 'in_progress',
    currentPhase,
    round: 1,
    phaseSequence,
    hostPlayerId: 'P1',
    players: [{ id: 'P1', publicId: 'p1', name: '玩家', isHost: true, connected: true, joinedAt: 1 }],
    characterControl: {},
    characterMemories: {},
    discoveredClues: {},
    publicClues: [],
    groupChatHistory: [],
    privateChats: {},
    votes: {},
    createdAt: 0,
    updatedAt: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function foundIds(phaseSequence: GamePhase[], currentPhase: GamePhase): Set<string> {
  const { result } = investigateRoom(baseRoom(phaseSequence, currentPhase), scenario, 'P1', 'study');
  return new Set(result.newlyFound.map(clue => clue.id));
}

// ---- STANDARD flow (unchanged) ----
console.log('F4-b investigation ceiling — STANDARD flow unchanged:');
{
  const i1 = foundIds(FLOWS.standard, 'INVESTIGATION_1');
  check('STANDARD @ INVESTIGATION_1 surfaces every round-1 study clue', round1Ids.every(id => i1.has(id)));
  check('STANDARD @ INVESTIGATION_1 surfaces NO round-2 study clue', round2Ids.every(id => !i1.has(id)));

  const i2 = foundIds(FLOWS.standard, 'INVESTIGATION_2');
  check('STANDARD @ INVESTIGATION_2 surfaces round-2 study clues', round2Ids.every(id => i2.has(id)));
  check('STANDARD @ INVESTIGATION_2 also surfaces round-1 study clues', round1Ids.every(id => i2.has(id)));
}

// ---- QUICK flow (case stays solvable) ----
console.log('F4-b investigation ceiling — QUICK flow keeps the case solvable:');
{
  const q1 = foundIds(FLOWS.quick, 'INVESTIGATION_1');
  check('QUICK @ INVESTIGATION_1 surfaces round-1 study clues', round1Ids.every(id => q1.has(id)));
  check('QUICK @ INVESTIGATION_1 ALSO surfaces round-2 study clues (not stranded)', round2Ids.every(id => q1.has(id)));
  check('there IS at least one round-2 study clue to strand (guards the assertion)', round2Ids.length > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
