'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { GameSession, InvestigateResponse, InvestigationLocation, InvestigationResult } from '@/types/game';

interface InvestigationPanelProps {
  sessionId: string;
  locations: InvestigationLocation[];
  round: number;
  onInvestigationComplete: (session: GameSession, result: InvestigationResult) => void;
}

export function InvestigationPanel({
  sessionId,
  locations,
  round,
  onInvestigationComplete,
}: InvestigationPanelProps) {
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(locations[0]?.id ?? null);
  const [investigating, setInvestigating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<InvestigationResult | null>(null);

  const selectedLocation = useMemo(
    () => locations.find(location => location.id === selectedLocationId) ?? null,
    [locations, selectedLocationId],
  );

  const investigate = async () => {
    if (!selectedLocationId || investigating) {
      return;
    }

    setInvestigating(true);
    setError(null);

    try {
      const response = await fetch(`/api/game/${sessionId}/investigate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locationId: selectedLocationId }),
      });

      const payload = (await response.json()) as InvestigateResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Investigation failed');
      }

      setLastResult(payload.result);
      onInvestigationComplete(payload.session, payload.result);
    } catch (investigateError) {
      setError(investigateError instanceof Error ? investigateError.message : '搜证失败');
    } finally {
      setInvestigating(false);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Investigation</p>
        <h2 className="mt-1 text-lg font-semibold text-amber-100">第 {round} 轮搜证</h2>
        <p className="mt-1 text-sm text-slate-300">选择一个地点进行搜索，系统会按轮次解锁线索。</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {locations.map(location => {
          const selected = location.id === selectedLocationId;
          return (
            <button
              key={location.id}
              type="button"
              onClick={() => setSelectedLocationId(location.id)}
              className={[
                'rounded-xl border p-3 text-left transition',
                selected
                  ? 'border-amber-500/60 bg-amber-900/20'
                  : 'border-slate-700 bg-slate-900/60 hover:border-slate-500',
              ].join(' ')}
            >
              <p className="font-medium text-slate-100">{location.name}</p>
              <p className="mt-1 text-xs text-slate-400">{location.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-slate-300">
          当前地点：{selectedLocation?.name ?? '未选择'}
        </p>
        <Button
          type="button"
          onClick={investigate}
          disabled={!selectedLocationId || investigating}
          className="bg-amber-700 text-amber-50 hover:bg-amber-600"
        >
          {investigating ? '搜证中...' : '开始搜证'}
        </Button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-900/20 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {lastResult && (
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-3">
          <p className="text-sm font-medium text-amber-100">
            本次搜证：{lastResult.locationName}
          </p>
          {lastResult.newlyFound.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm text-slate-200">
              {lastResult.newlyFound.map(clue => (
                <li key={clue.id} className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2">
                  <p>{clue.content}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {clue.type === 'public' ? '公共线索' : '私密线索'} / {clue.significance}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-400">没有发现新线索（该地点本轮已搜索完）。</p>
          )}
        </div>
      )}
    </div>
  );
}
