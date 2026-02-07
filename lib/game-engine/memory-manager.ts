import Anthropic from '@anthropic-ai/sdk';
import type { Character, CharacterMemory, Clue, SuspicionRecord } from '@/types/game';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ConversationEntry {
  role: 'player' | 'npc' | 'gm' | 'system';
  content: string;
  characterId?: string;
}

export function initializeMemory(character: Character): CharacterMemory {
  return {
    characterId: character.id,
    privateScript: character.privateScript,
    publicProfile: character.publicInfo,
    objectives: character.objectives.map(objective => objective.description),
    conversations: [],
    discoveredClues: [],
    knownFacts: [],
    suspicions: character.relationships.map<SuspicionRecord>(relationship => ({
      characterId: relationship.characterId,
      level: 3,
      reasons: [],
    })),
    emotionalState: '警惕',
  };
}

export function appendConversation(
  memory: CharacterMemory,
  entry: ConversationEntry,
): CharacterMemory {
  const roleLabel = entry.role === 'player' ? '玩家' : entry.role === 'npc' ? '自己' : entry.role;
  const nextConversation = {
    withCharacterId: entry.characterId ?? 'player',
    round: 0,
    summary: `${roleLabel}: ${entry.content}`,
    timestamp: Date.now(),
  };

  return {
    ...memory,
    conversations: [...memory.conversations, nextConversation],
  };
}

function buildConversationTranscript(memory: CharacterMemory): string {
  return memory.conversations
    .map((item, index) => `${index + 1}. ${item.summary}`)
    .join('\n');
}

export async function summarizeConversations(memory: CharacterMemory): Promise<string> {
  const transcript = buildConversationTranscript(memory);

  if (memory.conversations.length <= 10) {
    return transcript;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return memory.conversations
      .slice(-6)
      .map(item => item.summary)
      .join('；');
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      temperature: 0.2,
      system: '你是剧本杀NPC记忆整理助手。请把对话压缩成不超过120字的中文摘要，保留关键人物、线索和矛盾点。',
      messages: [
        {
          role: 'user',
          content: transcript,
        },
      ],
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();

    return text || memory.conversations.slice(-6).map(item => item.summary).join('；');
  } catch (error) {
    console.error('Conversation summary failed:', error);
    return memory.conversations.slice(-6).map(item => item.summary).join('；');
  }
}

export function updateSuspicion(
  memory: CharacterMemory,
  targetId: string,
  delta: number,
  reason: string,
): CharacterMemory {
  const existing = memory.suspicions.find(item => item.characterId === targetId);

  if (!existing) {
    return {
      ...memory,
      suspicions: [
        ...memory.suspicions,
        {
          characterId: targetId,
          level: Math.max(0, Math.min(10, delta)),
          reasons: reason ? [reason] : [],
        },
      ],
    };
  }

  const nextLevel = Math.max(0, Math.min(10, existing.level + delta));

  return {
    ...memory,
    suspicions: memory.suspicions.map(item => {
      if (item.characterId !== targetId) {
        return item;
      }

      return {
        ...item,
        level: nextLevel,
        reasons: reason ? [...item.reasons, reason] : item.reasons,
      };
    }),
  };
}

export function addDiscoveredClue(
  memory: CharacterMemory,
  clue: Clue,
): CharacterMemory {
  if (memory.discoveredClues.some(item => item.id === clue.id)) {
    return memory;
  }

  return {
    ...memory,
    discoveredClues: [...memory.discoveredClues, clue],
  };
}
