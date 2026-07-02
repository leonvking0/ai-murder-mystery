// Pure room transitions: joining the lobby and starting the game with random character assignment.
// Kept pure (no I/O) so routes can run them inside an atomic updateRoom() and so they're testable.

import { randomUUID } from 'node:crypto';

import { initializeMemory } from '@/lib/game-engine/memory-manager';
import { getNextPhase } from '@/lib/game-engine/phase-manager';
import { generatePublicId } from '@/lib/room/auth';
import { connectedHumanVoteState, reassignHost, seatsToTakeOver } from '@/lib/scenarios/projection';
import type { CharacterControl, GamePhase, Player, Room, Scenario } from '@/types/game';

// D2: how long a human's seat may sit disconnected before an NPC takes it over and (if it was the
// host's seat) the host role is handed off. Pinned at 90s — long enough to survive a refresh/reconnect,
// short enough that the table isn't stuck waiting on someone who left.
export const SEAT_TAKEOVER_IDLE_MS = 90_000;

function shuffle<T>(input: T[]): T[] {
  const items = [...input];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function addPlayer(room: Room, name: string): { room: Room; player: Player } {
  const player: Player = {
    id: randomUUID(),
    publicId: generatePublicId(),
    name: name.trim() || `玩家${room.players.length + 1}`,
    isHost: false,
    connected: true,
    joinedAt: Date.now(),
  };

  return {
    room: { ...room, players: [...room.players, player] },
    player,
  };
}

export function maxHumanPlayers(scenario: Scenario): number {
  return scenario.characters.length;
}

/**
 * Randomly assign characters to the human players (join order, shuffled characters). Any character
 * not taken by a human becomes an NPC with initialized memory. The killer may land on a human or NPC.
 */
export function startGame(room: Room, scenario: Scenario): Room {
  const shuffledCharacterIds = shuffle(scenario.characters.map(character => character.id));

  const assignedPlayers: Player[] = room.players.map((player, index) => ({
    ...player,
    assignedCharacterId: shuffledCharacterIds[index],
  }));

  const characterControl: Record<string, CharacterControl> = {};
  const characterMemories: Room['characterMemories'] = {};

  for (const character of scenario.characters) {
    const humanPlayer = assignedPlayers.find(player => player.assignedCharacterId === character.id);

    if (humanPlayer) {
      characterControl[character.id] = { kind: 'human', playerId: humanPlayer.id };
    } else {
      characterControl[character.id] = { kind: 'npc' };
      characterMemories[character.id] = initializeMemory(character);
    }
  }

  return {
    ...room,
    players: assignedPlayers,
    characterControl,
    characterMemories,
    status: 'in_progress',
    currentPhase: 'READING',
    round: 1,
  };
}

function roundForPhase(phase: GamePhase, currentRound: number): number {
  if (phase === 'DISCUSSION_1' || phase === 'INVESTIGATION_1') {
    return 1;
  }
  if (phase === 'DISCUSSION_2' || phase === 'INVESTIGATION_2') {
    return 2;
  }
  if (phase === 'FINAL_DISCUSSION') {
    return 3;
  }
  return currentRound;
}

export function canAdvanceRoom(room: Room, opts?: { force?: boolean }): boolean {
  if (room.status !== 'in_progress') {
    return false;
  }
  const next = getNextPhase(room.currentPhase);
  if (!next) {
    return false;
  }
  // VOTING → REVEAL requires at least one vote AND — unless the host forces it — that every connected
  // human has voted (C9 / KI-043). NPC votes (keyed `npc:<id>`) count toward the tally but not the gate.
  if (room.currentPhase === 'VOTING') {
    if (Object.keys(room.votes).length === 0) {
      return false;
    }
    if (!opts?.force && !connectedHumanVoteState(room).allHumansVoted) {
      return false;
    }
  }
  return true;
}

export function advanceRoom(room: Room, opts?: { force?: boolean }): Room | null {
  if (!canAdvanceRoom(room, opts)) {
    return null;
  }
  const next = getNextPhase(room.currentPhase);
  if (!next) {
    return null;
  }
  return {
    ...room,
    currentPhase: next,
    round: roundForPhase(next, room.round),
    status: next === 'REVEAL' ? 'finished' : room.status,
  };
}

/**
 * Hand a single seat to an NPC (D2). The seat's control becomes `{ kind: 'npc', takenOverFromPlayerId }`
 * remembering the departed human (server-only, used only for reveal attribution). The NPC gets a FRESH
 * memory (`initializeMemory`) seeded with the room's existing PUBLIC clues — content only, exactly like
 * `investigateRoom`'s public-clue merge — so the takeover NPC knows what the table already knows. It
 * NEVER inherits the departed human's private discovered clues, and NEVER sees any `clue.significance`.
 */
export function takeOverSeatAsNpc(room: Room, scenario: Scenario, characterId: string): Room {
  const character = scenario.characters.find(item => item.id === characterId);
  if (!character) {
    return room; // Unknown character — nothing to take over.
  }

  const control = room.characterControl[characterId];
  const takenOverFromPlayerId = control?.kind === 'human' ? control.playerId : undefined;

  // Fresh shared NPC memory seeded with public clues only (mirror investigateRoom's public-clue merge).
  const memory = initializeMemory(character);
  const knownFacts = [...memory.knownFacts];
  for (const clue of room.publicClues) {
    const fact = `公共线索：${clue.content}`;
    if (!knownFacts.includes(fact)) {
      knownFacts.push(fact);
    }
  }

  return {
    ...room,
    characterControl: {
      ...room.characterControl,
      [characterId]: { kind: 'npc', takenOverFromPlayerId },
    },
    characterMemories: {
      ...room.characterMemories,
      [characterId]: { ...memory, knownFacts },
    },
  };
}

/**
 * Compose the pure takeover predicate (`seatsToTakeOver`) with `takeOverSeatAsNpc`: every seat whose
 * human controller has been disconnected past `idleMs` is handed to an NPC. Pure — routes call this
 * inside an atomic `updateRoom`.
 */
export function applyDisconnectTakeovers(room: Room, scenario: Scenario, now: number, idleMs: number): Room {
  let next = room;
  for (const characterId of seatsToTakeOver(room, now, idleMs)) {
    next = takeOverSeatAsNpc(next, scenario, characterId);
  }
  return next;
}

/**
 * Hand off the host role when the current host has been disconnected past `idleMs` (wraps the pure
 * `reassignHost`). Only acts when the host is actually disconnected AND idle beyond the threshold;
 * otherwise returns the room unchanged (including when there's no connected human to promote).
 */
export function reassignHostIfNeeded(room: Room, now: number, idleMs: number): Room {
  const host = room.players.find(player => player.id === room.hostPlayerId);
  if (host) {
    const disconnected = host.connected === false || host.disconnectedAt !== undefined;
    if (!disconnected) {
      return room; // Host is connected — keep them.
    }
    if (host.disconnectedAt === undefined || now - host.disconnectedAt < idleMs) {
      return room; // No measurable idle yet, or still within the grace window.
    }
  }
  // Host is absent from the roster, or disconnected past the idle threshold → try to hand off.
  return reassignHost(room) ?? room;
}

export function isNpcCharacter(room: Room, characterId: string): boolean {
  return room.characterControl[characterId]?.kind === 'npc';
}

export function npcCharacterIds(room: Room): string[] {
  return Object.entries(room.characterControl)
    .filter(([, control]) => control.kind === 'npc')
    .map(([characterId]) => characterId);
}
