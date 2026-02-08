import type { ModelMessage } from 'ai';
import type { Character, CharacterMemory, ChatMessage, GamePhase } from '@/types/game';
import { buildNPCSystemPrompt } from '@/lib/agents/prompts/npc-base';
import { isLLMConfigured, streamChat } from '@/lib/agents/llm-provider';

interface StreamNPCResponseParams {
  character: Character;
  allCharacters: Character[];
  memory: CharacterMemory;
  conversationHistory: ChatMessage[];
  gameState: {
    phase: GamePhase;
    knownClues: string[];
    emotionalState: string;
  };
  playerMessage: string;
}

interface StreamNPCGroupResponseParams {
  character: Character;
  allCharacters: Character[];
  memory: CharacterMemory;
  gameState: {
    phase: GamePhase;
    knownClues: string[];
    emotionalState: string;
  };
  groupContext: string;
  playerMessage: string;
}

function mapHistoryToModelMessages(conversationHistory: ChatMessage[]): ModelMessage[] {
  return conversationHistory
    .filter(message => message.role === 'player' || message.role === 'npc')
    .map(message => {
      if (message.role === 'player') {
        return {
          role: 'user' as const,
          content: message.content,
        };
      }

      return {
        role: 'assistant' as const,
        content: message.content,
      };
    });
}

export async function* streamNPCResponse(
  params: StreamNPCResponseParams,
): AsyncIterable<string> {
  const {
    character,
    allCharacters,
    memory,
    conversationHistory,
    gameState,
    playerMessage,
  } = params;

  if (!isLLMConfigured()) {
    yield '我现在有些头绪混乱，晚点再和你细聊。';
    return;
  }

  try {
    const systemPrompt = buildNPCSystemPrompt(character, memory, gameState, allCharacters);
    const historyMessages = mapHistoryToModelMessages(conversationHistory);

    const stream = streamChat({
      system: systemPrompt,
      maxOutputTokens: 5000,
      temperature: 0.8,
      messages: [
        ...historyMessages,
        {
          role: 'user' as const,
          content: playerMessage,
        },
      ],
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  } catch (error) {
    console.error('NPC agent stream failed:', error);
    yield '我先缓一缓，这个问题我稍后再回答你。';
  }
}

export async function* streamNPCGroupResponse(
  params: StreamNPCGroupResponseParams,
): AsyncIterable<string> {
  const {
    character,
    allCharacters,
    memory,
    gameState,
    groupContext,
    playerMessage,
  } = params;

  if (!isLLMConfigured()) {
    yield '我先记下这个点，我们继续往时间线里对。';
    return;
  }

  try {
    const systemPrompt = buildNPCSystemPrompt(character, memory, gameState, allCharacters);

    const stream = streamChat({
      system: systemPrompt,
      maxOutputTokens: 5000,
      temperature: 0.8,
      messages: [
        {
          role: 'user' as const,
          content: `以下是当前群聊公开记录：\n${groupContext || '（暂无）'}\n\n请你用角色口吻回应：${playerMessage}\n要求：1-3句话，简洁自然，不跳出角色。`,
        },
      ],
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  } catch (error) {
    console.error('NPC group stream failed:', error);
    yield '这个问题我先保留意见，等再核对一条线索。';
  }
}
