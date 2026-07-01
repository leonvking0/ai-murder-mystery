// Regression tests for the multiplayer foundation:
//   - SQLite room store: persistence + atomic read-modify-write
//   - Per-player projection: information isolation (KI-001) — the game's #1 rule
// Run: npm test   (node --experimental-strip-types; no extra deps)

import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH ??= path.join(os.tmpdir(), `mm-test-${Date.now()}.db`);

const { createRoom, getRoom, getRoomByCode, updateRoom } = await import('../lib/store/rooms.ts');
const { projectRoomForPlayer, toScenarioPublic } = await import('../lib/scenarios/projection.ts');

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

console.log('Realtime bus:');
const { publish, subscribe } = await import('../lib/realtime/room-bus.ts');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
