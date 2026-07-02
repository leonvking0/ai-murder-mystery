// Server-side projections that enforce information isolation (KI-001).
// Clients NEVER receive case.truth, isKiller, other characters' privateScript/alibi.truth/
// secrets/privateRelation, clue.significance, or non-public timeline — except the full reveal,
// which is only attached when the room is in the REVEAL phase.

import { randomUUID } from 'node:crypto';

// Relative + explicit `.ts` for the strip-types test runner (the `@/` alias only resolves for type-only
// imports there; see tests/info-isolation.test.ts). Value imports here MUST stay relative so this module
// remains loadable offline — do NOT value-import room-engine.ts (its @/-value chain would break tests).
import { INVESTIGATION_BUDGET } from '../game-engine/room-investigation.ts';
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
      // C8: per-phase investigation budget + how many searches THIS player has spent this phase.
      investigationBudget: INVESTIGATION_BUDGET,
      yourInvestigationsThisPhase: room.investigationCounts?.[`${playerId}:${room.currentPhase}`] ?? 0,
      // C9: public-safe vote-progress counts (never who voted for whom pre-reveal) + tie-revote counter.
      ...connectedHumanVoteState(room),
      voteRevoteCount: room.voteRevoteCount ?? 0,
    },
    you,
    scenario: toScenarioPublic(scenario),
    yourCharacter,
    reveal: isReveal ? buildReveal(room, scenario, playerId) : undefined,
  };
}

// ---- Voting helpers (pure; shared by buildReveal, the advance route, and room-engine's VOTING gate) ----
//
// These live here — not in room-engine.ts — on purpose: room-engine.ts pulls in an @/-value chain
// (memory-manager → llm-provider) that the `--experimental-strip-types` test runner cannot resolve, so
// importing it into this module would break the offline tests that load projection.ts. This module has
// only relative/type-only value imports and stays test-loadable. The advance route and room-engine
// import these back through the `@/` alias (resolved fine by the Next bundler).

/**
 * Tally every vote in the room (including NPC votes, keyed `npc:<characterId>`) over the scenario cast.
 * `tally` lists ALL characters sorted by descending votes; `leaders` are the characterIds sharing the
 * top >0 count; `accusedCharacterId` is the sole leader (null on no-votes or a tie); `isTie` is true
 * when more than one character shares the top count.
 */
export function tallyVotes(
  room: Room,
  scenario: Scenario,
): { tally: { characterId: string; votes: number }[]; leaders: string[]; accusedCharacterId: string | null; isTie: boolean } {
  const tallyMap = new Map<string, number>();
  for (const accusedId of Object.values(room.votes)) {
    tallyMap.set(accusedId, (tallyMap.get(accusedId) ?? 0) + 1);
  }
  const tally = scenario.characters
    .map(character => ({ characterId: character.id, votes: tallyMap.get(character.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes);

  const topVotes = tally[0]?.votes ?? 0;
  const leaders = topVotes > 0 ? tally.filter(entry => entry.votes === topVotes).map(entry => entry.characterId) : [];
  const accusedCharacterId = leaders.length === 1 ? leaders[0] : null;
  const isTie = leaders.length > 1;

  return { tally, leaders, accusedCharacterId, isTie };
}

// "Connected humans" = players who hold a character seat and are connected. NPCs are not players.
function connectedHumans(room: Room): Room['players'] {
  return room.players.filter(player => Boolean(player.assignedCharacterId) && player.connected);
}

/**
 * Public-safe vote-progress read-model: how many connected humans there are, how many have cast a vote
 * (their playerId key is present in room.votes), and whether all have. Vacuously true with zero humans.
 * This is exactly the predicate room-engine's VOTING gate consumes, so testing it validates that gate.
 */
export function connectedHumanVoteState(
  room: Room,
): { connectedHumanCount: number; humansVotedCount: number; allHumansVoted: boolean } {
  const humans = connectedHumans(room);
  const humansVotedCount = humans.filter(player => room.votes[player.id] !== undefined).length;
  return {
    connectedHumanCount: humans.length,
    humansVotedCount,
    allHumansVoted: humansVotedCount === humans.length,
  };
}

/**
 * Pure tie-revote transition (C9 / KI-043): clear all votes, mark that the one allowed revote has been
 * granted (voteRevoteCount = 1), and append a GM system message prompting a re-vote. Phase is left
 * unchanged by the caller (it stays VOTING). Returns the next room plus the GM message to broadcast.
 */
export function applyTieRevote(room: Room): { room: Room; message: ChatMessage } {
  const message: ChatMessage = {
    id: randomUUID(),
    role: 'system',
    content: '本轮出现平票，请重新投票并给出证据链。',
    timestamp: Date.now(),
  };
  return {
    room: {
      ...room,
      votes: {},
      voteRevoteCount: 1,
      groupChatHistory: [...room.groupChatHistory, message],
    },
    message,
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

  // Reuse the shared tally so the reveal, the advance-route tie check, and the projection all agree.
  const { tally, accusedCharacterId } = tallyVotes(room, scenario);

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
