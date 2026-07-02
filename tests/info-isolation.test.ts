// Regression tests for the multiplayer foundation:
//   - SQLite room store: persistence + atomic read-modify-write
//   - Per-player projection: information isolation (KI-001) — the game's #1 rule
// Run: npm test   (node --experimental-strip-types; no extra deps)

import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH ??= path.join(os.tmpdir(), `mm-test-${Date.now()}.db`);
process.env.ROOM_AUTH_SECRET ??= 'test-secret-for-seat-auth';
// Force the offline path everywhere in this file (no live LLM calls): the C10 compaction check below
// exercises summarizeConversations, which must take its no-LLM last-N join fallback.
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { createRoom, getRoom, getRoomByCode, updateRoom } = await import('../lib/store/rooms.ts');
const { projectRoomForPlayer, toScenarioPublic, seatsToTakeOver, reassignHost } = await import('../lib/scenarios/projection.ts');

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

console.log('SQLite room store:');
const room = createRoom({ scenarioId: 'storm-mansion', hostName: 'Alice' });
check('createRoom returns id + 5-char code', Boolean(room.id) && /^[A-Z2-9]{5}$/.test(room.code));
check('getRoom round-trips', getRoom(room.id)?.id === room.id);
check('getRoomByCode is case-insensitive', getRoomByCode(room.code.toLowerCase())?.id === room.id);
check('host player present and isHost', room.players.length === 1 && room.players[0].isHost === true);
for (let i = 0; i < 50; i += 1) {
  updateRoom(room.id, current => ({ ...current, votes: { ...current.votes, [`p${i}`]: 'x' } }));
}
check('updateRoom persists all 50 mutations atomically', Object.keys(getRoom(room.id)!.votes).length === 50);
check('updateRoom on missing id returns undefined', updateRoom('nope', current => current) === undefined);

