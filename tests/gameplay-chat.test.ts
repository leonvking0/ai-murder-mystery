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

import type { Character, CharacterMemory, GamePhase, Room, Scenario, SuspicionRecord } from '@/types/game';
import type { GroupResponseDeps, NpcTurnEvent } from '../lib/agents/room-group-chat.ts';

import stormMansionRaw from '../data/scenarios/storm-mansion.json' with { type: 'json' };

const { getPhaseConfig, narrationForPhase, PHASE_NARRATIONS } = await import('../lib/game-engine/phase-manager.ts');
const { computeNpcVote, tryReserveNpcTrigger } = await import('../lib/agents/npc-voter.ts');
// room-group-chat is deliberately strip-types-loadable (it lazy-imports npc-agent), so we can drive
// the group-turn generator offline. No LLM is configured here (keys deleted above), so the default
// path takes the not-configured branch; the success/failure paths are exercised via injected deps.
const { manageRoomGroupResponse, MAX_RESPONDERS_PER_TURN } = await import('../lib/agents/room-group-chat.ts');

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
  'LOBBY / READING / INVESTIGATION / REVEAL block chat',
  !getPhaseConfig('LOBBY').allowsChat
    && !getPhaseConfig('READING').allowsChat
    && !getPhaseConfig('INVESTIGATION_1').allowsChat
    && !getPhaseConfig('INVESTIGATION_2').allowsChat
    && !getPhaseConfig('REVEAL').allowsChat,
);
// D5(a): VOTING now OPENS chat (a defense round runs concurrently with balloting) while keeping votes
// enabled — a single gate read by group-chat / private-chat / present-clue routes and the group turn.
check('VOTING allows chat (D5(a) defense round)', getPhaseConfig('VOTING').allowsChat === true);
check('VOTING still allows voting', getPhaseConfig('VOTING').allowsVoting === true);

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

// ── C1 / C4 / C6: group-turn generator (turn/message ids + error handling) ────
// These run fully offline: `manageRoomGroupResponse` owns the gate/throttle/not-configured decisions
// and per-responder start→chunk→done|error events; the route (not exercised here) owns turnId, the
// per-room lock, SSE mapping, and persistence.
console.log('Group-chat turn generator (C1/C4/C6):');

function makeGroupScenario(characters: Character[]): Scenario {
  return {
    id: 'scn-test',
    title: '测试本',
    description: '用于离线测试的最小剧本',
    playerCount: { min: 1, max: 6 },
    difficulty: 'easy',
    estimatedDuration: 60,
    setting: { era: '现代', location: '山庄', atmosphere: '紧张', backgroundStory: '暴风雪封山' },
    case: {
      victim: '死者',
      causeOfDeath: '中毒',
      timeOfDeath: '午夜',
      crimeScene: '书房',
      truth: 'SECRET-TRUTH',
      murderMethod: 'SECRET-METHOD',
      motive: 'SECRET-MOTIVE',
    },
    characters,
    locations: [],
    phases: [],
    timeline: [],
  };
}

