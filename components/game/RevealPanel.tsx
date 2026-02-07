'use client';

import { useEffect, useMemo, useState } from 'react';

import type { Scenario } from '@/types/game';

interface RevealPanelProps {
  scenario: Scenario;
  votedAccusedId?: string;
  voteIsCorrect?: boolean;
}

function statusStyles(isCorrect: boolean | undefined): string {
  if (isCorrect === true) {
    return 'border-emerald-500/40 bg-emerald-900/20 text-emerald-100';
  }

  if (isCorrect === false) {
    return 'border-rose-500/40 bg-rose-900/20 text-rose-100';
  }

  return 'border-slate-600/50 bg-slate-900/50 text-slate-100';
}

export function RevealPanel({ scenario, votedAccusedId, voteIsCorrect }: RevealPanelProps) {
  const [stage, setStage] = useState(0);

  const accusedName = useMemo(() => {
    if (!votedAccusedId) {
      return '未提交';
    }

    return scenario.characters.find(character => character.id === votedAccusedId)?.name ?? votedAccusedId;
  }, [scenario.characters, votedAccusedId]);

  const killer = useMemo(
    () => scenario.characters.find(character => character.isKiller) ?? null,
    [scenario.characters],
  );

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStage(1), 500),
      window.setTimeout(() => setStage(2), 1200),
      window.setTimeout(() => setStage(3), 2200),
    ];

    return () => {
      timers.forEach(timer => window.clearTimeout(timer));
    };
  }, [votedAccusedId, voteIsCorrect]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-700/70 bg-[radial-gradient(circle_at_20%_12%,rgba(217,119,6,0.22),transparent_42%),radial-gradient(circle_at_82%_24%,rgba(51,65,85,0.38),transparent_40%),linear-gradient(160deg,#020617,#0f172a_50%,#111827)] p-5 text-slate-100">
      <div className="absolute inset-0 bg-[linear-gradient(transparent_96%,rgba(148,163,184,0.08)_100%)] bg-[length:100%_18px]" />

      <div className="relative z-10">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-300/90">Final Reveal</p>
        <h2 className="mt-1 text-2xl font-semibold text-amber-100">真相揭晓</h2>
      </div>

      <div className="relative z-10 mt-4 space-y-3">
        <div
          className={[
            'rounded-xl border px-4 py-3 transition duration-500',
            statusStyles(voteIsCorrect),
            stage >= 1 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
          ].join(' ')}
        >
          <p className="text-sm">
            你的指认：{accusedName}
          </p>
          <p className="mt-1 text-base font-semibold">
            {voteIsCorrect === true && '指认正确，你锁定了凶手。'}
            {voteIsCorrect === false && '指认错误，关键证据链出现偏差。'}
            {typeof voteIsCorrect === 'undefined' && '本局未检测到你的投票记录。'}
          </p>
        </div>

        <div
          className={[
            'rounded-xl border border-amber-500/40 bg-amber-900/20 px-4 py-3 transition duration-500',
            stage >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
          ].join(' ')}
        >
          <p className="text-sm text-amber-100/90">真凶身份</p>
          <p className="mt-1 text-xl font-bold text-amber-100">
            {killer?.name ?? '王大明'} ({killer?.id ?? 'wang-daming'})
          </p>
        </div>

        <div
          className={[
            'rounded-xl border border-slate-600/80 bg-slate-900/70 px-4 py-4 text-sm leading-relaxed text-slate-200 transition duration-700',
            stage >= 3 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
          ].join(' ')}
        >
          {scenario.case.truth}
        </div>
      </div>
    </div>
  );
}
