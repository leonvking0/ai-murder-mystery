// Server-side projections that enforce information isolation (KI-001).
// Clients NEVER receive case.truth, isKiller, other characters' privateScript/alibi.truth/
// secrets/privateRelation, clue.significance, or non-public timeline — except the full reveal,
// which is only attached when the room is in the REVEAL phase.

import type {
  Character,
  CharacterPublic,
  ChatMessage,
  Clue,
  ClueView,
  PlayerRoomView,
  PublicPlayer,
  Room,
  Scenario,
  ScenarioPublic,
} from '@/types/game';

// Strip GM-only fields (significance, round gating) from a clue before sending to a client (KI-006).
export function toClueView(clue: Clue): ClueView {
  return {
    id: clue.id,
    content: clue.content,
    type: clue.type,
    foundAt: clue.foundAt,
  };
}

export function toCharacterPublic(character: Character): CharacterPublic {
  return {
    id: character.id,
    name: character.name,
    age: character.age,
    occupation: character.occupation,
    personality: character.personality,
    speakingStyle: character.speakingStyle,
    avatar: character.avatar,
    publicInfo: character.publicInfo,
    publicRelations: character.relationships.map(relationship => ({
      characterId: relationship.characterId,
      publicRelation: relationship.publicRelation,
    })),
  };
}

export function toScenarioPublic(scenario: Scenario): ScenarioPublic {
  return {
    id: scenario.id,
    title: scenario.title,
    description: scenario.description,
    playerCount: scenario.playerCount,
    difficulty: scenario.difficulty,
    estimatedDuration: scenario.estimatedDuration,
    setting: scenario.setting,
    case: {
      victim: scenario.case.victim,
      causeOfDeath: scenario.case.causeOfDeath,
      timeOfDeath: scenario.case.timeOfDeath,
      crimeScene: scenario.case.crimeScene,
    },
    characters: scenario.characters.map(toCharacterPublic),
    locations: scenario.locations.map(location => ({
      id: location.id,
      name: location.name,
      description: location.description,
      image: location.image,
    })),
    timeline: scenario.timeline.filter(event => event.isPublicKnowledge),
  };
}

// Never expose another player's real `id` (KI-034): it is the seat auth credential. Only the
// non-secret `publicId` (render key) plus a server-set `isSelf` marker for the requesting player.
function toPublicPlayer(player: Room['players'][number], requestingPlayerId: string): PublicPlayer {
  return {
    publicId: player.publicId,
    name: player.name,
    isHost: player.isHost,
    connected: player.connected,
    assignedCharacterId: player.assignedCharacterId,
    isSelf: player.id === requestingPlayerId,
  };
}

/**
 * Build the view a single player is allowed to see. `scenario` is the full (server-only) scenario;
 * only sanitized pieces are returned, plus the requesting player's own character in full.
 */
export function projectRoomForPlayer(
  room: Room,
  scenario: Scenario,
  playerId: string,
): PlayerRoomView | null {
  const you = room.players.find(player => player.id === playerId);
  if (!you) {
    return null;
  }

  const yourCharacter = you.assignedCharacterId
    ? scenario.characters.find(character => character.id === you.assignedCharacterId) ?? null
    : null;

  const isReveal = room.currentPhase === 'REVEAL';

  // Only the requesting player's own private threads.
  const yourPrivateChats: Record<string, ChatMessage[]> = {};
  for (const [key, messages] of Object.entries(room.privateChats)) {
    const [ownerId, characterId] = key.split(':');
    if (ownerId === playerId && characterId) {
      yourPrivateChats[characterId] = messages;
    }
  }

  return {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      currentPhase: room.currentPhase,
      round: room.round,
      hostPlayerId: room.hostPlayerId,
      players: room.players.map(player => toPublicPlayer(player, playerId)),
      publicClues: room.publicClues.map(toClueView),
      yourClues: (room.discoveredClues[playerId] ?? []).map(toClueView),
      groupChatHistory: room.groupChatHistory,
      yourPrivateChats,
      voteCount: Object.keys(room.votes).length,
      youVotedFor: room.votes[playerId],
    },
    you,
    scenario: toScenarioPublic(scenario),
    yourCharacter,
    reveal: isReveal ? buildReveal(room, scenario, playerId) : undefined,
  };
}

function buildReveal(room: Room, scenario: Scenario, playerId: string): PlayerRoomView['reveal'] {
  const killer = scenario.characters.find(character => character.isKiller);

  const playerNameById = new Map(room.players.map(player => [player.id, player.name]));
  const cast = scenario.characters.map(character => {
    const control = room.characterControl[character.id];
    const playerName = control?.kind === 'human' ? playerNameById.get(control.playerId) ?? null : null;
    return { characterId: character.id, playerName };
  });

  const tallyMap = new Map<string, number>();
  for (const accusedId of Object.values(room.votes)) {
    tallyMap.set(accusedId, (tallyMap.get(accusedId) ?? 0) + 1);
  }
  const tally = scenario.characters
    .map(character => ({ characterId: character.id, votes: tallyMap.get(character.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes);

  const topVotes = tally[0]?.votes ?? 0;
  const leaders = tally.filter(entry => entry.votes === topVotes && topVotes > 0);
  const accusedCharacterId = leaders.length === 1 ? leaders[0].characterId : null;

  const groupCorrect = accusedCharacterId !== null && accusedCharacterId === killer?.id;

  // Which character did the requesting player play, and were they the killer?
  const youCharacterId = room.players.find(player => player.id === playerId)?.assignedCharacterId;
  const youWereKiller = Boolean(killer && youCharacterId && youCharacterId === killer.id);

  // Faction win/loss for the requester: the killer wins by ESCAPING (group got it wrong); everyone
  // else wins by catching the killer (group got it right).
  const outcome: 'win' | 'loss' = youWereKiller
    ? (groupCorrect ? 'loss' : 'win')
    : (groupCorrect ? 'win' : 'loss');

  return {
    truth: scenario.case.truth,
    murderMethod: scenario.case.murderMethod,
    motive: scenario.case.motive,
    killerCharacterId: killer?.id ?? '',
    characters: scenario.characters,
    cast,
    tally,
    accusedCharacterId,
    groupCorrect,
    youWereKiller,
    outcome,
  };
}