function makeGroupRoom(id: string, phase: GamePhase, npc: Character): Room {
  return {
    id,
    code: 'CODE',
    scenarioId: 'scn-test',
    status: 'in_progress',
    currentPhase: phase,
    round: 1,
    hostPlayerId: 'host',
    players: [],
    characterControl: { [npc.id]: { kind: 'npc' } },
    characterMemories: { [npc.id]: makeMemory(npc.id, []) },
    discoveredClues: {},
    publicClues: [],
    groupChatHistory: [],
    privateChats: {},
    votes: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

async function* gen(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function* throwingGen(): AsyncIterable<string> {
  yield '开始'; // a partial chunk...
  throw new Error('simulated provider failure'); // ...then fail mid-generation
}

async function collectTurn(iter: AsyncIterable<NpcTurnEvent>): Promise<NpcTurnEvent[]> {
  const out: NpcTurnEvent[] = [];
  for await (const event of iter) {
    out.push(event);
  }
  return out;
}

const groupNpc = makeCharacter('npc1', '甲');
const groupScenario = makeGroupScenario([groupNpc]);
let roomSeq = 0;
function freshGroupRoom(phase: GamePhase = 'DISCUSSION_1'): Room {
  roomSeq += 1;
  // Unique id per room ⇒ a fresh throttle bucket, so first triggers are always allowed.
  return makeGroupRoom(`group-room-${Date.now()}-${roomSeq}`, phase, groupNpc);
}

// C6: with no LLM configured (default deps), a triggered turn is a single terminal error and nothing
// gets streamed or persisted.
const notConfigured = await collectTurn(manageRoomGroupResponse(freshGroupRoom(), groupScenario, '大家好'));
const ncFirst = notConfigured[0];
check('no-LLM turn yields exactly one event', notConfigured.length === 1);
check(
  'no-LLM turn yields a single not_configured error',
  !!ncFirst && ncFirst.kind === 'error' && ncFirst.reason === 'not_configured',
);
check('no-LLM turn yields zero done events', notConfigured.every(event => event.kind !== 'done'));
check('no-LLM turn emits no per-NPC start (turn-level error only)', notConfigured.every(event => event.kind !== 'start'));

// C1/C4: a successful responder emits start → chunk(s) → exactly one done, all sharing one messageId.
const okDeps: GroupResponseDeps = {
  isConfigured: () => true,
  streamResponse: () => gen(['你好', '，我是', '甲。']),
};
const okEvents = await collectTurn(manageRoomGroupResponse(freshGroupRoom(), groupScenario, '大家好', okDeps));
const okStarts = okEvents.filter(event => event.kind === 'start');
const okChunks = okEvents.filter(event => event.kind === 'chunk');
const okDones = okEvents.filter(event => event.kind === 'done');
const okDone = okDones[0];
check('success turn: exactly one start', okStarts.length === 1);
check('success turn: exactly one done and no error', okDones.length === 1 && okEvents.every(event => event.kind !== 'error'));
check('success turn: every non-empty chunk is streamed', okChunks.length === 3);
check('messageId is stable across start/chunk/done for a responder', new Set(okEvents.map(event => event.messageId)).size === 1);
check(
  'done.content is the concatenation of the streamed chunks',
  !!okDone && okDone.kind === 'done' && okDone.content === '你好，我是甲。',
);

// C6/C4: a mid-generation failure yields a terminal error (never a done, never a partial persist).
const failDeps: GroupResponseDeps = {
  isConfigured: () => true,
  streamResponse: () => throwingGen(),
};
const failEvents = await collectTurn(manageRoomGroupResponse(freshGroupRoom(), groupScenario, '你说说', failDeps));
const failStart = failEvents.find(event => event.kind === 'start');
const failErrors = failEvents.filter(event => event.kind === 'error');
const failErr = failErrors[0];
check('failed turn: emits a start then exactly one terminal error', !!failStart && failErrors.length === 1);
check('failed turn: no done event (never persist a partial message)', failEvents.every(event => event.kind !== 'done'));
check('failed turn: error reason is "failed"', !!failErr && failErr.kind === 'error' && failErr.reason === 'failed');
check(
  'failed turn: terminal error shares the responder messageId with its start',
  !!failStart && !!failErr && failStart.messageId === failErr.messageId,
);

// C4: empty/whitespace-only output is still terminal (a done) — the client can always clear the bubble.
const emptyDeps: GroupResponseDeps = {
  isConfigured: () => true,
  streamResponse: () => gen(['   ']),
};
const emptyEvents = await collectTurn(manageRoomGroupResponse(freshGroupRoom(), groupScenario, '……', emptyDeps));
check('empty/whitespace turn still emits a terminal done (C4)', emptyEvents.some(event => event.kind === 'done'));
check('empty/whitespace turn emits no error', emptyEvents.every(event => event.kind !== 'error'));

// Gate: a chat-blocked phase yields nothing, even when configured.
const gated = await collectTurn(manageRoomGroupResponse(freshGroupRoom('READING'), groupScenario, '大家好', okDeps));
check('chat-gated phase (READING) yields nothing', gated.length === 0);

// Throttle: a second immediate unprompted trigger for the same room is suppressed (yields nothing).
const throttleRoom = makeGroupRoom(`group-throttle-${Date.now()}`, 'DISCUSSION_1', groupNpc);
const throttleFirst = await collectTurn(manageRoomGroupResponse(throttleRoom, groupScenario, '第一句', okDeps));
const throttleSecond = await collectTurn(manageRoomGroupResponse(throttleRoom, groupScenario, '第二句', okDeps));
check('throttle: first unprompted trigger produces a turn', throttleFirst.some(event => event.kind === 'start'));
check('throttle: second immediate unprompted trigger yields nothing', throttleSecond.length === 0);

// ── D3(b) NPC cross-talk + D3(a) nudge ───────────────────────────────────────
// Cross-talk: when a responder names another NPC in its OWN line, that NPC is pulled into the SAME
// turn (bypassing the human trigger, which never named it) — subject to MAX_RESPONDERS_PER_TURN and
// dedup. Nudge: an empty-triggerText self-prompt still yields a normal turn.
console.log('NPC cross-talk (D3b) + nudge (D3a):');

function makeMultiNpcRoom(id: string, phase: GamePhase, npcs: Character[]): Room {
  const characterControl: Record<string, { kind: 'npc' }> = {};
  const characterMemories: Record<string, CharacterMemory> = {};
  for (const npc of npcs) {
    characterControl[npc.id] = { kind: 'npc' };
    characterMemories[npc.id] = makeMemory(npc.id, []);
  }
  return {
    id,
    code: 'CODE',
    scenarioId: 'scn-test',
    status: 'in_progress',
    currentPhase: phase,
    round: 1,
    hostPlayerId: 'host',
    players: [],
    characterControl,
    characterMemories,
    discoveredClues: {},
    publicClues: [],
    groupChatHistory: [],
    privateChats: {},
    votes: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

// Injected stream whose single line is chosen by the responder's own character id (default: a neutral
// line that names nobody, so a pulled-in NPC does not itself pull anyone further).
function scriptedDeps(byId: Record<string, string>, fallback = '我没什么要补充的。'): GroupResponseDeps {
  return {
    isConfigured: () => true,
    streamResponse: params => gen([byId[params.character.id] ?? fallback]),
  };
}

let xtSeq = 0;
function xtRoomId(): string {
  xtSeq += 1;
  return `xtalk-${Date.now()}-${xtSeq}`; // unique ⇒ fresh throttle bucket ⇒ first trigger always allowed
}

const npcA = makeCharacter('ca', '甲');
const npcB = makeCharacter('cb', '乙');
const npcC = makeCharacter('cc', '丙');
const trioScenario = makeGroupScenario([npcA, npcB, npcC]);

// Genuine pull-in: with 3 NPCs the unmentioned base pick is the 2 quietest (甲, 乙); 丙 is NOT picked.
// The human line names nobody, yet 甲's reply names 丙 → cross-talk must pull 丙 into the same turn.
const pullRoom = makeMultiNpcRoom(xtRoomId(), 'DISCUSSION_1', [npcA, npcB, npcC]);
const pullEvents = await collectTurn(
  manageRoomGroupResponse(pullRoom, trioScenario, '大家好', scriptedDeps({ ca: '我认为丙很可疑。' })),
);
const pullStarted = pullEvents.filter(event => event.kind === 'start').map(event => event.characterId);
check(
  'cross-talk pulls a named non-base NPC (丙) into the SAME turn though the human never named it',
  pullStarted.includes('cc'),
);
check(
  'cross-talk: the pulled-in NPC (丙) also gets a terminal done',
  pullEvents.some(event => event.kind === 'done' && event.characterId === 'cc'),
);

// Literal 2-NPC case (per task): both NPCs are base-picked, so a responder naming the other must NOT
// double-schedule it — exactly one start/done for the named NPC.
const npcDa = makeCharacter('da', '甲');
const npcDb = makeCharacter('db', '乙');
const duoScenario = makeGroupScenario([npcDa, npcDb]);
const duoRoom = makeMultiNpcRoom(xtRoomId(), 'DISCUSSION_1', [npcDa, npcDb]);
const duoEvents = await collectTurn(
  manageRoomGroupResponse(duoRoom, duoScenario, '大家好', scriptedDeps({ da: '乙，你昨晚在哪里？' })),
);
const dbStarts = duoEvents.filter(event => event.kind === 'start' && event.characterId === 'db');
const dbDones = duoEvents.filter(event => event.kind === 'done' && event.characterId === 'db');
check('2-NPC: the named NPC (乙) responds in the same turn', dbStarts.length >= 1 && dbDones.length >= 1);
check('2-NPC: a named-but-already-scheduled NPC is not double-added', dbStarts.length === 1 && dbDones.length === 1);

// Dedup: 丙 is named twice within 甲's line AND again by 乙 (both base-picked) → still exactly one
// start/done for 丙 (mentionedNpcIds dedups within a line; the `scheduled` set dedups across responders).
const dedupRoom = makeMultiNpcRoom(xtRoomId(), 'DISCUSSION_1', [npcA, npcB, npcC]);
const dedupEvents = await collectTurn(
  manageRoomGroupResponse(dedupRoom, trioScenario, '大家好', scriptedDeps({ ca: '丙丙最可疑。', cb: '没错，丙的说法有问题。' })),
);
const ccStarts = dedupEvents.filter(event => event.kind === 'start' && event.characterId === 'cc');
const ccDones = dedupEvents.filter(event => event.kind === 'done' && event.characterId === 'cc');
check('dedup: an NPC named repeatedly (in one line and by two responders) still gets exactly one start', ccStarts.length === 1);
check('dedup: ...and exactly one done', ccDones.length === 1);

// Cap: 5 NPCs each naming every character (self filtered out). Base pick is 2, cross-talk saturates up
// to the cap and then stops — distinct responders == MAX_RESPONDERS_PER_TURN, and the loop terminates
// (the collectTurn resolving at all proves no infinite re-scheduling).
const fiveNames = ['甲', '乙', '丙', '丁', '戊'];
const five = fiveNames.map((name, index) => makeCharacter(`p${index + 1}`, name));
const fiveScenario = makeGroupScenario(five);
const capRoom = makeMultiNpcRoom(xtRoomId(), 'DISCUSSION_1', five);
const allNames = fiveNames.join('');
const capDeps = scriptedDeps(Object.fromEntries(five.map(character => [character.id, allNames])), allNames);
const capEvents = await collectTurn(manageRoomGroupResponse(capRoom, fiveScenario, '大家好', capDeps));
const capStarts = capEvents.filter(event => event.kind === 'start');
const distinctResponders = new Set(capStarts.map(event => event.characterId));
check(
  `cap: distinct responders never exceed MAX_RESPONDERS_PER_TURN (${MAX_RESPONDERS_PER_TURN})`,
  distinctResponders.size <= MAX_RESPONDERS_PER_TURN,
);
check('cap: with everyone naming everyone, the turn saturates exactly at the cap', distinctResponders.size === MAX_RESPONDERS_PER_TURN);
check('cap: no NPC is scheduled twice (one start each) and the turn terminates', capStarts.length === distinctResponders.size);

// D3(a) nudge: the server self-prompt path passes an EMPTY triggerText; it must still yield a normal
// start→done turn (no mention, no error). Single-NPC room + configured deps.
const nudgeEvents = await collectTurn(manageRoomGroupResponse(freshGroupRoom(), groupScenario, '', okDeps));
check('nudge: empty-triggerText self-prompt still yields a start', nudgeEvents.some(event => event.kind === 'start'));
check('nudge: empty-triggerText self-prompt still yields a terminal done', nudgeEvents.some(event => event.kind === 'done'));
check('nudge: the self-prompt path emits no error', nudgeEvents.every(event => event.kind !== 'error'));

// F4-c: scenario-driven GM narration. A scenario's own `narrations` win over the generic defaults;
// scenarios without `narrations` fall back to PHASE_NARRATIONS; and the defaults are now scenario-neutral.
console.log('F4-c GM narration (narrationForPhase + neutral defaults):');
const stormScenario = stormMansionRaw as unknown as Scenario;
check(
  'narrationForPhase: storm-mansion INVESTIGATION_2 uses its own narration (contains 毒物)',
  narrationForPhase('INVESTIGATION_2', stormScenario).includes('毒物'),
);
check(
  'narrationForPhase: storm-mansion narration matches the scenario override verbatim',
  narrationForPhase('READING', stormScenario) === stormScenario.narrations?.READING,
);
const noNarrationScenario = { ...stormScenario, narrations: undefined } as Scenario;
check(
  'narrationForPhase: a scenario with no narrations falls back to the generic PHASE_NARRATIONS',
  narrationForPhase('INVESTIGATION_2', noNarrationScenario) === PHASE_NARRATIONS.INVESTIGATION_2,
);
check(
  'narrationForPhase: fallback default is scenario-neutral (no storm-specific 毒物/密室/暴风雪)',
  !narrationForPhase('INVESTIGATION_2', noNarrationScenario).match(/毒物|密室|暴风雪/),
);
const genericJoined = Object.values(PHASE_NARRATIONS).join('');
check(
  'PHASE_NARRATIONS defaults contain no storm-specific words (暴风雪/密室)',
  !genericJoined.includes('暴风雪') && !genericJoined.includes('密室'),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
