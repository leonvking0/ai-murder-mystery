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
  ObjectiveScore,
  Player,
  PlayerRoomView,
  PublicPlayer,
  Room,
  Scenario,
  ScenarioPublic,
  ScoreCard,
} from '@/types/game';

// Sanitize a chat message for a client (KI-066): the real (secret) authoring `playerId` is the seat
// credential and must never leave the server on a message. Strip it and, for a human-authored message,
// attach the author's non-secret `publicId` instead (clients detect their own messages via
// `authorPublicId === you.publicId`). Non-human messages (npc/gm/system) carry no playerId and pass through.
export function toPublicMessage(message: ChatMessage, publicIdByPlayerId: Map<string, string>): ChatMessage {
  if (message.playerId === undefined) {
    return message;
  }
  const sanitized: ChatMessage = { ...message, authorPublicId: publicIdByPlayerId.get(message.playerId) };
  delete sanitized.playerId;
  return sanitized;
}

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
// `controlledByNpc` reflects whether this player's assigned seat is currently AI-driven (a
// disconnected human's seat that got taken over shows as NPC-controlled) — public-safe.
function toPublicPlayer(
  player: Room['players'][number],
  requestingPlayerId: string,
  characterControl: Room['characterControl'],
): PublicPlayer {
  const controlledByNpc = player.assignedCharacterId
    ? characterControl[player.assignedCharacterId]?.kind === 'npc'
    : false;
  return {
    publicId: player.publicId,
    name: player.name,
    isHost: player.isHost,
    connected: player.connected,
    assignedCharacterId: player.assignedCharacterId,
    controlledByNpc,
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

  // `you` is the requester's own full Player. Its `id` (their own auth credential) is theirs to hold,
  // but the D2 presence bookkeeping (`disconnectedAt` / `lastSeenAt`) is SERVER-ONLY — strip it so it
  // never reaches any client, not even the player it describes (see KNOWN-ISSUES info-isolation rule).
  const youSafe: Player = { ...you };
  delete youSafe.disconnectedAt;
  delete youSafe.lastSeenAt;

  const isReveal = room.currentPhase === 'REVEAL';

  // Map every member's real playerId → their non-secret publicId, so messages can be sanitized before
  // they leave the server (KI-066): a chat message's real `playerId` is the seat credential and must
  // never reach another client.
  const publicIdByPlayerId = new Map(room.players.map(player => [player.id, player.publicId]));

  // The requesting player's private threads, keyed by the COUNTERPART character. F5: this merges
  // (a) OUTGOING threads they own (`me:character`, NPC or human target) with (b) INCOMING threads where
  // another human messaged the character THEY play (`otherPlayer:myCharacter`), so a human↔human chat
  // reads as one conversation. Isolation: a player only ever sees `me:*` (theirs) and `*:myCharacter`
  // (addressed to them) — never a third party's thread — and every message is sanitized (playerId →
  // publicId, KI-066) so a counterpart's seat credential never leaks.
  const myCharacterId = you.assignedCharacterId;
  const characterByPlayerId = new Map(room.players.map(player => [player.id, player.assignedCharacterId]));
  const yourPrivateChats: Record<string, ChatMessage[]> = {};
  const appendThread = (bucketCharacterId: string, messages: ChatMessage[]): void => {
    const sanitized = messages.map(message => toPublicMessage(message, publicIdByPlayerId));
    yourPrivateChats[bucketCharacterId] = [...(yourPrivateChats[bucketCharacterId] ?? []), ...sanitized];
  };
  for (const [key, messages] of Object.entries(room.privateChats)) {
    const [ownerId, characterId] = key.split(':');
    if (!characterId) {
      continue;
    }
    if (ownerId === playerId) {
      appendThread(characterId, messages); // (a) outgoing — I messaged this character.
    } else if (myCharacterId && characterId === myCharacterId) {
      // (b) incoming — another human messaged my character; bucket under THEIR character so it merges
      // with my outgoing thread to them into a single conversation.
      const counterpartCharacterId = characterByPlayerId.get(ownerId);
      if (counterpartCharacterId) {
        appendThread(counterpartCharacterId, messages);
      }
    }
  }
  // Interleave outgoing + incoming per counterpart by time so the merged thread reads in order.
  for (const bucket of Object.values(yourPrivateChats)) {
    bucket.sort((a, b) => a.timestamp - b.timestamp);
  }

  return {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      currentPhase: room.currentPhase,
      round: room.round,
      // Publish the host's non-secret render id, never their real `hostPlayerId` (KI-034 leak fix).
      hostPublicId: room.players.find(player => player.id === room.hostPlayerId)?.publicId ?? '',
      players: room.players.map(player => toPublicPlayer(player, playerId, room.characterControl)),
      publicClues: room.publicClues.map(toClueView),
      yourClues: (room.discoveredClues[playerId] ?? []).map(toClueView),
      // KI-066: sanitize every group message so a human speaker's real playerId (the seat credential)
      // is replaced with their publicId before it reaches any client.
      groupChatHistory: room.groupChatHistory.map(message => toPublicMessage(message, publicIdByPlayerId)),
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
    you: youSafe,
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

// ---- D2 disconnect takeover + host handoff (pure; consumed by room-engine) ----
//
// These live here (not room-engine.ts) for the same reason as the voting helpers above: this module is
// loadable under `--experimental-strip-types` (relative/type-only value imports only), room-engine.ts
// is not. room-engine.ts imports these back through `@/` and composes them with the LLM-touching bits.

/**
 * Characters whose HUMAN controller has been disconnected at least `idleMs` and should be handed to an
 * NPC. A seat qualifies iff: it is a `human`-controlled seat, its controlling player actually holds it
 * (assigned), that player is disconnected (`connected === false` or a `disconnectedAt` is recorded),
 * we have a `disconnectedAt` timestamp to measure from, and `now - disconnectedAt >= idleMs`. Connected
 * humans, within-idle disconnects, NPC seats, and unassigned/lobby seats are all excluded.
 */
export function seatsToTakeOver(room: Room, now: number, idleMs: number): string[] {
  const playerById = new Map(room.players.map(player => [player.id, player]));
  const result: string[] = [];
  for (const [characterId, control] of Object.entries(room.characterControl)) {
    if (control.kind !== 'human') {
      continue; // NPC seat — nothing to take over.
    }
    const player = playerById.get(control.playerId);
    if (!player || player.assignedCharacterId !== characterId) {
      continue; // Controller missing or not actually seated here (unassigned) — skip.
    }
    const disconnected = player.connected === false || player.disconnectedAt !== undefined;
    if (!disconnected) {
      continue; // Still connected — keep the human in control.
    }
    if (player.disconnectedAt === undefined) {
      continue; // No timestamp to measure idle from — be conservative and wait.
    }
    if (now - player.disconnectedAt < idleMs) {
      continue; // Within the idle grace window — not yet.
    }
    result.push(characterId);
  }
  return result;
}

/**
 * If the current host is disconnected or absent, return a room whose host (`hostPlayerId` + the players'
 * `isHost` flags) is moved to the EARLIEST-JOINED CONNECTED human — i.e. the first still-connected
 * player in join order (the `players` array is join-ordered). Returns null when the host is fine or when
 * no connected human exists (host left unchanged). Pure; callers gate on the idle threshold separately.
 */
export function reassignHost(room: Room): Room | null {
  const currentHost = room.players.find(player => player.id === room.hostPlayerId);
  const hostPresent =
    currentHost !== undefined && currentHost.connected !== false && currentHost.disconnectedAt === undefined;
  if (hostPresent) {
    return null; // Host is connected — no handoff needed.
  }

  const successor = room.players.find(
    player => player.connected !== false && player.disconnectedAt === undefined,
  );
  if (!successor) {
    return null; // Nobody connected to hand off to — leave the host unchanged.
  }

  return {
    ...room,
    hostPlayerId: successor.id,
    players: room.players.map(player => ({ ...player, isHost: player.id === successor.id })),
  };
}

function buildReveal(room: Room, scenario: Scenario, playerId: string): PlayerRoomView['reveal'] {
  const killer = scenario.characters.find(character => character.isKiller);

  const playerNameById = new Map(room.players.map(player => [player.id, player.name]));
  const cast = scenario.characters.map(character => {
    const control = room.characterControl[character.id];
    // Attribute the seat to its human: the current human controller, or — if a disconnected human's
    // seat was taken over by an NPC (D2) — the ORIGINAL human via `takenOverFromPlayerId`. A seat that
    // was always an NPC has no human name (null).
    let playerName: string | null = null;
    if (control?.kind === 'human') {
      playerName = playerNameById.get(control.playerId) ?? null;
    } else if (control?.kind === 'npc' && control.takenOverFromPlayerId) {
      playerName = playerNameById.get(control.takenOverFromPlayerId) ?? null;
    }
    return { characterId: character.id, playerName };
  });

  // Reuse the shared tally so the reveal, the advance-route tie check, and the projection all agree.
  const { tally, accusedCharacterId } = tallyVotes(room, scenario);

  // Per-ballot breakdown (D5b), keyed BY CHARACTER — a raw playerId must NEVER land here (isolation).
  // Known scenario character ids gate BOTH ends of every ballot.
  const characterIds = new Set(scenario.characters.map(character => character.id));

  // Reverse map: real playerId -> the character they play. Two sources so a taken-over seat still
  // resolves: (1) each player's own `assignedCharacterId`, then (2) `human` characterControl entries
  // (authoritative, applied last). For a seat that was taken over by an NPC (D2), the controlling entry
  // is `npc`, so only source (1) resolves it — the disconnected human still holds `assignedCharacterId`,
  // so their earlier vote maps to their character, never to their raw playerId. Only known character ids
  // are ever inserted, so this map cannot smuggle a playerId into a ballot.
  const characterIdByPlayerId = new Map<string, string>();
  for (const player of room.players) {
    if (player.assignedCharacterId && characterIds.has(player.assignedCharacterId)) {
      characterIdByPlayerId.set(player.id, player.assignedCharacterId);
    }
  }
  for (const [characterId, control] of Object.entries(room.characterControl)) {
    if (control.kind === 'human' && characterIds.has(characterId)) {
      characterIdByPlayerId.set(control.playerId, characterId);
    }
  }

  const ballots: { voterCharacterId: string; accusedCharacterId: string }[] = [];
  for (const [voterKey, accused] of Object.entries(room.votes)) {
    // The vote value is already a characterId; drop anything that isn't a known cast member.
    if (!characterIds.has(accused)) {
      continue;
    }
    let voterCharacterId: string | undefined;
    if (voterKey.startsWith('npc:')) {
      const npcCharacterId = voterKey.slice(4);
      if (characterIds.has(npcCharacterId)) {
        voterCharacterId = npcCharacterId;
      }
    } else {
      // Human vote key = a real (secret) playerId. Resolve it to their character; if it maps to nothing
      // (unknown player / unassigned seat), DROP the ballot rather than ever emit a raw playerId.
      voterCharacterId = characterIdByPlayerId.get(voterKey);
    }
    if (!voterCharacterId) {
      continue;
    }
    ballots.push({ voterCharacterId, accusedCharacterId: accused });
  }

  const groupCorrect = accusedCharacterId !== null && accusedCharacterId === killer?.id;

  // ---- F3: machine-checkable objectives scoreboard ----
  // Computed generically from the already-revealed results only (killer, tally, ballots, accused,
  // groupCorrect, cast). Reads NO private per-character data, so it is isolation-safe and works for every
  // scenario with zero content authoring. One ScoreCard per character, in scenario cast order.
  const votesByCharacter = new Map(tally.map(entry => [entry.characterId, entry.votes]));
  const ballotByVoter = new Map(ballots.map(ballot => [ballot.voterCharacterId, ballot.accusedCharacterId]));
  const playerNameByCharacter = new Map(cast.map(entry => [entry.characterId, entry.playerName]));

  const scoreboard: ScoreCard[] = scenario.characters.map(character => {
    const objectives: ObjectiveScore[] = character.isKiller
      ? [
          // The killer scores by ESCAPING (never票出). No not_accused/vote_correct for the killer.
          { kind: 'escape', label: '逃脱指认（凶手未被票出）', achieved: !groupCorrect, points: 2 },
        ]
      : [
          { kind: 'not_accused', label: '未被集体指认', achieved: accusedCharacterId !== character.id, points: 1 },
          { kind: 'secret_hidden', label: '无人怀疑（零票）', achieved: (votesByCharacter.get(character.id) ?? 0) === 0, points: 1 },
          { kind: 'vote_correct', label: '指认真凶', achieved: ballotByVoter.get(character.id) === killer?.id, points: 1 },
        ];
    const total = objectives.reduce((sum, objective) => (objective.achieved ? sum + objective.points : sum), 0);
    return {
      characterId: character.id,
      playerName: playerNameByCharacter.get(character.id) ?? null,
      isKiller: character.isKiller,
      objectives,
      total,
    };
  });

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
    ballots,
    accusedCharacterId,
    groupCorrect,
    youWereKiller,
    outcome,
    scoreboard,
  };
}
