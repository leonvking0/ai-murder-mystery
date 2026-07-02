// Regression tests for the reveal2 gameplay features:
//   - B2 faction win/loss: buildReveal (via projectRoomForPlayer at REVEAL) computes youWereKiller +
//     outcome for BOTH a killer-player and a detective-player, under groupCorrect true/false, and the
//     tally aggregates NPC votes (keyed `npc:<characterId>`).
//   - B5 present-clue: presentClue rejects an undiscovered clue; on success it makes the clue public,
//     merges the fact into every NPC's knownFacts, posts a system message, and is idempotent — and the
//     pre-REVEAL projection of that now-public clue carries NO GM-only `significance`.
// Run: node --experimental-strip-types tests/gameplay-reveal.test.ts   (no extra deps)

import path from 'node:path';

process.env.ROOM_AUTH_SECRET ??= 'test-secret-for-seat-auth';
process.env.DATABASE_PATH ??= path.join('/tmp', `mm-reveal-test-${process.pid}.db`);

const { projectRoomForPlayer, tallyVotes, connectedHumanVoteState, applyTieRevote } = await import('../lib/scenarios/projection.ts');
const { presentClue, investigateRoom, INVESTIGATION_BUDGET } = await import('../lib/game-engine/room-investigation.ts');
const { validateScenario } = await import('../lib/scenarios/schema.ts');

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

// ---- Fixtures ----

function makeCharacter(id: string, isKiller: boolean) {
  return {
    id,
    name: `角色-${id}`,
    age: 30,
    occupation: 'o',
    personality: 'p',
    speakingStyle: 's',
    publicInfo: 'pub',
    privateScript: `SCRIPT-${id}`,
    isKiller,
    relationships: [],
    objectives: [{ description: 'o', type: 'primary', isSecret: false }],
    alibi: { claimed: 'c', truth: `ALIBI-${id}` },
    secrets: [`SECRET-${id}`],
  };
}

