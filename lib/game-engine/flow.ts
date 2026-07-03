// F4: flow data-ization. A "flow" is the ordered phase walk a room follows from LOBBY to REVEAL.
// Making the sequence data (not a hardcoded const buried in phase-manager) lets a room carry its own
// `phaseSequence` and lets us add alternate presets (e.g. a shorter "quick" flow) later without
// touching the advance logic. For now only the historical 'standard' flow exists.

import type { GamePhase } from '@/types/game';

export type FlowId = 'standard';

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
};

// Return a FRESH copy of the requested flow's phase walk (defaults to 'standard'). Fresh so callers
// can stamp it onto a room and mutate/serialize without aliasing the shared FLOWS table.
export function resolveFlow(flowId?: FlowId): GamePhase[] {
  return [...FLOWS[flowId ?? 'standard']];
}