console.log('Projection information isolation:');
const scenario = {
  id: 'x', title: 'T', description: 'D', playerCount: { min: 1, max: 2 }, difficulty: 'medium',
  estimatedDuration: 60,
  setting: { era: 'e', location: 'l', atmosphere: 'a', backgroundStory: 'b' },
  case: {
    victim: 'V', causeOfDeath: 'C', timeOfDeath: '00:00', crimeScene: 'study',
    truth: 'SECRET-TRUTH', murderMethod: 'SECRET-METHOD', motive: 'SECRET-MOTIVE',
  },
  characters: [
    {
      id: 'killer', name: 'K', age: 40, occupation: 'o', personality: 'p', speakingStyle: 's',
      publicInfo: 'pub', privateScript: 'SECRET-SCRIPT-K', isKiller: true,
      relationships: [{ characterId: 'other', publicRelation: 'pubrel', privateRelation: 'SECRET-REL' }],
      objectives: [{ description: 'o', type: 'primary', isSecret: true }],
      alibi: { claimed: 'claimed', truth: 'SECRET-ALIBI' }, secrets: ['SECRET-1'],
    },
    {
      id: 'other', name: 'O', age: 30, occupation: 'o', personality: 'p', speakingStyle: 's',
      publicInfo: 'pub2', privateScript: 'SECRET-SCRIPT-O', isKiller: false,
      relationships: [], objectives: [{ description: 'o', type: 'primary', isSecret: false }],
      alibi: { claimed: 'c', truth: 'SECRET-ALIBI-O' }, secrets: ['SECRET-2'],
    },
  ],
  locations: [{
    id: 'study', name: '书房', description: 'd',
    clues: [{ id: 'c1', content: 'clue', type: 'public', significance: 'SECRET-SIGNIFICANCE', availableInRound: 1 }],
  }],
  timeline: [
    { time: '00:00', event: 'PUBLIC-EVENT', involvedCharacters: [], isPublicKnowledge: true },
    { time: '00:05', event: 'SECRET-EVENT', involvedCharacters: [], isPublicKnowledge: false },
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const pub = JSON.stringify(toScenarioPublic(scenario));
check('hides case.truth/method/motive', !pub.includes('SECRET-TRUTH') && !pub.includes('SECRET-METHOD') && !pub.includes('SECRET-MOTIVE'));
check('hides privateScript', !pub.includes('SECRET-SCRIPT'));
check('hides isKiller flag', !JSON.stringify(toScenarioPublic(scenario).characters).includes('isKiller'));
check('hides alibi.truth + secrets', !pub.includes('SECRET-ALIBI') && !pub.includes('SECRET-1'));
check('hides privateRelation', !pub.includes('SECRET-REL'));
check('hides clue.significance', !pub.includes('SECRET-SIGNIFICANCE'));
check('drops non-public timeline events', pub.includes('PUBLIC-EVENT') && !pub.includes('SECRET-EVENT'));
check('public locations carry no clues', toScenarioPublic(scenario).locations.every(location => !('clues' in location)));

const playing = {
  ...getRoom(room.id)!,
  status: 'in_progress', currentPhase: 'DISCUSSION_1',
  players: [{ ...getRoom(room.id)!.players[0], assignedCharacterId: 'killer' }],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const playerId = playing.players[0].id;
const view = projectRoomForPlayer(playing, scenario, playerId)!;
const viewBlob = JSON.stringify(view);
check('own character private script is visible to its player', view.yourCharacter?.privateScript === 'SECRET-SCRIPT-K');
check('other character private script is NOT leaked', !viewBlob.includes('SECRET-SCRIPT-O'));
check('case.truth is NOT leaked pre-reveal', !viewBlob.includes('SECRET-TRUTH'));
check('no reveal payload pre-reveal', view.reveal === undefined);

const reveal = projectRoomForPlayer({ ...playing, currentPhase: 'REVEAL' }, scenario, playerId)!;
check('REVEAL exposes truth + killer id', reveal.reveal?.truth === 'SECRET-TRUTH' && reveal.reveal?.killerCharacterId === 'killer');

console.log('Projected roster hides real player ids (KI-034):');
// Two-member room: Alice (host) requests /state; Bob is the other player.
const twoPlayerRoom = {
  ...getRoom(room.id)!,
  status: 'in_progress',
  currentPhase: 'DISCUSSION_1',
  players: [
    { id: 'AUTH-ID-ALICE', publicId: 'pub-alice', name: 'Alice', isHost: true, connected: true, joinedAt: 1, assignedCharacterId: 'killer' },
    { id: 'AUTH-ID-BOB', publicId: 'pub-bob', name: 'Bob', isHost: false, connected: true, joinedAt: 2, assignedCharacterId: 'other' },
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const aliceRoster = projectRoomForPlayer(twoPlayerRoom, scenario, 'AUTH-ID-ALICE')!.room.players;
const rosterBlob = JSON.stringify(aliceRoster);
check("projected players[] never leak another player's real auth id", !rosterBlob.includes('AUTH-ID-BOB'));
check('projected players[] carry no real auth ids at all', !rosterBlob.includes('AUTH-ID-ALICE') && !rosterBlob.includes('AUTH-ID-BOB'));
check('projected players[] expose publicId as the render key', aliceRoster.every(p => Boolean(p.publicId)) && aliceRoster.some(p => p.publicId === 'pub-bob'));
check('isSelf marks the requester and only the requester', aliceRoster.filter(p => p.isSelf).length === 1 && aliceRoster.find(p => p.publicId === 'pub-alice')?.isSelf === true && aliceRoster.find(p => p.publicId === 'pub-bob')?.isSelf === false);

console.log('Seat auth tokens (KI-034):');
const { signToken, verifyToken } = await import('../lib/room/auth.ts');
const validToken = signToken('room-1', 'player-A');
check('verifyToken returns the playerId for a valid token', verifyToken('room-1', validToken) === 'player-A');
check('verifyToken rejects a valid token replayed against a different room', verifyToken('room-2', validToken) === null);
const foreignToken = signToken('room-1', 'player-B');
const tamperedToken = `player-A.${foreignToken.slice(foreignToken.indexOf('.') + 1)}`;
check('verifyToken rejects a tampered/foreign token (claim player-A with player-B signature)', verifyToken('room-1', tamperedToken) === null);
check('verifyToken rejects empty and malformed tokens', verifyToken('room-1', '') === null && verifyToken('room-1', 'garbage') === null && verifyToken('room-1', undefined) === null);

console.log('NPC system prompt (KI-037 public facts / KI-040 injection guard):');
const { buildNPCSystemPrompt } = await import('../lib/agents/prompts/npc-base.ts');
const npcMemory = {
  characterId: 'killer', privateScript: 'SECRET-SCRIPT-K', publicProfile: 'pub', objectives: [],
  conversations: [], discoveredClues: [], knownFacts: [], suspicions: [], emotionalState: '平静',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const npcPrompt = buildNPCSystemPrompt(
  scenario.characters[0], // the killer, in full
  npcMemory,
  { phase: 'DISCUSSION_1', knownClues: [], emotionalState: '平静' },
  scenario.characters,
  toScenarioPublic(scenario),
);
// KI-037 — the public case facts every human already sees must be in the NPC prompt.
check('prompt has 案件公开事实 section', npcPrompt.includes('案件公开事实'));
check('prompt has public victim/scene/time', npcPrompt.includes('study') && npcPrompt.includes('00:00'));
check('prompt has public background story', npcPrompt.includes('背景故事'));
check('prompt has public timeline event', npcPrompt.includes('PUBLIC-EVENT'));
check('prompt has own claimed alibi', npcPrompt.includes('claimed') && npcPrompt.includes('不在场证明'));
// KI-040 — the injection guard + player-speech delimiter must be present.
check('prompt has injection guard section', npcPrompt.includes('安全与角色守则'));
check('guard references <玩家发言> delimiter', npcPrompt.includes('<玩家发言>'));
check('guard warns about fake 主持人 + REVEAL', npcPrompt.includes('主持人') && npcPrompt.includes('REVEAL'));
// Isolation — the built prompt must NEVER leak the solution or another character's secrets.
check('prompt hides case.truth/method/motive', !npcPrompt.includes('SECRET-TRUTH') && !npcPrompt.includes('SECRET-METHOD') && !npcPrompt.includes('SECRET-MOTIVE'));
check('prompt hides own alibi.truth', !npcPrompt.includes('SECRET-ALIBI'));
check('prompt hides other character private script', !npcPrompt.includes('SECRET-SCRIPT-O'));
check('prompt hides other character secrets', !npcPrompt.includes('SECRET-2'));
check('prompt hides clue.significance', !npcPrompt.includes('SECRET-SIGNIFICANCE'));
check('prompt hides non-public timeline event', !npcPrompt.includes('SECRET-EVENT'));
// The NPC's OWN private script is intentionally present (allowed — it drives its own role-play).
check('prompt includes own private script', npcPrompt.includes('SECRET-SCRIPT-K'));

console.log('C7 private-chat memory isolation (KI-039) + labeling (KI-015) + C10 memory bounds (KI-021):');
const { initializeMemory, appendConversation, compactConversationsIfNeeded, updateSuspicion, setEmotionalState, deriveGroupTurnReaction, applyGroupTurnReaction } = await import('../lib/game-engine/memory-manager.ts');

const npcX = scenario.characters[1]; // 'other' — an NPC a player privately chats with
const SENTINEL_A = 'ALPHA-PRIVATE-SENTINEL-9f3a2'; // player A's private line to NPC X — must never leak

// Baseline: shared memory starts empty, exactly as the game initializes it.
const freshX = initializeMemory(npcX);
check('C7 setup: fresh shared NPC memory has no conversations', freshX.conversations.length === 0);

// Positive control (makes the assertion non-vacuous + documents the OLD leak): the PRE-fix private-chat
// route appended the private turn into SHARED memory. If it still did, the sentinel WOULD render into
// NPC X's prompt shown to ANY player — proving the sentinel is detectable and the old write was a real
// player-to-player leak.
const leakedX = appendConversation(freshX, { role: 'player', content: SENTINEL_A, characterId: npcX.id });
const leakedPrompt = buildNPCSystemPrompt(npcX, leakedX, { phase: 'DISCUSSION_1', knownClues: [], emotionalState: '平静' }, scenario.characters, toScenarioPublic(scenario));
check('C7 control: the pre-fix shared-memory write WOULD leak A private line into the prompt', leakedPrompt.includes(SENTINEL_A));

// FIXED behavior: the private-chat route now writes A's turn ONLY to privateChats[`A:X`]; the shared
// characterMemories[X] is left untouched. Mirror that exact persistence.
const threadKeyAX = `player-A:${npcX.id}`;
const roomAfterPrivate = {
  characterMemories: { [npcX.id]: freshX }, // unchanged — the fix removed the shared-memory write
  // Group context is rendered from groupChatHistory; it holds only public group lines, never a private turn.
  groupChatHistory: [{ id: 'g1', role: 'player', characterId: npcX.id, playerId: 'player-B', content: 'PUBLIC-GROUP-LINE', timestamp: 3 }],
  privateChats: {
    [threadKeyAX]: [
      { id: 'm1', role: 'player', characterId: npcX.id, playerId: 'player-A', content: SENTINEL_A, timestamp: 1 },
      { id: 'm2', role: 'npc', characterId: npcX.id, content: 'ok', timestamp: 2 },
    ],
  },
};
const sharedX = roomAfterPrivate.characterMemories[npcX.id];
check('C7: A private line is absent from NPC X shared memory', !JSON.stringify(sharedX.conversations).includes(SENTINEL_A));
// Player B builds NPC X's prompt from the SHARED memory (B's own private thread with X is empty).
const promptForB = buildNPCSystemPrompt(npcX, sharedX, { phase: 'DISCUSSION_1', knownClues: [], emotionalState: '平静' }, scenario.characters, toScenarioPublic(scenario));
check('C7: NPC X prompt for player B does not surface A private line', !promptForB.includes(SENTINEL_A));
check('C7: group chat history holds only public lines, not A private line', JSON.stringify(roomAfterPrivate.groupChatHistory).includes('PUBLIC-GROUP-LINE') && !JSON.stringify(roomAfterPrivate.groupChatHistory).includes(SENTINEL_A));
check('C7: A own isolated thread still retains the line (what A sees / feeds A history)', JSON.stringify(roomAfterPrivate.privateChats[threadKeyAX]).includes(SENTINEL_A));

// C7 secondary (KI-015): appendConversation labels speaker + channel + the real round.
const labeled = appendConversation(initializeMemory(npcX), { role: 'player', content: 'hi', characterId: npcX.id, speakerName: '张三', channel: 'group', round: 3 });
check('C7: appendConversation labels [群聊] speaker + records the real round', labeled.conversations[0].summary === '[群聊] 张三: hi' && labeled.conversations[0].round === 3);
const legacy = appendConversation(initializeMemory(npcX), { role: 'player', content: 'hi', characterId: npcX.id });
check('C7: appendConversation stays backward-compatible without labels', legacy.conversations[0].summary === '玩家: hi' && legacy.conversations[0].round === 0);

// C10 (KI-021): shared memory growth is bounded via offline-safe compaction.
let growingX = initializeMemory(npcX);
for (let i = 0; i < 25; i += 1) {
  growingX = appendConversation(growingX, { role: 'npc', content: `line-${i}`, characterId: npcX.id, speakerName: npcX.name, channel: 'group', round: 1 });
}
check('C10 setup: unbounded group appends grow past the threshold', growingX.conversations.length === 25);
const compactedX = await compactConversationsIfNeeded(growingX, 20);
check('C10: compaction bounds the shared conversation array', compactedX.conversations.length < growingX.conversations.length && compactedX.conversations.length <= 20);
check('C10: compacted summary retains recent content (offline last-N join)', compactedX.conversations.some(item => item.summary.includes('line-24')));
check('C10: below-threshold memory is returned unchanged (no needless rewrite)', (await compactConversationsIfNeeded(freshX, 20)) === freshX);

console.log('D4 emotion + group-turn suspicion (KI-010):');
// updateSuspicion — clamp to [0,10], append reasons to an existing record, create a record when absent.
const suspFresh = initializeMemory(npcX); // 'other' has no relationships → suspicions start empty
check('D4 setup: fresh memory has no suspicions', suspFresh.suspicions.length === 0);
const suspNew = updateSuspicion(suspFresh, 'killer', 4, 'REASON-NEW');
const suspNewRec = suspNew.suspicions.find(r => r.characterId === 'killer');
check('D4 updateSuspicion creates a record for an absent target', Boolean(suspNewRec) && suspNewRec!.level === 4 && suspNewRec!.reasons.includes('REASON-NEW'));
const suspAppend = updateSuspicion(suspNew, 'killer', 2, 'REASON-2');
const suspAppendRec = suspAppend.suspicions.find(r => r.characterId === 'killer');
check('D4 updateSuspicion appends the reason to an existing record (and adds to level)', suspAppendRec!.reasons.length === 2 && suspAppendRec!.reasons.includes('REASON-NEW') && suspAppendRec!.reasons.includes('REASON-2') && suspAppendRec!.level === 6);
check('D4 updateSuspicion clamps a new record up to 10', updateSuspicion(suspFresh, 'killer', 999, 'HI').suspicions.find(r => r.characterId === 'killer')!.level === 10);
check('D4 updateSuspicion clamps an existing record up to 10', updateSuspicion(suspAppend, 'killer', 999, 'MORE').suspicions.find(r => r.characterId === 'killer')!.level === 10);
check('D4 updateSuspicion clamps an existing record down to 0', updateSuspicion(suspNew, 'killer', -999, 'LOW').suspicions.find(r => r.characterId === 'killer')!.level === 0);

// setEmotionalState — new memory on change, SAME ref (no-op) when unchanged.
const emoBase = initializeMemory(npcX);
const emoSet = setEmotionalState(emoBase, '慌乱');
check('D4 setEmotionalState returns a new memory carrying the given state', emoSet.emotionalState === '慌乱' && emoSet !== emoBase);
check('D4 setEmotionalState is a no-op (same ref) when the state is unchanged', setEmotionalState(emoBase, emoBase.emotionalState) === emoBase);

// deriveGroupTurnReaction — cornered on a naming accusation, null on benign/empty text.
const accusationText = `我怀疑${npcX.name}就是凶手`;
const reaction = deriveGroupTurnReaction({ selfName: npcX.name, triggerText: accusationText, accuserCharacterId: 'killer', accuserName: 'K' });
check('D4 deriveGroupTurnReaction corners the NPC on a naming accusation (delta>0, flustered state)', reaction !== null && reaction!.cornered === true && reaction!.suspicionDelta > 0 && reaction!.emotionalState === '慌乱');
check('D4 deriveGroupTurnReaction reason names the accuser (public display name only)', reaction!.suspicionReason.includes('K'));
check('D4 deriveGroupTurnReaction returns null on benign text', deriveGroupTurnReaction({ selfName: npcX.name, triggerText: '今天天气不错啊', accuserName: 'K' }) === null);
check('D4 deriveGroupTurnReaction returns null on empty text', deriveGroupTurnReaction({ selfName: npcX.name, triggerText: '', accuserName: 'K' }) === null);
check('D4 deriveGroupTurnReaction returns null when the NPC is named without an accusation keyword', deriveGroupTurnReaction({ selfName: npcX.name, triggerText: `${npcX.name}你好啊`, accuserName: 'K' }) === null);

// applyGroupTurnReaction end-to-end — raises the accuser's suspicion + flips emotion; benign turn
// de-escalates emotion one notch toward the baseline and leaves suspicion untouched.
const applied = applyGroupTurnReaction(initializeMemory(npcX), { selfName: npcX.name, triggerText: accusationText, accuserCharacterId: 'killer', accuserName: 'K' });
const appliedRec = applied.suspicions.find(r => r.characterId === 'killer');
check('D4 applyGroupTurnReaction raises the accuser suspicion level', Boolean(appliedRec) && appliedRec!.level > 0);
check('D4 applyGroupTurnReaction flips emotionalState to the cornered state', applied.emotionalState === '慌乱' && applied.emotionalState !== initializeMemory(npcX).emotionalState);
check('D4 applyGroupTurnReaction records the accuser CHARACTER id (never a player id)', applied.suspicions.every(r => r.characterId === 'killer'));
const cornered = setEmotionalState(initializeMemory(npcX), '慌乱');
const deescalated = applyGroupTurnReaction(cornered, { selfName: npcX.name, triggerText: '大家先冷静一下', accuserCharacterId: 'killer', accuserName: 'K' });
check('D4 applyGroupTurnReaction de-escalates emotion one notch on a benign turn', deescalated.emotionalState === '戒备');
check('D4 applyGroupTurnReaction does not raise suspicion on a benign turn', deescalated.suspicions.length === 0);
check('D4 applyGroupTurnReaction steps emotion back to the calm baseline on a further benign turn', applyGroupTurnReaction(deescalated, { selfName: npcX.name, triggerText: '继续说吧', accuserName: 'K' }).emotionalState === '警惕');

// buildNPCSystemPrompt renders the NPC's OWN suspicions + cornered-defense guidance, filters self.
const SUSPICION_SENTINEL = 'SUSPICION-REASON-SENTINEL-7c1d9';
const SELF_SUSPICION_SENTINEL = 'SELF-SUSPICION-SHOULD-NOT-RENDER-3e8f1';
const suspicionMemory = {
  characterId: 'killer', privateScript: 'SECRET-SCRIPT-K', publicProfile: 'pub', objectives: [],
  conversations: [], discoveredClues: [], knownFacts: [],
  suspicions: [
    { characterId: 'other', level: 7, reasons: [SUSPICION_SENTINEL] }, // toward another character → rendered
    { characterId: 'killer', level: 9, reasons: [SELF_SUSPICION_SENTINEL] }, // self → must be filtered out
  ],
  emotionalState: '慌乱',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const suspicionPrompt = buildNPCSystemPrompt(
  scenario.characters[0], // the killer
  suspicionMemory,
  { phase: 'DISCUSSION_1', knownClues: [], emotionalState: '慌乱' },
  scenario.characters,
  toScenarioPublic(scenario),
);
check('D4 prompt has the 你此刻的怀疑 section', suspicionPrompt.includes('你此刻的怀疑'));
check('D4 prompt renders the seeded suspicion reason', suspicionPrompt.includes(SUSPICION_SENTINEL));
check('D4 prompt renders the cornered-defense guidance', suspicionPrompt.includes('越被逼到墙角越要辩得凶'));
check('D4 prompt never renders a self-suspicion', !suspicionPrompt.includes(SELF_SUSPICION_SENTINEL));
check('D4 prompt still hides the solution + another character secrets', !suspicionPrompt.includes('SECRET-TRUTH') && !suspicionPrompt.includes('SECRET-SCRIPT-O') && !suspicionPrompt.includes('SECRET-2') && !suspicionPrompt.includes('SECRET-SIGNIFICANCE') && !suspicionPrompt.includes('SECRET-EVENT'));

// Isolation lock — emotion/suspicion are NPC-internal + SERVER-ONLY: they must NEVER reach a client.
// Seed a room's characterMemories with distinctive sentinels, then serialize-scan the whole projection.
const EMOTION_SENTINEL = 'EMOTION-STATE-SENTINEL-4b8e2';
const SUSPICION_LOCK_SENTINEL = 'SUSPICION-LOCK-SENTINEL-1a2b3';
const memRoom = {
  ...playing,
  characterMemories: {
    killer: {
      characterId: 'killer', privateScript: 'SECRET-SCRIPT-K', publicProfile: 'pub', objectives: [],
      conversations: [], discoveredClues: [], knownFacts: [],
      suspicions: [{ characterId: 'other', level: 8, reasons: [SUSPICION_LOCK_SENTINEL] }],
      emotionalState: EMOTION_SENTINEL,
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const memBlob = JSON.stringify(projectRoomForPlayer(memRoom, scenario, playerId));
check('D4 isolation: NPC emotionalState never reaches a client projection', !memBlob.includes(EMOTION_SENTINEL));
check('D4 isolation: NPC suspicion reason never reaches a client projection', !memBlob.includes(SUSPICION_LOCK_SENTINEL));

console.log('Realtime bus:');
const { publish, subscribe, markConnected, markDisconnected } = await import('../lib/realtime/room-bus.ts');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const received: any[] = [];
const unsub = subscribe('room-x', event => received.push(event));
publish('room-x', { type: 'phase_change', phase: 'VOTING', round: 3 });
publish('room-other', { type: 'reveal' });
check('subscriber receives events for its own room', received.length === 1 && received[0].type === 'phase_change');
check('subscriber is isolated from other rooms', !received.some(event => event.type === 'reveal'));
unsub();
publish('room-x', { type: 'reveal' });
check('unsubscribe stops delivery', received.length === 1);

console.log('D2 seat takeover predicate (seatsToTakeOver):');
const NOW = 1_000_000;
const IDLE = 90_000;
// Matrix room: one seat per case. characterControl drives which seats are candidates; players carry the
// connect/disconnect state. seatsToTakeOver ignores `scenario`, so arbitrary seat ids are fine here.
const takeoverRoom = {
  players: [
    { id: 'P_CONN', publicId: 'pc', name: 'Conn', isHost: false, connected: true, joinedAt: 1, assignedCharacterId: 'seatA', lastSeenAt: NOW },
    { id: 'P_IDLE', publicId: 'pi', name: 'Idle', isHost: false, connected: false, disconnectedAt: NOW - 100_000, lastSeenAt: NOW - 100_000, joinedAt: 2, assignedCharacterId: 'seatB' },
    { id: 'P_RECENT', publicId: 'pr', name: 'Recent', isHost: false, connected: false, disconnectedAt: NOW - 10_000, lastSeenAt: NOW - 10_000, joinedAt: 3, assignedCharacterId: 'seatC' },
    { id: 'P_UNASSIGNED', publicId: 'pu', name: 'Unassigned', isHost: false, connected: false, disconnectedAt: NOW - 100_000, joinedAt: 4 },
  ],
  characterControl: {
    seatA: { kind: 'human', playerId: 'P_CONN' },      // connected human → excluded
    seatB: { kind: 'human', playerId: 'P_IDLE' },      // disconnected past idle → INCLUDED
    seatC: { kind: 'human', playerId: 'P_RECENT' },    // within idle grace → excluded
    seatD: { kind: 'npc' },                            // npc seat → excluded
    seatE: { kind: 'human', playerId: 'P_UNASSIGNED' },// controller not seated here (unassigned) → excluded
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const seats = seatsToTakeOver(takeoverRoom, NOW, IDLE);
check('seatsToTakeOver includes a disconnected-past-idle human seat', seats.includes('seatB'));
check('seatsToTakeOver excludes a connected human seat', !seats.includes('seatA'));
check('seatsToTakeOver excludes a within-idle disconnect', !seats.includes('seatC'));
check('seatsToTakeOver excludes an npc seat', !seats.includes('seatD'));
check('seatsToTakeOver excludes an unassigned/mismatched seat', !seats.includes('seatE'));
check('seatsToTakeOver returns ONLY the past-idle seat', seats.length === 1 && seats[0] === 'seatB');

console.log('D2 host handoff (reassignHost):');
const hostRoom = {
  hostPlayerId: 'H',
  players: [
    { id: 'H', publicId: 'pub-h', name: 'Host', isHost: true, connected: false, disconnectedAt: NOW - 100_000, joinedAt: 1 },
    { id: 'A', publicId: 'pub-a', name: 'A', isHost: false, connected: true, joinedAt: 2 },
    { id: 'B', publicId: 'pub-b', name: 'B', isHost: false, connected: true, joinedAt: 3 },
  ],
  characterControl: {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const reassigned = reassignHost(hostRoom);
check('reassignHost moves hostPlayerId to the earliest-joined connected human', reassigned?.hostPlayerId === 'A');
check('reassignHost moves the isHost flag to the successor and clears it elsewhere',
  reassigned?.players.find((p: { id: string }) => p.id === 'A')?.isHost === true &&
  reassigned?.players.find((p: { id: string }) => p.id === 'H')?.isHost === false &&
  reassigned?.players.find((p: { id: string }) => p.id === 'B')?.isHost === false);
const noneConnectedRoom = {
  ...hostRoom,
  players: hostRoom.players.map((p: Record<string, unknown>) => ({ ...p, connected: false, disconnectedAt: NOW - 100_000 })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
check('reassignHost returns null when no connected human exists', reassignHost(noneConnectedRoom) === null);

console.log('D2 projection presence + controlledByNpc + hostPublicId (+ D1 drawer data contract):');
// Requester is a NON-host connected human seated on `other`. The host is disconnected and their `killer`
// seat has been taken over by an NPC (takenOverFromPlayerId = the host's real id).
const d2Room = {
  ...getRoom(room.id)!,
  status: 'in_progress',
  currentPhase: 'DISCUSSION_1',
  hostPlayerId: 'AUTH-HOST',
  players: [
    { id: 'AUTH-HOST', publicId: 'pub-host', name: 'HostP', isHost: true, connected: false, disconnectedAt: NOW - 5000, lastSeenAt: NOW, joinedAt: 1, assignedCharacterId: 'killer' },
    { id: 'AUTH-REQ', publicId: 'pub-req', name: 'ReqP', isHost: false, connected: true, lastSeenAt: NOW, joinedAt: 2, assignedCharacterId: 'other' },
  ],
  characterControl: {
    killer: { kind: 'npc', takenOverFromPlayerId: 'AUTH-HOST' },
    other: { kind: 'human', playerId: 'AUTH-REQ' },
  },
  publicClues: [{ id: 'pc1', content: 'PUBLIC-CLUE-CONTENT', type: 'public', significance: 'SECRET-SIGNIFICANCE-2', availableInRound: 1 }],
  discoveredClues: {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const d2View = projectRoomForPlayer(d2Room, scenario, 'AUTH-REQ')!;
const d2Roster = d2View.room.players;
const hostPub = d2Roster.find(p => p.publicId === 'pub-host')!;
const reqPub = d2Roster.find(p => p.publicId === 'pub-req')!;
check('projection: disconnected player shows connected=false', hostPub.connected === false);
check('projection: connected player shows connected=true', reqPub.connected === true);
check('projection: controlledByNpc is true for an NPC-taken-over seat', hostPub.controlledByNpc === true);
check('projection: controlledByNpc is false for a human seat', reqPub.controlledByNpc === false);
check("projection: room.hostPublicId is the host's publicId (not their real id)", d2View.room.hostPublicId === 'pub-host');
// Serialize-and-scan: NO real player id except the requester's own (in `you`), including the host's id
// and the taken-over player's id (both are 'AUTH-HOST'); and no server-only presence fields.
const d2Blob = JSON.stringify(d2View);
check("serialize-scan: host's real id never appears (hostPublicId + takenOverFromPlayerId both hidden)", !d2Blob.includes('AUTH-HOST'));
check('serialize-scan: no disconnectedAt / lastSeenAt reach the client', !d2Blob.includes('disconnectedAt') && !d2Blob.includes('lastSeenAt'));
check('serialize-scan: the requester keeps their own auth id in `you` (by design)', d2View.you.id === 'AUTH-REQ');
// D1 drawer data-contract locks (these fields must survive for a later FE drawer).
check('D1: scenario.setting exposes era/location/atmosphere/backgroundStory', d2View.scenario.setting.era === 'e' && d2View.scenario.setting.location === 'l' && d2View.scenario.setting.atmosphere === 'a' && d2View.scenario.setting.backgroundStory === 'b');
check('D1: scenario.case keeps public fields and drops truth/method/motive',
  d2View.scenario.case.victim === 'V' && d2View.scenario.case.causeOfDeath === 'C' && d2View.scenario.case.timeOfDeath === '00:00' && d2View.scenario.case.crimeScene === 'study' &&
  !('truth' in d2View.scenario.case) && !('murderMethod' in d2View.scenario.case) && !('motive' in d2View.scenario.case));
check('D1: scenario.timeline includes the public event and excludes the secret one', d2View.scenario.timeline.some(e => e.event === 'PUBLIC-EVENT') && !d2View.scenario.timeline.some(e => e.event === 'SECRET-EVENT'));
check('D1: yourCharacter.privateScript is the requester own script', d2View.yourCharacter?.privateScript === 'SECRET-SCRIPT-O');
check('D1: the OTHER character secret script/truth never appear in the view', !d2Blob.includes('SECRET-SCRIPT-K') && !d2Blob.includes('SECRET-TRUTH'));
check('D1: room.publicClues and room.yourClues are arrays', Array.isArray(d2View.room.publicClues) && Array.isArray(d2View.room.yourClues));

console.log('D2 takeover NPC memory seed (public clues only, no significance):');
// Mirror takeOverSeatAsNpc's seed step (room-engine is not strip-types loadable, so replicate its pure
// public-clue merge here over initializeMemory).
const takeoverChar = scenario.characters[0]; // 'killer'
let takeoverMem = initializeMemory(takeoverChar);
const takeoverPublicClues = [
  { id: 'pcA', content: 'PUB-CLUE-A', type: 'public', significance: 'SECRET-SIG-A', availableInRound: 1 },
  { id: 'pcB', content: 'PUB-CLUE-B', type: 'public', significance: 'SECRET-SIG-B', availableInRound: 1 },
];
const seededFacts = [...takeoverMem.knownFacts];
for (const clue of takeoverPublicClues) {
  const fact = `公共线索：${clue.content}`;
  if (!seededFacts.includes(fact)) {
    seededFacts.push(fact);
  }
}
takeoverMem = { ...takeoverMem, knownFacts: seededFacts };
check('takeover memory has a 公共线索 entry per public clue', takeoverPublicClues.every(c => takeoverMem.knownFacts.includes(`公共线索：${c.content}`)));
check('takeover memory carries NO clue.significance', !JSON.stringify(takeoverMem).includes('SECRET-SIG'));

console.log('D2 room-bus connection refcount (markConnected / markDisconnected):');
const rc1 = markConnected('rc-room', 'rc-player');
check('refcount: first markConnected → firstConnection true (0→1)', rc1.firstConnection === true);
const rc2 = markConnected('rc-room', 'rc-player');
check('refcount: second markConnected → firstConnection false (1→2)', rc2.firstConnection === false);
const rd1 = markDisconnected('rc-room', 'rc-player');
check('refcount: markDisconnected once → lastConnection false (2→1)', rd1.lastConnection === false);
const rd2 = markDisconnected('rc-room', 'rc-player');
check('refcount: second markDisconnected → lastConnection true (1→0)', rd2.lastConnection === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