const scenario = {
  id: 'x',
  title: 'T',
  description: 'D',
  playerCount: { min: 1, max: 4 },
  difficulty: 'medium',
  estimatedDuration: 60,
  setting: { era: 'e', location: 'l', atmosphere: 'a', backgroundStory: 'b' },
  case: {
    victim: 'V', causeOfDeath: 'C', timeOfDeath: '00:00', crimeScene: 'study',
    truth: 'SECRET-TRUTH', murderMethod: 'SECRET-METHOD', motive: 'SECRET-MOTIVE',
  },
  characters: [makeCharacter('k', true), makeCharacter('d', false)],
  locations: [{ id: 'study', name: '书房', description: 'd', clues: [] }],
  timeline: [{ time: '00:00', event: 'PUBLIC-EVENT', involvedCharacters: [], isPublicKnowledge: true }],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function baseRoom(overrides: Record<string, unknown>) {
  return {
    id: 'room-1',
    code: 'ABCDE',
    scenarioId: 'x',
    status: 'in_progress',
    currentPhase: 'DISCUSSION_1',
    round: 1,
    hostPlayerId: 'P-KILLER',
    players: [
      { id: 'P-KILLER', publicId: 'pk', name: '真凶玩家', isHost: true, connected: true, joinedAt: 1, assignedCharacterId: 'k' },
      { id: 'P-DET', publicId: 'pd', name: '侦探玩家', isHost: false, connected: true, joinedAt: 2, assignedCharacterId: 'd' },
    ],
    characterControl: {
      k: { kind: 'human', playerId: 'P-KILLER' },
      d: { kind: 'human', playerId: 'P-DET' },
    },
    characterMemories: {},
    discoveredClues: {},
    publicClues: [],
    groupChatHistory: [],
    privateChats: {},
    votes: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ---- B2: faction win/loss ----

console.log('B2 buildReveal outcome (groupCorrect = true, majority accused the killer):');
{
  const room = baseRoom({ currentPhase: 'REVEAL', votes: { 'P-KILLER': 'k', 'P-DET': 'k' } });
  const killerView = projectRoomForPlayer(room, scenario, 'P-KILLER')!;
  const detView = projectRoomForPlayer(room, scenario, 'P-DET')!;
  check('groupCorrect is true', killerView.reveal?.groupCorrect === true);
  check('killer-player: youWereKiller true', killerView.reveal?.youWereKiller === true);
  check('killer-player LOSES when caught', killerView.reveal?.outcome === 'loss');
  check('detective-player: youWereKiller false', detView.reveal?.youWereKiller === false);
  check('detective-player WINS when killer caught', detView.reveal?.outcome === 'win');
}

console.log('B2 buildReveal outcome (groupCorrect = false, killer escaped):');
{
  const room = baseRoom({ currentPhase: 'REVEAL', votes: { 'P-KILLER': 'd', 'P-DET': 'd' } });
  const killerView = projectRoomForPlayer(room, scenario, 'P-KILLER')!;
  const detView = projectRoomForPlayer(room, scenario, 'P-DET')!;
  check('groupCorrect is false', killerView.reveal?.groupCorrect === false);
  check('killer-player WINS by escaping', killerView.reveal?.outcome === 'win');
  check('detective-player LOSES when killer escapes', detView.reveal?.outcome === 'loss');
}

console.log('B2 tally aggregates npc:-keyed votes:');
{
  const room = baseRoom({
    currentPhase: 'REVEAL',
    votes: { 'P-DET': 'k', 'npc:x': 'k', 'npc:y': 'd' },
  });
  const view = projectRoomForPlayer(room, scenario, 'P-DET')!;
  const tally = view.reveal!.tally;
  const kVotes = tally.find(entry => entry.characterId === 'k')?.votes;
  const dVotes = tally.find(entry => entry.characterId === 'd')?.votes;
  check('killer tally counts human + npc votes (=2)', kVotes === 2);
  check('detective tally counts the npc vote (=1)', dVotes === 1);
  check('accused = killer (npc votes tipped the majority)', view.reveal?.accusedCharacterId === 'k');
  check('groupCorrect true from npc-inclusive tally', view.reveal?.groupCorrect === true);
}

// ---- D5b: per-ballot tally at REVEAL (keyed by CHARACTER, never playerId) ----

console.log('D5b buildReveal.ballots maps every voter to a character id (human + npc):');
{
  // Human P-KILLER plays character 'k'; an NPC seat 'd' also votes. Both accuse the killer 'k'.
  const room = baseRoom({ currentPhase: 'REVEAL', votes: { 'P-KILLER': 'k', 'npc:d': 'k' } });
  const view = projectRoomForPlayer(room, scenario, 'P-DET')!;
  const ballots = view.reveal!.ballots;

  check(
    'ballot: the human vote is keyed by their assignedCharacterId (k), not their playerId',
    ballots.some(b => b.voterCharacterId === 'k' && b.accusedCharacterId === 'k'),
  );
  check(
    'ballot: the npc:d vote resolves to character d',
    ballots.some(b => b.voterCharacterId === 'd' && b.accusedCharacterId === 'k'),
  );
  check('ballots.length === number of mappable vote keys (2)', ballots.length === 2);

  // Isolation guard: every voterCharacterId is a known cast id; NONE is a real player.id.
  const knownIds = new Set(scenario.characters.map((c: { id: string }) => c.id));
  const forbiddenPlayerIds = new Set(['P-KILLER', 'P-DET']);
  check('ballot: every voterCharacterId is a known scenario character id', ballots.every(b => knownIds.has(b.voterCharacterId)));
  check('ballot: every accusedCharacterId is a known scenario character id', ballots.every(b => knownIds.has(b.accusedCharacterId)));
  check(
    'ballot: NO voterCharacterId equals a real player.id (isolation)',
    ballots.every(b => !forbiddenPlayerIds.has(b.voterCharacterId)),
  );
  const blob = JSON.stringify(view.reveal!.ballots);
  check('ballot: raw playerId "P-KILLER" never appears in the ballots blob', !blob.includes('P-KILLER'));

  // The aggregate tally is unchanged by adding ballots.
  const kVotes = view.reveal!.tally.find((e: { characterId: string }) => e.characterId === 'k')?.votes;
  const dVotes = view.reveal!.tally.find((e: { characterId: string }) => e.characterId === 'd')?.votes;
  check('tally unchanged: killer k has both votes (=2)', kVotes === 2);
  check('tally unchanged: d has no votes (=0)', dVotes === 0);
}

console.log('D5b ballots resolve a TAKEN-OVER seat via assignedCharacterId (never the raw playerId):');
{
  // 'd' was taken over by an NPC (D2): control is now npc, but the disconnected human P-DET still holds
  // assignedCharacterId 'd' and had already voted. Their ballot must map to 'd', never leak 'P-DET'.
  const room = baseRoom({
    currentPhase: 'REVEAL',
    votes: { 'P-KILLER': 'k', 'P-DET': 'd' },
    players: [
      { id: 'P-KILLER', publicId: 'pk', name: '真凶玩家', isHost: true, connected: true, joinedAt: 1, assignedCharacterId: 'k' },
      { id: 'P-DET', publicId: 'pd', name: '侦探玩家', isHost: false, connected: false, joinedAt: 2, assignedCharacterId: 'd' },
    ],
    characterControl: {
      k: { kind: 'human', playerId: 'P-KILLER' },
      d: { kind: 'npc', takenOverFromPlayerId: 'P-DET' },
    },
  });
  const view = projectRoomForPlayer(room, scenario, 'P-KILLER')!;
  const ballots = view.reveal!.ballots;
  check(
    'taken-over seat: P-DET\'s ballot maps to character d',
    ballots.some(b => b.voterCharacterId === 'd' && b.accusedCharacterId === 'd'),
  );
  check('taken-over seat: no ballot voterCharacterId equals the raw playerId P-DET', ballots.every(b => b.voterCharacterId !== 'P-DET'));
  check('taken-over seat: ballots.length === 2', ballots.length === 2);
  check('taken-over seat: no raw playerId in the ballots blob', !JSON.stringify(ballots).includes('P-DET') && !JSON.stringify(ballots).includes('P-KILLER'));
}

console.log('D5b ballots DROP any vote key that maps to no character (never emit a raw playerId):');
{
  const room = baseRoom({
    currentPhase: 'REVEAL',
    votes: {
      'P-KILLER': 'k',        // mappable human → k
      'npc:d': 'k',           // mappable npc → d
      'GHOST-PLAYER': 'k',    // unknown playerId → dropped
      'npc:ghost': 'k',       // unknown npc character → dropped
      'P-DET': 'ghost',       // accused not a known character → dropped
    },
  });
  const view = projectRoomForPlayer(room, scenario, 'P-KILLER')!;
  const ballots = view.reveal!.ballots;
  check('drop: only the 2 mappable ballots survive', ballots.length === 2);
  check('drop: unknown playerId "GHOST-PLAYER" produced no ballot', !JSON.stringify(ballots).includes('GHOST-PLAYER'));
  check('drop: unknown npc character produced no ballot', !ballots.some(b => b.voterCharacterId === 'ghost'));
  check('drop: a non-character accused produced no ballot', !ballots.some(b => b.accusedCharacterId === 'ghost'));
}

// ---- B5: present clue ----

function memory(characterId: string) {
  return {
    characterId, privateScript: `SCRIPT-${characterId}`, publicProfile: 'pub', objectives: [],
    conversations: [], discoveredClues: [], knownFacts: [], suspicions: [], emotionalState: '平静',
  };
}

const clueA = {
  id: 'cA', content: '门闩内侧有血指纹', type: 'private',
  significance: 'SECRET-SIGNIFICANCE', availableInRound: 1, foundAt: '书房',
};

console.log('B5 presentClue rejects an undiscovered clue:');
{
  const room = baseRoom({
    characterMemories: { k: memory('k'), d: memory('d') },
    discoveredClues: { 'P-KILLER': [clueA] },
  });
  let threw = false;
  try {
    presentClue(room, scenario, 'P-DET', 'cA'); // P-DET never discovered it
  } catch {
    threw = true;
  }
  check('throws when clue not in that player\'s notebook', threw === true);

  let threwMissing = false;
  try {
    presentClue(room, scenario, 'P-KILLER', 'does-not-exist');
  } catch {
    threwMissing = true;
  }
  check('throws for an id nobody discovered', threwMissing === true);
}

console.log('B5 presentClue publishes the clue to the whole table:');
{
  const room = baseRoom({
    characterMemories: { k: memory('k'), d: memory('d') },
    discoveredClues: { 'P-KILLER': [clueA] },
  });
  const { room: next, systemMessages } = presentClue(room, scenario, 'P-KILLER', 'cA');

  check('clue added to publicClues', next.publicClues.some((c: { id: string }) => c.id === 'cA'));
  check('exactly one system message emitted', systemMessages.length === 1);
  check('system message is role=system', systemMessages[0]?.role === 'system');
  check(
    'system message tags the presenter + content',
    systemMessages[0]?.content === '【出示线索·真凶玩家】门闩内侧有血指纹',
  );
  check('system message appended to group chat', next.groupChatHistory.some((m: { id: string }) => m.id === systemMessages[0].id));
  const fact = '公共线索：门闩内侧有血指纹';
  check('merged into EVERY NPC knownFacts', Object.values(next.characterMemories).every((m) => (m as { knownFacts: string[] }).knownFacts.includes(fact)));

  // Idempotent: presenting the same clue again is a no-op.
  const again = presentClue(next, scenario, 'P-KILLER', 'cA');
  check('idempotent: no new system message', again.systemMessages.length === 0);
  check('idempotent: publicClues unchanged', again.room.publicClues.length === next.publicClues.length);

  // Isolation: the raw engine room still carries significance internally...
  check('sanity: engine room still holds significance internally', JSON.stringify(next.publicClues).includes('SECRET-SIGNIFICANCE'));

  // ...but the PRE-REVEAL projection of the public clue strips it (via toClueView).
  const projected = projectRoomForPlayer({ ...next, currentPhase: 'DISCUSSION_1' }, scenario, 'P-DET')!;
  const blob = JSON.stringify(projected);
  check('presented clue is visible in projected publicClues', projected.room.publicClues.some(c => c.id === 'cA'));
  check('projection of the presented clue carries NO significance', !blob.includes('SECRET-SIGNIFICANCE'));
  check('no reveal payload pre-REVEAL', projected.reveal === undefined);
}

// ---- C9: voting integrity — the connected-human gate (Batch C / KI-043) ----
// canAdvanceRoom itself can't be loaded under `--experimental-strip-types` (room-engine.ts pulls in an
// @/-value chain memory-manager → llm-provider). Its VOTING gate delegates to connectedHumanVoteState,
// so exercising that predicate validates the gate: "false when a connected human hasn't voted, true
// when all voted." (The host `force` override is a one-line bypass of exactly this predicate.)

console.log('C9 connected-human vote gate (the predicate canAdvanceRoom composes):');
{
  const noneVoted = baseRoom({ currentPhase: 'VOTING', votes: {} });
  const s0 = connectedHumanVoteState(noneVoted);
  check('gate: 2 connected humans detected', s0.connectedHumanCount === 2);
  check('gate: nobody voted yet → not all voted', s0.humansVotedCount === 0 && s0.allHumansVoted === false);

  const oneVoted = baseRoom({ currentPhase: 'VOTING', votes: { 'P-KILLER': 'd', 'npc:z': 'k' } });
  const s1 = connectedHumanVoteState(oneVoted);
  check('gate: false when a connected human still hasn\'t voted', s1.allHumansVoted === false);
  check('gate: an npc vote does NOT count as a human vote', s1.humansVotedCount === 1);

  const allVoted = baseRoom({ currentPhase: 'VOTING', votes: { 'P-KILLER': 'd', 'P-DET': 'k' } });
  const s2 = connectedHumanVoteState(allVoted);
  check('gate: true when every connected human has voted', s2.allHumansVoted === true && s2.humansVotedCount === 2);

  const withDisconnected = baseRoom({
    currentPhase: 'VOTING',
    votes: { 'P-KILLER': 'd' },
    players: [
      { id: 'P-KILLER', publicId: 'pk', name: '真凶玩家', isHost: true, connected: true, joinedAt: 1, assignedCharacterId: 'k' },
      { id: 'P-DET', publicId: 'pd', name: '侦探玩家', isHost: false, connected: false, joinedAt: 2, assignedCharacterId: 'd' },
    ],
  });
  const s3 = connectedHumanVoteState(withDisconnected);
  check('gate: disconnected humans are excluded from the gate', s3.connectedHumanCount === 1 && s3.allHumansVoted === true);
}

// ---- C9: tie detection + the one-revote transition ----

console.log('C9 tie detection + single-revote transition:');
{
  const tie = baseRoom({ currentPhase: 'VOTING', votes: { 'P-KILLER': 'k', 'P-DET': 'd' } });
  const t = tallyVotes(tie, scenario);
  check('tie: isTie true when the top count is shared', t.isTie === true);
  check('tie: no sole accused on a tie', t.accusedCharacterId === null);
  check('tie: both characters are leaders', t.leaders.length === 2);

  const clear = baseRoom({ currentPhase: 'VOTING', votes: { 'P-KILLER': 'k', 'P-DET': 'k', 'npc:z': 'd' } });
  const c = tallyVotes(clear, scenario);
  check('no tie: sole leader wins (npc votes counted in the tally)', c.isTie === false && c.accusedCharacterId === 'k');

  const { room: revoted, message } = applyTieRevote(tie);
  check('revote: votes cleared', Object.keys(revoted.votes).length === 0);
  check('revote: voteRevoteCount set to 1', revoted.voteRevoteCount === 1);
  check('revote: phase stays VOTING (no advance to REVEAL)', revoted.currentPhase === 'VOTING');
  check('revote: GM prompt appended to group chat', revoted.groupChatHistory.some((m) => m.id === message.id));
  check(
    'revote: GM prompt is a system message with the expected copy',
    message.role === 'system' && message.content === '本轮出现平票，请重新投票并给出证据链。',
  );
  // Only ONE revote is granted: once voteRevoteCount >= 1, a persistent tie must fall through to REVEAL.
  const secondTie = { ...revoted, votes: { 'P-KILLER': 'k', 'P-DET': 'd' } };
  check('revote: a second tie is NOT eligible for another revote', (secondTie.voteRevoteCount ?? 0) >= 1);
}

// ---- C8: per-phase investigation budget (KI-042) ----

console.log('C8 per-phase investigation budget:');
{
  check('INVESTIGATION_BUDGET is 2', INVESTIGATION_BUDGET === 2);

  const room = baseRoom({ currentPhase: 'INVESTIGATION_1', characterMemories: {} });
  const first = investigateRoom(room, scenario, 'P-DET', 'study');
  check('1st search records a budget unit', first.room.investigationCounts?.['P-DET:INVESTIGATION_1'] === 1);

  const second = investigateRoom(first.room, scenario, 'P-DET', 'study');
  check('2nd search records the second unit', second.room.investigationCounts?.['P-DET:INVESTIGATION_1'] === 2);

  let threw = false;
  try {
    investigateRoom(second.room, scenario, 'P-DET', 'study');
  } catch (e) {
    threw = e instanceof Error && e.message === '本阶段搜证次数已用完';
  }
  check('3rd search throws once the budget is exhausted', threw === true);

  // Budget is per-(player, phase): a different player is unaffected...
  const other = investigateRoom(second.room, scenario, 'P-KILLER', 'study');
  check('another player has an independent budget', other.room.investigationCounts?.['P-KILLER:INVESTIGATION_1'] === 1);

  // ...and the count resets in the next investigation phase.
  const nextPhase = investigateRoom({ ...second.room, currentPhase: 'INVESTIGATION_2' }, scenario, 'P-DET', 'study');
  check('budget resets in INVESTIGATION_2', nextPhase.room.investigationCounts?.['P-DET:INVESTIGATION_2'] === 1);
  check('INVESTIGATION_1 count untouched by the INVESTIGATION_2 search', nextPhase.room.investigationCounts?.['P-DET:INVESTIGATION_1'] === 2);
}

// ---- C8 + C9: projection exposes the new public-safe fields and still leaks nothing secret ----

console.log('C8+C9 projection exposes new fields (public-safe, no secret leak):');
{
  const room = baseRoom({
    currentPhase: 'VOTING',
    votes: { 'P-KILLER': 'd' }, // only the killer-player has voted so far
    voteRevoteCount: 1,
    investigationCounts: { 'P-DET:INVESTIGATION_1': 2, 'P-KILLER:INVESTIGATION_1': 1 },
  });
  const view = projectRoomForPlayer(room, scenario, 'P-DET')!;
  check('projects investigationBudget = 2', view.room.investigationBudget === 2);
  check('yourInvestigationsThisPhase defaults to 0 (no VOTING-phase searches)', view.room.yourInvestigationsThisPhase === 0);
  check('connectedHumanCount = 2', view.room.connectedHumanCount === 2);
  check('humansVotedCount = 1 (only the killer-player voted)', view.room.humansVotedCount === 1);
  check('allHumansVoted = false', view.room.allHumansVoted === false);
  check('voteRevoteCount projected = 1', view.room.voteRevoteCount === 1);

  // yourInvestigationsThisPhase tracks the CURRENT phase for the requester.
  const invView = projectRoomForPlayer({ ...room, currentPhase: 'INVESTIGATION_1' }, scenario, 'P-DET')!;
  check('yourInvestigationsThisPhase reflects INVESTIGATION_1 count (=2)', invView.room.yourInvestigationsThisPhase === 2);

  // Isolation: the new fields (and the raw votes / investigationCounts maps) never leak solution secrets,
  // another player's vote choice, or player-id-keyed internals pre-reveal.
  const blob = JSON.stringify(view);
  check(
    'no case truth/method/motive leaked',
    !blob.includes('SECRET-TRUTH') && !blob.includes('SECRET-METHOD') && !blob.includes('SECRET-MOTIVE'),
  );
  check(
    'no other character\'s private script/secret/alibi leaked',
    !blob.includes('SCRIPT-k') && !blob.includes('SECRET-k') && !blob.includes('ALIBI-k'),
  );
  check('no clue significance leaked', !blob.includes('SECRET-SIGNIFICANCE'));
  check('raw votes map is not projected (no pre-reveal who-voted-for-whom)', (view.room as Record<string, unknown>).votes === undefined && view.room.voteCount === 1);
  check('investigationCounts map (player-id-keyed) is not projected', !blob.includes(':INVESTIGATION_1'));
  check('no reveal payload pre-REVEAL', view.reveal === undefined);
}

// ---- D6: fuzzy hint + prerequisite gating (investigateRoom) ----
// A dedicated scenario whose 书房 holds two ungated private clues (p1, c1) and one clue (c2) gated behind
// c1. 'SECRET-SIGNIFICANCE' is the sentinel that MUST never surface in the fuzzy hint.
const d6Study = {
  id: 'study',
  name: '书房',
  description: 'd',
  clues: [
    { id: 'p1', content: '书桌抽屉里的私人信件', type: 'private', significance: 'SECRET-SIGNIFICANCE', availableInRound: 1 },
    { id: 'c1', content: '壁炉里的灰烬', type: 'private', significance: 'SIG-C1', availableInRound: 1 },
    { id: 'c2', content: '灰烬下的钥匙', type: 'private', significance: 'SIG-C2', availableInRound: 1, prerequisite: 'c1' },
  ],
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const d6Scenario = { ...scenario, locations: [d6Study] } as any;

console.log('D6 fuzzy hint + prerequisite gating (investigateRoom):');
{
  const room = baseRoom({ currentPhase: 'INVESTIGATION_1', characterMemories: {} });

  // Search 1: finds the ungated private clues; the gated c2 is withheld (its prerequisite c1 is unknown).
  const s1 = investigateRoom(room, d6Scenario, 'P-DET', 'study');
  const s1ids = s1.result.newlyFound.map((c: { id: string }) => c.id);
  check('gating: an ungated (no-prerequisite) clue is always offered', s1ids.includes('c1') && s1ids.includes('p1'));
  check('gating: a gated clue is ABSENT until its prerequisite is found', !s1ids.includes('c2'));

  // Fuzzy hint: exactly one content-free system message naming ONLY 书房.
  const hints = s1.systemMessages.filter((m: { content: string }) => m.content.includes('似乎发现了什么线索'));
  check('fuzzy hint: exactly one hint when a search yields ≥1 NEW private clue', hints.length === 1);
  check('fuzzy hint: role is system', hints[0]?.role === 'system');
  check('fuzzy hint: names the (public) location 书房', hints[0]?.content.includes('书房') === true);
  check('fuzzy hint: leaks NO clue significance sentinel', !hints[0]?.content.includes('SECRET-SIGNIFICANCE'));
  check(
    'fuzzy hint: leaks NO private clue content',
    !hints[0]?.content.includes('书桌抽屉里的私人信件') && !hints[0]?.content.includes('壁炉里的灰烬'),
  );
  check(
    'fuzzy hint: leaks NO clue id or finder playerId',
    !hints[0]?.content.includes('p1') && !hints[0]?.content.includes('P-DET'),
  );
  check(
    'fuzzy hint: appended to nextRoom.groupChatHistory',
    s1.room.groupChatHistory.some((m: { id: string }) => m.id === hints[0].id),
  );

  // Search 2 (fresh phase → fresh budget): c1 is now in the player's OWN known set, so gated c2 unlocks.
  const s2 = investigateRoom({ ...s1.room, currentPhase: 'INVESTIGATION_2' }, d6Scenario, 'P-DET', 'study');
  const s2ids = s2.result.newlyFound.map((c: { id: string }) => c.id);
  check('gating: the gated clue c2 is returned once its prerequisite c1 has been discovered', s2ids.includes('c2'));
  check(
    'fuzzy hint: fires again for the newly-unlocked c2',
    s2.systemMessages.filter((m: { content: string }) => m.content.includes('似乎发现了什么线索')).length === 1,
  );

  // Search 3 (same INVESTIGATION_2, budget remaining): nothing new → NO hint, but budget still increments.
  const s3 = investigateRoom(s2.room, d6Scenario, 'P-DET', 'study');
  check('a search that finds no NEW private clue returns zero newly-found clues', s3.result.newlyFound.length === 0);
  check(
    'a search finding no NEW private clue produces NO fuzzy hint',
    s3.systemMessages.filter((m: { content: string }) => m.content.includes('似乎发现了什么线索')).length === 0,
  );
  check('budget still increments even when a search returns zero clues', s3.room.investigationCounts?.['P-DET:INVESTIGATION_2'] === 2);
}

// ---- D6: validateScenario prerequisite-graph validation (schema.ts) ----

console.log('D6 schema: clue prerequisite-graph validation:');
{
  function schemaChar(id: string, isKiller: boolean) {
    return {
      id, name: `角色-${id}`, age: 30, occupation: '职业', personality: '性格', speakingStyle: '语气',
      publicInfo: '公开信息'.repeat(20), // ≥ 50 chars
      privateScript: '私密剧本内容'.repeat(30), // ≥ 100 chars
      isKiller, relationships: [],
      objectives: [{ description: '目标', type: 'primary', isSecret: false }],
      alibi: { claimed: '声称', truth: '真相' }, secrets: ['秘密'],
    };
  }
  function makeSchemaScenario(clues: unknown[]) {
    return {
      id: 's', title: 'T', description: 'D',
      playerCount: { min: 1, max: 4 }, difficulty: 'medium', estimatedDuration: 60,
      setting: { era: 'e', location: 'l', atmosphere: 'a', backgroundStory: 'b' },
      case: { victim: 'V', causeOfDeath: 'C', timeOfDeath: '00:00', crimeScene: 'study', truth: 'T', murderMethod: 'M', motive: 'Mo' },
      characters: [schemaChar('k', true), schemaChar('d', false)],
      locations: [{ id: 'study', name: '书房', description: 'd', clues }],
      phases: [], timeline: [],
    };
  }
  const clue = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, content: `内容-${id}`, type: 'private', significance: `SIG-${id}`, availableInRound: 1, ...extra });

  function throwsValidate(clues: unknown[]): boolean {
    try {
      validateScenario(makeSchemaScenario(clues));
      return false;
    } catch (e) {
      return e instanceof Error;
    }
  }

  check(
    'accepts a valid acyclic prerequisite chain c1→c2→c3',
    !throwsValidate([clue('c1'), clue('c2', { prerequisite: 'c1' }), clue('c3', { prerequisite: 'c2' })]),
  );
  check('throws on an unknown prerequisite reference', throwsValidate([clue('c1', { prerequisite: 'ghost' })]));
  check('throws on a duplicate global clue id', throwsValidate([clue('dup'), clue('dup')]));
  check(
    'throws on a prerequisite cycle (c1↔c2)',
    throwsValidate([clue('c1', { prerequisite: 'c2' }), clue('c2', { prerequisite: 'c1' })]),
  );
  check('throws on a non-string prerequisite', throwsValidate([clue('c1', { prerequisite: 123 })]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
