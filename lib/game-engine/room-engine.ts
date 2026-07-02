// Pure room transitions: joining the lobby and starting the game with random character assignment.
// Kept pure (no I/O) so routes can run them inside an atomic updateRoom() and so they're testable.

import { randomUUID } from 'node:crypto';

import { initializeMemory } from '@/lib/game-engine/memory-manager';
import { getNextPhase } from '@/lib/game-engine/phase-manager';
import { generatePublicId } from '@/lib/room/auth';
import { connectedHumanVoteState } from '@/lib/scenarios/projection';
import type { CharacterControl, GamePhase, Player, Room, Scenario } from '@/types/game';

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

export function isNpcCharacter(room: Room, characterId: string): boolean {
  return room.characterControl[characterId]?.kind === 'npc';
}

export function npcCharacterIds(room: Room): string[] {
  return Object.entries(room.characterControl)
    .filter(([, control]) => control.kind === 'npc')
    .map(([characterId]) => characterId);
}
