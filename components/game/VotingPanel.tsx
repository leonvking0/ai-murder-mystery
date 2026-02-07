'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Character, VoteResponse } from '@/types/game';

interface VotingPanelProps {
  sessionId: string;
  characters: Character[];
  hasVoted: boolean;
  votedAccusedId?: string;
  onVoteSubmitted: (result: VoteResponse) => void;
}

export function VotingPanel({
  sessionId,
  characters,
  hasVoted,
  votedAccusedId,
  onVoteSubmitted,
}: VotingPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(votedAccusedId ?? characters[0]?.id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCharacter = useMemo(
    () => characters.find(character => character.id === selectedId) ?? null,
    [characters, selectedId],
  );

  const submitVote = async () => {
    if (!selectedId || submitting || hasVoted) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/game/${sessionId}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accusedCharacterId: selectedId,
        }),
      });

      const payload = (await response.json()) as VoteResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? '投票失败');
      }

      onVoteSubmitted(payload);
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : '投票失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Final Vote</p>
        <h2 className="mt-1 text-lg font-semibold text-amber-100">指认真凶</h2>
        <p className="mt-1 text-sm text-slate-300">
          请选择你认为的凶手并确认提交。提交后将立即进入真相揭晓阶段。
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {characters.map(character => {
          const selected = character.id === selectedId;
          return (
            <button
              key={character.id}
              type="button"
              onClick={() => setSelectedId(character.id)}
              disabled={hasVoted || submitting}
              className={[
                'rounded-xl border p-3 text-left transition',
                selected
                  ? 'border-amber-500/70 bg-amber-900/20'
                  : 'border-slate-700 bg-slate-900/60 hover:border-slate-500',
                hasVoted ? 'cursor-not-allowed opacity-80' : '',
              ].join(' ')}
            >
              <p className="font-medium text-slate-100">{character.name}</p>
              <p className="mt-1 text-xs text-slate-400">{character.occupation}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300">
          当前选择：{selectedCharacter?.name ?? '未选择'}
        </p>
        <Button
          type="button"
          onClick={submitVote}
          disabled={!selectedId || submitting || hasVoted}
          className="bg-amber-700 text-amber-50 hover:bg-amber-600"
        >
          {hasVoted ? '已提交投票' : submitting ? '提交中...' : '确认指认'}
        </Button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-900/20 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
