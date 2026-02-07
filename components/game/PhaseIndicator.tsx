'use client';

import { getPhaseConfig, PHASE_LABELS, PHASE_SEQUENCE } from '@/lib/game-engine/phase-manager';
import type { GamePhase } from '@/types/game';

interface PhaseIndicatorProps {
  phase: GamePhase;
}

export function PhaseIndicator({ phase }: PhaseIndicatorProps) {
  const currentIndex = Math.max(0, PHASE_SEQUENCE.indexOf(phase));
  const progress = (currentIndex / (PHASE_SEQUENCE.length - 1)) * 100;
  const config = getPhaseConfig(phase);

  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Current Phase</p>
          <h2 className="mt-1 text-lg font-semibold text-amber-100">{PHASE_LABELS[phase]}</h2>
          <p className="mt-1 text-sm text-slate-300">{config.description}</p>
        </div>
        <span className="rounded-full border border-amber-500/40 bg-amber-600/20 px-3 py-1 text-xs text-amber-200">
          {currentIndex + 1}/{PHASE_SEQUENCE.length}
        </span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full bg-gradient-to-r from-amber-700 via-orange-500 to-amber-300 transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {PHASE_SEQUENCE.map((item, index) => {
          const completed = index <= currentIndex;
          return (
            <span
              key={item}
              className={[
                'rounded-md border px-2 py-1 text-xs',
                completed
                  ? 'border-amber-500/50 bg-amber-600/20 text-amber-100'
                  : 'border-slate-700 bg-slate-900/70 text-slate-400',
              ].join(' ')}
            >
              {PHASE_LABELS[item]}
            </span>
          );
        })}
      </div>
    </div>
  );
}
