import type { Character, CharacterMemory, Clue, ConversationSummary, SuspicionRecord } from '@/types/game';
// Relative `.ts` value import (not `@/…`) so this module stays loadable under
// `node --experimental-strip-types` for the offline tests — same import discipline as
// lib/agents/room-group-chat.ts / npc-voter.ts. llm-provider only pulls in bare packages.
import { isLLMConfigured, streamChat } from '../agents/llm-provider.ts';

interface ConversationEntry {
  role: 'player' | 'npc' | 'gm' | 'system';
  content: string;
  characterId?: string;
  // Optional labeling (C7 / KI-015): who ACTUALLY spoke (character or human display name), which
  // channel the line came from, and the real round. Defaults preserve the original
  // `玩家/自己: <text>` summary + `round: 0` behavior so existing callers are unaffected.
  speakerName?: string;
  channel?: 'group' | 'private';
  round?: number;
}

// How many stored conversation entries the shared NPC memory may hold before it is compacted.
const CONVERSATION_COMPACTION_THRESHOLD = 20;

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
  // Prefer the real speaker name (e.g. 张三) over the generic role label so the NPC's memory reads
  // like `[群聊] 张三: …` instead of losing who actually spoke.
  const speaker = entry.speakerName?.trim() || roleLabel;
  const channelPrefix =
    entry.channel === 'group' ? '[群聊] ' : entry.channel === 'private' ? '[私聊] ' : '';
  const nextConversation = {
    withCharacterId: entry.characterId ?? 'player',
    round: entry.round ?? 0,
    summary: `${channelPrefix}${speaker}: ${entry.content}`,
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

  if (!isLLMConfigured()) {
    return memory.conversations
      .slice(-6)
      .map(item => item.summary)
      .join('；');
  }

  try {
    const responseStream = streamChat({
      system: '你是剧本杀NPC记忆整理助手。请把对话压缩成不超过120字的中文摘要，保留关键人物、线索和矛盾点。',
      maxOutputTokens: 300,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: transcript,
        },
      ],
    });

    let summary = '';
    for await (const chunk of responseStream) {
      summary += chunk;
    }

    const normalized = summary.trim();
    return normalized || memory.conversations.slice(-6).map(item => item.summary).join('；');
  } catch (error) {
    console.error('Conversation summary failed:', error);
    return memory.conversations.slice(-6).map(item => item.summary).join('；');
  }
}

// Bound shared NPC memory growth (C10 / KI-021). Only the SHARED `characterMemories[id].conversations`
// array is compacted here; it now grows solely via public group-chat lines (private turns no longer
// write to it — see C7). When it exceeds `threshold`, collapse it into a single `[记忆摘要]` entry via
// `summarizeConversations`, which is offline-safe (with no LLM it returns a last-N join). Returns the
// SAME object reference when nothing changed, so callers can cheaply skip a redundant store write.
export async function compactConversationsIfNeeded(
  memory: CharacterMemory,
  threshold: number = CONVERSATION_COMPACTION_THRESHOLD,
): Promise<CharacterMemory> {
  if (memory.conversations.length <= threshold) {
    return memory;
  }

  const summary = await summarizeConversations(memory);
  const latest = memory.conversations[memory.conversations.length - 1];
  const compacted: ConversationSummary = {
    withCharacterId: 'summary',
    round: latest?.round ?? 0,
    summary: `[记忆摘要] ${summary}`,
    timestamp: Date.now(),
  };

  return {
    ...memory,
    conversations: [compacted],
  };
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
