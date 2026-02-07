import { PHASE_LABELS } from '@/lib/game-engine/phase-manager';
import { getScenarioById } from '@/lib/store/game-sessions';
import type { GameSession } from '@/types/game';

export const GM_SYSTEM_PROMPT_TEMPLATE = `你是这局剧本杀的主持人(GM)。

## 完整真相
{fullTruth}

## 所有角色信息
{allCharacters}

## 当前游戏状态
{gameState}

## 你的职责
1. 推进游戏流程，介绍每个阶段
2. 在适当时机释放公共信息
3. 保持游戏节奏，避免冷场
4. 在讨论阶段引导话题
5. 管理搜证结果分发
6. 最终揭晓真相

## 输出格式
回复JSON: {"narration": "...", "action": "none|advance_phase|release_clue|prompt_npc", "target": "..."}`;

function pickRecentlyQuietCharacters(session: GameSession, allCharacterIds: string[]): string[] {
  const recentNpcMessages = session.groupChatHistory
    .filter(item => item.role === 'npc' && item.characterId)
    .slice(-12);

  const speakCount = new Map<string, number>();
  for (const message of recentNpcMessages) {
    if (!message.characterId) {
      continue;
    }

    speakCount.set(message.characterId, (speakCount.get(message.characterId) ?? 0) + 1);
  }

  return [...allCharacterIds].sort((a, b) => (speakCount.get(a) ?? 0) - (speakCount.get(b) ?? 0));
}

export function decideRespondingNPCs(session: GameSession, message: string): string[] {
  const scenario = getScenarioById(session.scenarioId);
  if (!scenario) {
    return [];
  }

  const normalized = message.trim().toLowerCase();
  const allCharacters = scenario.characters.map(character => ({
    id: character.id,
    name: character.name,
  }));

  const mentioned = allCharacters
    .filter(character => normalized.includes(character.name.toLowerCase()) || normalized.includes(character.id))
    .map(character => character.id);

  const baseOrder = pickRecentlyQuietCharacters(
    session,
    allCharacters.map(character => character.id),
  );

  const ordered = [...mentioned, ...baseOrder].filter((id, index, list) => list.indexOf(id) === index);

  if (ordered.length === 0) {
    return [];
  }

  if (!normalized) {
    return ordered.slice(0, Math.min(2, ordered.length));
  }

  const maxResponders = ordered.length >= 3 ? 3 : ordered.length;
  const minResponders = ordered.length >= 2 ? 2 : 1;
  return ordered.slice(0, Math.max(minResponders, maxResponders));
}

export function generateNarration(session: GameSession, event: string): string {
  if (event === 'phase_enter') {
    return `当前进入${PHASE_LABELS[session.currentPhase]}，请围绕本阶段目标推进讨论。`;
  }

  if (event === 'discussion_stall') {
    return '讨论有些停滞，请从“时间线冲突”和“毒物来源”两个方向继续追问。';
  }

  if (event === 'investigation_start') {
    return '搜证开始，请选择地点并关注可验证的物证。';
  }

  return 'GM正在观察局势，必要时会继续推进流程。';
}

export function shouldAdvancePhase(session: GameSession): boolean {
  const phase = session.currentPhase;
  const messageCount = session.groupChatHistory.length;

  if (phase === 'DISCUSSION_1' || phase === 'DISCUSSION_2') {
    return messageCount >= 10;
  }

  if (phase === 'FINAL_DISCUSSION') {
    return messageCount >= 14;
  }

  return false;
}
