// F4: flow data-ization. A "flow" is the ordered phase walk a room follows from LOBBY to REVEAL.
// Making the sequence data (not a hardcoded const buried in phase-manager) lets a room carry its own
// `phaseSequence` and lets us add alternate presets (e.g. a shorter "quick" flow) later without
// touching the advance logic. For now only the historical 'standard' flow exists.

import type { GamePhase } from '@/types/game';

export type FlowId = 'standard' | 'quick';

// The canonical 10-phase walk — byte-for-byte the historical PHASE_SEQUENCE.
export const FLOWS: Record<FlowId, GamePhase[]> = {
  standard: [
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
  ],
  // 'quick': one discussion + one investigation round, then straight to the final. Drops DISCUSSION_2 +
  // INVESTIGATION_2. The single INVESTIGATION_1 is the LAST investigation phase, so investigationCeiling
  // exposes ALL clue rounds there (see room-investigation.ts) — the case stays solvable.
  quick: [
    'LOBBY',
    'READING',
    'INTRO',
    'DISCUSSION_1',
    'INVESTIGATION_1',
    'FINAL_DISCUSSION',
    'VOTING',
    'REVEAL',
  ],
};

// Public copy for the room-creation flow picker. Safe to ship to the client — describes only the
// game's shape (phase count + rough duration), no secrets.
export const FLOW_LABELS: Record<FlowId, { title: string; description: string }> = {
  standard: { title: '标准局', description: '完整 10 阶段：两轮讨论+两轮搜证，约 60 分钟' },
  quick: { title: '快速局', description: '精简 8 阶段：一轮讨论+一轮搜证，约 30 分钟' },
};

// Return a FRESH copy of the requested flow's phase walk (defaults to 'standard'). Fresh so callers
// can stamp it onto a room and mutate/serialize without aliasing the shared FLOWS table.
export function resolveFlow(flowId?: FlowId): GamePhase[] {
  return [...FLOWS[flowId ?? 'standard']];
}
