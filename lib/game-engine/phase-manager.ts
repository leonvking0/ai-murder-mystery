import type { GamePhase, GameSession } from '@/types/game';

export interface PhaseCapabilityConfig {
  description: string;
  allowsChat: boolean;
  allowsInvestigation: boolean;
  allowsVoting: boolean;
}

export const PHASE_SEQUENCE: GamePhase[] = [
  'LOBBY',
  'READING',
  'INTRO',
  'DISCUSSION_1',
  'INVESTIGATION_1',
  'DISCUSSION_2',
  'INVESTIGATION_2',
  'FINAL_DISCUSSION',
  'VOTING',
  'REVEAL',
];

export const PHASE_LABELS: Record<GamePhase, string> = {
  LOBBY: '大厅',
  READING: '阅读剧本',
  INTRO: '自我介绍',
  DISCUSSION_1: '第一轮讨论',
  INVESTIGATION_1: '第一轮搜证',
  DISCUSSION_2: '第二轮讨论',
  INVESTIGATION_2: '第二轮搜证',
  FINAL_DISCUSSION: '最终讨论',
  VOTING: '投票指认',
  REVEAL: '真相揭晓',
};

export const PHASE_NARRATIONS: Record<GamePhase, string> = {
  LOBBY: '角色已入场。请确认准备状态，接下来将进入阅读阶段。',
  READING: '暴风雪已封山。请阅读角色背景与当前局势，确认你掌握的信息边界。',
  INTRO: '请所有角色进行简短自我介绍，并说明昨夜的大致动向。',
  DISCUSSION_1: '第一轮讨论开始，优先围绕动机和不在场证明进行交叉质询。',
  INVESTIGATION_1: '第一轮搜证开始，你可以选择地点查找第一批线索。',
  DISCUSSION_2: '第二轮讨论开始，请结合新线索核对口供矛盾。',
  INVESTIGATION_2: '第二轮搜证开始，关键证据已开放，重点破解密室与毒物来源。',
  FINAL_DISCUSSION: '最终讨论开始，请整合完整时间线并锁定唯一怀疑对象。',
  VOTING: '请进行最终指认，并给出证据链。',
  REVEAL: '真相揭晓阶段开始。GM将复盘作案过程与所有关键误导点。',
};

const PHASE_CONFIGS: Record<GamePhase, PhaseCapabilityConfig> = {
  LOBBY: {
    description: '等待所有人进入游戏',
    allowsChat: false,
    allowsInvestigation: false,
    allowsVoting: false,
  },
  READING: {
    description: '阅读角色剧本和公开背景',
    allowsChat: false,
    allowsInvestigation: false,
    allowsVoting: false,
  },
  INTRO: {
    description: '角色自我介绍并建立初始时间线',
    allowsChat: true,
    allowsInvestigation: false,
    allowsVoting: false,
  },
  DISCUSSION_1: {
    description: '第一轮讨论，初步质询动机和不在场证明',
    allowsChat: true,
    allowsInvestigation: false,
    allowsVoting: false,
  },
  INVESTIGATION_1: {
    description: '第一轮搜证，获取基础线索',
    allowsChat: false,
    allowsInvestigation: true,
    allowsVoting: false,
  },
  DISCUSSION_2: {
    description: '第二轮讨论，利用线索验证口供',
    allowsChat: true,
    allowsInvestigation: false,
    allowsVoting: false,
  },
  INVESTIGATION_2: {
    description: '第二轮搜证，解锁关键证据',
    allowsChat: false,
    allowsInvestigation: true,
    allowsVoting: false,
  },
  FINAL_DISCUSSION: {
    description: '最终讨论，锁定唯一目标',
    allowsChat: true,
    allowsInvestigation: false,
    allowsVoting: false,
  },
  VOTING: {
    description: '投票指认凶手并提交证据',
    allowsChat: false,
    allowsInvestigation: false,
    allowsVoting: true,
  },
  REVEAL: {
    description: '复盘真相与角色隐藏信息',
    allowsChat: false,
    allowsInvestigation: false,
    allowsVoting: false,
  },
};

function expectedRoundForPhase(phase: GamePhase): number | null {
  if (phase === 'DISCUSSION_1' || phase === 'INVESTIGATION_1') {
    return 1;
  }

  if (phase === 'DISCUSSION_2' || phase === 'INVESTIGATION_2') {
    return 2;
  }

  if (phase === 'FINAL_DISCUSSION') {
    return 3;
  }

  return null;
}

export function getNextPhase(current: GamePhase): GamePhase | null {
  const currentIndex = PHASE_SEQUENCE.indexOf(current);
  if (currentIndex === -1 || currentIndex >= PHASE_SEQUENCE.length - 1) {
    return null;
  }

  return PHASE_SEQUENCE[currentIndex + 1] ?? null;
}

export function canAdvance(session: GameSession): boolean {
  const nextPhase = getNextPhase(session.currentPhase);
  if (!nextPhase) {
    return false;
  }

  const expectedRound = expectedRoundForPhase(session.currentPhase);
  if (expectedRound !== null && session.round !== expectedRound) {
    return false;
  }

  if (session.currentPhase === 'VOTING' && Object.keys(session.votes).length === 0) {
    return false;
  }

  return true;
}

export function getPhaseConfig(phase: GamePhase): PhaseCapabilityConfig {
  return PHASE_CONFIGS[phase];
}
