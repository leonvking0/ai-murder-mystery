import { decideRespondingNPCs } from '@/lib/agents/gm-agent';
import { streamNPCGroupResponse } from '@/lib/agents/npc-agent';
import { getScenarioById } from '@/lib/store/game-sessions';
import type { ChatMessage, GameSession, GamePhase } from '@/types/game';

function trailingNpcMessages(messages: ChatMessage[]): number {
  let count = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if (current?.role !== 'npc') {
      break;
    }

    count += 1;
  }

  return count;
}

function buildGroupContext(messages: ChatMessage[], characterNames: Record<string, string>): string {
  return messages
    .slice(-24)
    .map(message => {
      if (message.role === 'player') {
        return `玩家: ${message.content}`;
      }

      if (message.role === 'npc' && message.characterId) {
        const speaker = characterNames[message.characterId] ?? message.characterId;
        return `${speaker}: ${message.content}`;
      }

      return null;
    })
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function isDiscussionPhase(phase: GamePhase): boolean {
  return phase === 'DISCUSSION_1' || phase === 'DISCUSSION_2' || phase === 'FINAL_DISCUSSION';
}

export async function* manageGroupResponse(
  session: GameSession,
  playerMessage: string,
): AsyncIterable<{ characterId: string; text: string }> {
  const scenario = getScenarioById(session.scenarioId);
  if (!scenario || !isDiscussionPhase(session.currentPhase)) {
    return;
  }

  const normalizedMessage = playerMessage.trim();
  const withoutPlayerInput = normalizedMessage.length === 0;
  const trailingNPCCount = trailingNpcMessages(session.groupChatHistory);

  if (withoutPlayerInput && trailingNPCCount >= 2) {
    return;
  }

  const responders = decideRespondingNPCs(
    session,
    normalizedMessage || '继续讨论当前线索，不要重复前一句。',
  );

  if (responders.length === 0) {
    return;
  }

  const maxResponders = withoutPlayerInput
    ? Math.max(0, 2 - trailingNPCCount)
    : 3;
  const selectedResponders = responders.slice(0, maxResponders);
  const characterNames = Object.fromEntries(
    scenario.characters.map(character => [character.id, character.name]),
  );
  const groupContext = buildGroupContext(session.groupChatHistory, characterNames);

  for (const characterId of selectedResponders) {
    const character = scenario.characters.find(item => item.id === characterId);
    const memory = session.characterMemories[characterId];

    if (!character || !memory) {
      continue;
    }

    const knownClues = [
      ...memory.discoveredClues.map(clue => clue.content),
      ...memory.knownFacts,
    ];

    const effectivePrompt = withoutPlayerInput
      ? '继续刚才的群聊，补充一个新观点或新质疑，避免重复。'
      : `玩家提问：${normalizedMessage}`;

    const responseStream = streamNPCGroupResponse({
      character,
      memory,
      gameState: {
        phase: session.currentPhase,
        knownClues,
        emotionalState: memory.emotionalState,
      },
      groupContext,
      playerMessage: effectivePrompt,
    });

    for await (const chunk of responseStream) {
      if (!chunk) {
        continue;
      }

      yield {
        characterId,
        text: chunk,
      };
    }
  }
}
