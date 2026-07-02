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

// ---------------------------------------------------------------------------
// Emotion + group-turn suspicion (D4 / KI-010)
// ---------------------------------------------------------------------------
// These are OUR fixed labels/strings — none is ever sourced from a secret field (privateScript,
// alibi.truth, secrets, case.truth…). emotion/suspicion are NPC-internal, server-only signals.
//
// Emotion de-escalation ladder, most-cornered → calm. On a group turn where the NPC is NOT accused,
// applyGroupTurnReaction steps its emotion ONE notch toward the baseline, so a flustered NPC cools
// down gradually instead of snapping straight back — or staying cornered forever.
const CALM_EMOTIONAL_STATE = '警惕'; // baseline; MUST match initializeMemory's seed so it relaxes home
const GUARDED_EMOTIONAL_STATE = '戒备'; // intermediate step on the way back down from cornered
const CORNERED_EMOTIONAL_STATE = '慌乱'; // flustered/defensive label when the NPC is accused
const EMOTION_DEESCALATION: Record<string, string> = {
  [CORNERED_EMOTIONAL_STATE]: GUARDED_EMOTIONAL_STATE,
  [GUARDED_EMOTIONAL_STATE]: CALM_EMOTIONAL_STATE,
};

// Suspicion bump applied TOWARD whoever accuses this NPC in a group turn.
const GROUP_ACCUSATION_SUSPICION_DELTA = 2;

// Accusation keywords. A group line only "corners" this NPC when it BOTH names the NPC AND contains
// one of these. OUR list — never derived from any private script or secret.
const ACCUSATION_KEYWORDS = [
  '凶手',
  '怀疑',
  '是你',
  '就是你',
  '你杀',
  '你就是',
  '撒谎',
  '骗人',
  '心虚',
  '狡辩',
  '有问题',
];

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
    emotionalState: CALM_EMOTIONAL_STATE,
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

// Set the NPC's internal emotional label. Immutable spread; returns the SAME reference (a no-op) when
// the state is unchanged, so callers can cheaply skip a redundant store write.
export function setEmotionalState(memory: CharacterMemory, state: string): CharacterMemory {
  if (state === memory.emotionalState) {
    return memory;
  }

  return {
    ...memory,
    emotionalState: state,
  };
}

interface GroupTurnReactionParams {
  selfName: string;
  triggerText: string;
  accuserCharacterId?: string;
  accuserName?: string;
}

interface GroupTurnReaction {
  cornered: boolean;
  suspicionDelta: number;
  suspicionReason: string;
  emotionalState: string;
}

/**
 * Decide how this NPC reacts to a single group-chat turn (D4 / KI-010). Returns `null` when the turn
 * is empty or does NOT name/accuse this NPC. Otherwise it reports that the NPC is cornered: a positive
 * suspicion bump aimed at the accuser, a short Chinese reason WE author (never sourced from any secret
 * field — only the accuser's public display name is interpolated), and a flustered emotional label.
 *
 * Accusation = the trigger text mentions `selfName` AND contains an accusation keyword. Pure function
 * over its params — it reads no memory and no secret.
 */
export function deriveGroupTurnReaction(params: GroupTurnReactionParams): GroupTurnReaction | null {
  const triggerText = params.triggerText?.trim() ?? '';
  const selfName = params.selfName?.trim() ?? '';
  if (!triggerText || !selfName) {
    return null;
  }

  const namesSelf = triggerText.includes(selfName);
  const accuses = ACCUSATION_KEYWORDS.some(keyword => triggerText.includes(keyword));
  if (!namesSelf || !accuses) {
    return null;
  }

  // Accuser display names are PUBLIC (rendered to every human already); safe to weave into our reason.
  const accuserName = params.accuserName?.trim();
  const suspicionReason = accuserName
    ? `${accuserName}在群聊里把矛头指向了我`
    : '有人在群聊里把矛头指向了我';

  return {
    cornered: true,
    suspicionDelta: GROUP_ACCUSATION_SUSPICION_DELTA,
    suspicionReason,
    emotionalState: CORNERED_EMOTIONAL_STATE,
  };
}

/**
 * The single entry point a route worker calls per group turn (D4 / KI-010). Composes
 * deriveGroupTurnReaction + updateSuspicion (toward the accuser) + setEmotionalState.
 *
 * • Accused this turn → bump suspicion toward `accuserCharacterId` (a CHARACTER id — never a player
 *   id) and flip the emotional label to the cornered state.
 * • Not accused → step the emotion ONE notch back down the de-escalation ladder toward the calm
 *   baseline (so an NPC does not stay '慌乱' forever); suspicions are left untouched.
 *
 * Returns the SAME reference when nothing changed (e.g. already calm and not accused).
 */
export function applyGroupTurnReaction(
  memory: CharacterMemory,
  params: GroupTurnReactionParams,
): CharacterMemory {
  const reaction = deriveGroupTurnReaction(params);

  if (!reaction) {
    const relaxed = EMOTION_DEESCALATION[memory.emotionalState] ?? CALM_EMOTIONAL_STATE;
    return setEmotionalState(memory, relaxed);
  }

  let next = memory;
  // Only bump suspicion when we actually know which CHARACTER accused us. accuserCharacterId is always
  // a character id (never player.id) — the route worker is responsible for passing a character id.
  if (params.accuserCharacterId) {
    next = updateSuspicion(
      next,
      params.accuserCharacterId,
      reaction.suspicionDelta,
      reaction.suspicionReason,
    );
  }

  return setEmotionalState(next, reaction.emotionalState);
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
