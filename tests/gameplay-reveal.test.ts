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

const { projectRoomForPlayer } = await import('../lib/scenarios/projection.ts');
const { presentClue } = await import('../lib/game-engine/room-investigation.ts');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
