// Regression tests for the gameplay-loop fixes (B1 chat gate, A5 NPC throttle, B4 NPC voting).
// Runtime values are imported via RELATIVE `.ts` paths (the `@/` alias only resolves for type-only
// imports under `node --experimental-strip-types`). Run: node --experimental-strip-types tests/gameplay-chat.test.ts
//
// No API key is configured in this environment; we additionally clear any provider key so the
// NPC-voter deterministically takes its rule-based (no-LLM) path.

import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH ??= path.join(os.tmpdir(), `mm-gameplay-test-${Date.now()}.db`);
process.env.ROOM_AUTH_SECRET ??= 'test-secret-for-seat-auth';
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import type { Character, CharacterMemory, SuspicionRecord } from '@/types/game';

const { getPhaseConfig } = await import('../lib/game-engine/phase-manager.ts');
const { computeNpcVote, tryReserveNpcTrigger } = await import('../lib/agents/npc-voter.ts');

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

function makeCharacter(id: string, name: string, isKiller = false): Character {
  return {
    id,
    name,
    age: 40,
    occupation: '职业',
    personality: '性格',
    speakingStyle: '语气',
    publicInfo: '公开信息',
    privateScript: `SECRET-SCRIPT-${id}`,
    isKiller,
    relationships: [],
    objectives: [],
    alibi: { claimed: '声称', truth: `SECRET-ALIBI-${id}` },
    secrets: [`SECRET-${id}`],
  };
}

function makeMemory(characterId: string, suspicions: SuspicionRecord[]): CharacterMemory {
  return {
    characterId,
    privateScript: `SECRET-SCRIPT-${characterId}`,
    publicProfile: '公开信息',
    objectives: [],
    conversations: [],
    discoveredClues: [],
    knownFacts: [],
    suspicions,
    emotionalState: '警惕',
  };
}

// ── B1: the unified chat gate ────────────────────────────────────────────────
console.log('Chat gate (getPhaseConfig.allowsChat):');
check('INTRO allows chat (the KI-036 fix)', getPhaseConfig('INTRO').allowsChat === true);
check('DISCUSSION_1 allows chat', getPhaseConfig('DISCUSSION_1').allowsChat === true);
check('DISCUSSION_2 allows chat', getPhaseConfig('DISCUSSION_2').allowsChat === true);
check('FINAL_DISCUSSION allows chat', getPhaseConfig('FINAL_DISCUSSION').allowsChat === true);
check(
  'LOBBY / READING / INVESTIGATION / VOTING / REVEAL block chat',
  !getPhaseConfig('LOBBY').allowsChat
    && !getPhaseConfig('READING').allowsChat
    && !getPhaseConfig('INVESTIGATION_1').allowsChat
    && !getPhaseConfig('VOTING').allowsChat
    && !getPhaseConfig('REVEAL').allowsChat,
);

// ── B4: NPC voting (rule-based fallback, no LLM configured) ───────────────────
console.log('NPC voting (rule-based, no LLM):');
const cast = [makeCharacter('killer', '凶手', true), makeCharacter('a', '甲'), makeCharacter('b', '乙')];
const castIds = new Set(cast.map(character => character.id));

const killerVote = await computeNpcVote(
  cast[0],
  makeMemory('killer', [
    { characterId: 'a', level: 7, reasons: ['当晚的时间线对不上'] },
    { characterId: 'b', level: 3, reasons: [] },
  ]),
  cast,
);
check('killer never votes for itself', killerVote.accusedCharacterId !== 'killer');
check('vote is a valid other character id', castIds.has(killerVote.accusedCharacterId));
check('killer accuses its highest-suspicion OTHER (甲)', killerVote.accusedCharacterId === 'a');
check('reason is a non-empty single line', killerVote.reason.length > 0 && !killerVote.reason.includes('\n'));
check('reason leaks no secret / private script / alibi truth', !killerVote.reason.includes('SECRET-'));

// A suspicion record that (defensively) names self must be ignored — the killer still picks an other.
const killerSelfSuspVote = await computeNpcVote(
  cast[0],
  makeMemory('killer', [
    { characterId: 'killer', level: 10, reasons: ['自证'] },
    { characterId: 'b', level: 4, reasons: [] },
  ]),
  cast,
);
check(
  'self-suspicion is ignored; killer accuses an other (乙)',
  killerSelfSuspVote.accusedCharacterId === 'b',
);

// No suspicion signal at all → still a valid, non-self vote (the "random non-self" fallback).
const killerNoSignalVote = await computeNpcVote(cast[0], makeMemory('killer', []), cast);
check(
  'killer with no suspicions still returns a valid non-self id',
  castIds.has(killerNoSignalVote.accusedCharacterId) && killerNoSignalVote.accusedCharacterId !== 'killer',
);

// A non-killer NPC behaves the same way (own top suspicion, never self).
const innocentVote = await computeNpcVote(
  cast[1],
  makeMemory('a', [{ characterId: 'killer', level: 6, reasons: ['神色慌张'] }]),
  cast,
);
check('non-killer accuses its top suspicion (凶手)', innocentVote.accusedCharacterId === 'killer');
check('non-killer never votes for itself', innocentVote.accusedCharacterId !== 'a');

// ── A5: the per-room NPC trigger throttle ─────────────────────────────────────
console.log('NPC trigger throttle (cooldown + token bucket):');
const room = `throttle-room-${Date.now()}`;
check('first unprompted trigger is allowed', tryReserveNpcTrigger(room, false, 1_000) === true);
check('cooldown blocks a too-soon second trigger', tryReserveNpcTrigger(room, false, 2_000) === false);
check('an @-mention bypasses the cooldown', tryReserveNpcTrigger(room, true, 2_500) === true);
check('cooldown clears after the window elapses', tryReserveNpcTrigger(room, false, 2_500 + 8_001) === true);

const bucket = `bucket-room-${Date.now()}`;
let allowed = 0;
for (let i = 0; i < 8; i += 1) {
  // Same instant + mentioned → cooldown never applies, so only the token bucket limits the burst.
  if (tryReserveNpcTrigger(bucket, true, 5_000)) {
    allowed += 1;
  }
}
check('token bucket caps a same-instant burst at capacity (6)', allowed === 6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
