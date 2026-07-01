// Room-scoped group discussion: only NPC-controlled characters respond via the LLM. Human-controlled
// characters are driven by their players (their messages arrive through the group-chat route).

import { streamNPCGroupResponse } from '@/lib/agents/npc-agent';
import { npcCharacterIds } from '@/lib/game-engine/room-engine';
import type { Character, GamePhase, Room, Scenario } from '@/types/game';

function isDiscussionPhase(phase: GamePhase): boolean {
  return phase === 'DISCUSSION_1' || phase === 'DISCUSSION_2' || phase === 'FINAL_DISCUSSION';
}

function buildGroupContext(room: Room, scenario: Scenario): string {
  const characterName = new Map(scenario.characters.map(character => [character.id, character.name]));
  const playerName = new Map(room.players.map(player => [player.id, player.name]));

  return room.groupChatHistory
    .slice(-24)
    .map(message => {
      if (message.role === 'system') {
        return `【线索】${message.content}`;
      }
      if (message.role === 'npc' && message.characterId) {
        return `${characterName.get(message.characterId) ?? message.characterId}: ${message.content}`;
      }
      if (message.role === 'player') {
        // A human speaking as their assigned character (fall back to player name).
        const speaker = message.characterId
          ? characterName.get(message.characterId) ?? '玩家'
          : (message.playerId && playerName.get(message.playerId)) || '玩家';
        return `${speaker}: ${message.content}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function pickResponders(room: Scenario, allRoom: Room, triggerText: string): string[] {
  const npcIds = npcCharacterIds(allRoom);
  if (npcIds.length === 0) {
    return [];
  }

  const normalized = triggerText.trim().toLowerCase();
  const nameById = new Map(room.characters.map(character => [character.id, character.name]));

  const mentioned = npcIds.filter(id => {
    const name = nameById.get(id)?.toLowerCase() ?? '';
    return (name && normalized.includes(name)) || normalized.includes(id);
  });

  // Order remaining NPCs by who has spoken least recently.
  const recent = allRoom.groupChatHistory
    .filter(message => message.role === 'npc' && message.characterId)
    .slice(-12);
  const speakCount = new Map<string, number>();
  for (const message of recent) {
    if (message.characterId) {
      speakCount.set(message.characterId, (speakCount.get(message.characterId) ?? 0) + 1);
    }
  }
  const quietest = [...npcIds].sort((a, b) => (speakCount.get(a) ?? 0) - (speakCount.get(b) ?? 0));

  const ordered = [...mentioned, ...quietest].filter((id, index, list) => list.indexOf(id) === index);

  // 1-3 responders: prioritize mentioned, otherwise a couple of the quietest.
  const limit = mentioned.length > 0 ? Math.min(3, ordered.length) : Math.min(2, ordered.length);
  return ordered.slice(0, Math.max(1, limit));
}

export async function* manageRoomGroupResponse(
  room: Room,
  scenario: Scenario,
  triggerText: string,
): AsyncIterable<{ characterId: string; text: string }> {
  if (!isDiscussionPhase(room.currentPhase)) {
    return;
  }

  const responders = pickResponders(scenario, room, triggerText);
  if (responders.length === 0) {
    return;
  }

  const groupContext = buildGroupContext(room, scenario);
  const effectivePrompt = triggerText.trim()
    ? `玩家发言：${triggerText.trim()}`
    : '继续刚才的群聊，补充一个新观点或新质疑，避免重复。';

  for (const characterId of responders) {
    const character: Character | undefined = scenario.characters.find(item => item.id === characterId);
    const memory = room.characterMemories[characterId];
    if (!character || !memory) {
      continue;
    }

    const knownClues = [
      ...memory.discoveredClues.map(clue => clue.content),
      ...memory.knownFacts,
    ];

    const stream = streamNPCGroupResponse({
      character,
      allCharacters: scenario.characters,
      memory,
      gameState: {
        phase: room.currentPhase,
        knownClues,
        emotionalState: memory.emotionalState,
      },
      groupContext,
      playerMessage: effectivePrompt,
    });

    for await (const chunk of stream) {
      if (chunk) {
        yield { characterId, text: chunk };
      }
    }
  }
}
