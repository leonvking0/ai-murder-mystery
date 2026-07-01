// Room-scoped group discussion: only NPC-controlled characters respond via the LLM. Human-controlled
// characters are driven by their players (their messages arrive through the group-chat route).

import { streamNPCGroupResponse } from '@/lib/agents/npc-agent';
import { tryReserveNpcTrigger } from '@/lib/agents/npc-voter';
import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { npcCharacterIds } from '@/lib/game-engine/room-engine';
import { toScenarioPublic } from '@/lib/scenarios/projection';
import type { Character, Room, Scenario } from '@/types/game';

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

// NPCs a human named directly in the trigger text — by character name or id. Mentioned NPCs bypass
// the per-room cooldown (a pointed question deserves an answer) and are prioritized as responders.
function mentionedNpcIds(scenario: Scenario, room: Room, triggerText: string): string[] {
  const normalized = triggerText.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const nameById = new Map(scenario.characters.map(character => [character.id, character.name]));
  return npcCharacterIds(room).filter(id => {
    const name = nameById.get(id)?.toLowerCase() ?? '';
    return (name && normalized.includes(name)) || normalized.includes(id.toLowerCase());
  });
}

function pickResponders(scenario: Scenario, room: Room, mentioned: string[]): string[] {
  const npcIds = npcCharacterIds(room);
  if (npcIds.length === 0) {
    return [];
  }

  // Order remaining NPCs by who has spoken least recently.
  const recent = room.groupChatHistory
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
  // Unified chat gate: NPCs speak in exactly the phases that allow chat (INTRO + discussions). This is
  // the single source of truth — the group-chat route enforces the same gate before calling us.
  if (!getPhaseConfig(room.currentPhase).allowsChat) {
    return;
  }

  if (npcCharacterIds(room).length === 0) {
    return;
  }

  const mentioned = mentionedNpcIds(scenario, room, triggerText);

  // Throttle BEFORE any LLM work: a mention bypasses the cooldown; everything obeys the token bucket.
  // When throttled we intentionally yield nothing — not every human line should drag an NPC in.
  if (!tryReserveNpcTrigger(room.id, mentioned.length > 0)) {
    return;
  }

  const responders = pickResponders(scenario, room, mentioned);
  if (responders.length === 0) {
    return;
  }

  const groupContext = buildGroupContext(room, scenario);
  // Pass the RAW player text through — npc-agent wraps it in <玩家发言> delimiters (or falls back
  // to a self-prompt when empty). Never prefix/format player text here.
  const scenarioPublic = toScenarioPublic(scenario);

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
      playerMessage: triggerText,
      scenarioPublic,
    });

    for await (const chunk of stream) {
      if (chunk) {
        yield { characterId, text: chunk };
      }
    }
  }
}
