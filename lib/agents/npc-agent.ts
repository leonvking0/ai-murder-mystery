import Anthropic from '@anthropic-ai/sdk';
import type { Character, CharacterMemory, ChatMessage, GamePhase } from '@/types/game';
import { buildNPCSystemPrompt } from '@/lib/agents/prompts/npc-base';

interface StreamNPCResponseParams {
  character: Character;
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
  memory: CharacterMemory;
  gameState: {
    phase: GamePhase;
    knownClues: string[];
    emotionalState: string;
  };
  groupContext: string;
  playerMessage: string;
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function mapHistoryToClaudeMessages(conversationHistory: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
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
    memory,
    conversationHistory,
    gameState,
    playerMessage,
  } = params;

  if (!process.env.ANTHROPIC_API_KEY) {
    yield '我现在有些头绪混乱，晚点再和你细聊。';
    return;
  }

  try {
    const systemPrompt = buildNPCSystemPrompt(character, memory, gameState);
    const historyMessages = mapHistoryToClaudeMessages(conversationHistory);

    const stream = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      temperature: 0.8,
      system: systemPrompt,
      stream: true,
      messages: [
        ...historyMessages,
        {
          role: 'user',
          content: playerMessage,
        },
      ],
    });

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') {
        continue;
      }

      if (event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
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
    memory,
    gameState,
    groupContext,
    playerMessage,
  } = params;

  if (!process.env.ANTHROPIC_API_KEY) {
    yield '我先记下这个点，我们继续往时间线里对。';
    return;
  }

  try {
    const systemPrompt = buildNPCSystemPrompt(character, memory, gameState);

    const stream = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 450,
      temperature: 0.8,
      system: systemPrompt,
      stream: true,
      messages: [
        {
          role: 'user',
          content: `以下是当前群聊公开记录：\n${groupContext || '（暂无）'}\n\n请你用角色口吻回应：${playerMessage}\n要求：1-3句话，简洁自然，不跳出角色。`,
        },
      ],
    });

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') {
        continue;
      }

      if (event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  } catch (error) {
    console.error('NPC group stream failed:', error);
    yield '这个问题我先保留意见，等再核对一条线索。';
  }
}
