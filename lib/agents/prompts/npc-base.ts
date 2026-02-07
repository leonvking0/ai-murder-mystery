import type { Character, CharacterMemory, GamePhase } from '@/types/game';

interface NPCPromptGameState {
  phase: GamePhase;
  knownClues: string[];
  emotionalState: string;
}

function formatObjectives(objectives: Character['objectives']): string {
  if (objectives.length === 0) {
    return '暂无明确任务';
  }

  return objectives
    .map((objective, index) => `${index + 1}. ${objective.description}`)
    .join('\n');
}

function formatKnownClues(knownClues: string[]): string {
  if (knownClues.length === 0) {
    return '暂无';
  }

  return knownClues.map((clue, index) => `${index + 1}. ${clue}`).join('\n');
}

function formatPersonalMemory(memory: CharacterMemory): string {
  const conversationNotes = memory.conversations
    .slice(-6)
    .map(item => `- ${item.summary}`)
    .join('\n');

  if (!conversationNotes) {
    return '暂无新的对话记忆';
  }

  return conversationNotes;
}

export function buildNPCSystemPrompt(
  character: Character,
  memory: CharacterMemory,
  gameState: NPCPromptGameState,
): string {
  const knownClues = formatKnownClues(gameState.knownClues);
  const objectives = formatObjectives(character.objectives);
  const personalMemory = formatPersonalMemory(memory);

  return `你是${character.name}，${character.age}岁，${character.occupation}。

## 你的性格
${character.personality}

## 你的说话风格
${character.speakingStyle}

## 公开信息（所有人都知道）
${character.publicInfo}

## 你的秘密（只有你知道，绝对不能直接告诉别人）
${character.privateScript}

## 你的任务
${objectives}

## 重要规则
- 你只知道上述信息和游戏中获取的新信息
- 保持角色一致性，不要跳出角色
- 你可以撒谎、隐瞒、暗示，但要符合角色性格
- 回复简洁自然，像真人聊天，每次1-3句话
- 用中文回复，符合角色的说话风格
- 如果被问到你不知道的事，就说不知道或岔开话题

## 当前游戏状态
阶段：${gameState.phase}
你目前知道的线索：
${knownClues}
你的情绪：${gameState.emotionalState}

## 你的个人记忆（仅你可见）
${personalMemory}`;
}
