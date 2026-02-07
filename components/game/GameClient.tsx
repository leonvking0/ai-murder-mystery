'use client';

import { useEffect, useMemo, useState } from 'react';

import { CharacterCard } from '@/components/game/CharacterCard';
import { ChatPanel } from '@/components/game/ChatPanel';
import { PhaseIndicator } from '@/components/game/PhaseIndicator';
import { PhaseTransition } from '@/components/game/PhaseTransition';
import { Button } from '@/components/ui/button';
import { getNextPhase } from '@/lib/game-engine/phase-manager';
import { useGameStore } from '@/lib/store/game-store';
import type { GamePhase, GameStateResponse, Scenario } from '@/types/game';

interface GameClientProps {
  sessionId: string;
}

export function GameClient({ sessionId }: GameClientProps) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<GamePhase>('READING');

  const selectedCharacterId = useGameStore(state => state.selectedCharacterId);
  const setSessionId = useGameStore(state => state.setSessionId);
  const selectCharacter = useGameStore(state => state.selectCharacter);
  const setPhase = useGameStore(state => state.setPhase);
  const hydrateMessages = useGameStore(state => state.hydrateMessages);
  const gamePhase = useGameStore(state => state.gamePhase);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setError(null);
      setSessionId(sessionId);

      try {
        const response = await fetch(`/api/game/${sessionId}/state`, {
          method: 'GET',
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error('Session not found');
        }

        const data = (await response.json()) as GameStateResponse;

        if (!active) {
          return;
        }

        setScenario(data.scenario);
        hydrateMessages(data.session.chatHistories);
        setPhase(data.session.currentPhase);
        setTransitionPhase(data.session.currentPhase);
        setTransitionOpen(true);

        if (data.scenario.characters.length > 0) {
          selectCharacter(data.scenario.characters[0].id);
        }
      } catch (fetchError) {
        if (!active) {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : 'Load failed');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [sessionId, hydrateMessages, selectCharacter, setPhase, setSessionId]);

  const selectedCharacter = useMemo(() => {
    if (!scenario || !selectedCharacterId) {
      return null;
    }

    return scenario.characters.find(character => character.id === selectedCharacterId) ?? null;
  }, [scenario, selectedCharacterId]);

  const canAdvancePhase = getNextPhase(gamePhase) !== null;

  const advancePhase = async () => {
    if (advancing || !canAdvancePhase) {
      return;
    }

    setAdvancing(true);
    setError(null);

    try {
      const response = await fetch(`/api/game/${sessionId}/advance`, {
        method: 'POST',
      });

      const payload = (await response.json()) as GameStateResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to advance phase');
      }

      setPhase(payload.session.currentPhase);
      setTransitionPhase(payload.session.currentPhase);
      setTransitionOpen(true);
    } catch (advanceError) {
      setError(advanceError instanceof Error ? advanceError.message : '阶段推进失败');
    } finally {
      setAdvancing(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        正在载入山庄档案...
      </main>
    );
  }

  if (error || !scenario) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-red-300">
        {error ?? '无法读取游戏数据'}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,rgba(180,83,9,0.16),transparent_42%),radial-gradient(circle_at_78%_18%,rgba(71,85,105,0.22),transparent_38%),linear-gradient(160deg,#020617,#0f172a_45%,#111827)] text-slate-100">
      <div className="mx-auto grid min-h-screen max-w-[1500px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[280px_1fr_300px] lg:px-6 lg:py-6">
        <aside className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Characters</p>
          <h1 className="mt-2 text-xl font-semibold text-amber-100">{scenario.title}</h1>

          <div className="mt-4 space-y-2">
            {scenario.characters.map(character => (
              <CharacterCard
                key={character.id}
                character={character}
                selected={character.id === selectedCharacterId}
                onClick={() => selectCharacter(character.id)}
              />
            ))}
          </div>
        </aside>

        <section className="flex min-h-[60vh] flex-col gap-4 lg:min-h-0">
          <PhaseIndicator phase={gamePhase} />
          <div className="flex items-center justify-end">
            <Button
              type="button"
              onClick={advancePhase}
              disabled={advancing || !canAdvancePhase}
              className="bg-amber-700 text-amber-50 hover:bg-amber-600"
            >
              {advancing ? '推进中...' : '推进到下一阶段'}
            </Button>
          </div>
          {selectedCharacter ? (
            <ChatPanel
              sessionId={sessionId}
              character={selectedCharacter}
              disabled={gamePhase === 'READING'}
              disabledReason="阅读阶段仅可查看资料，暂不开放对话。"
            />
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-950/70 text-slate-400">
              请选择一位角色开始私聊
            </div>
          )}
        </section>

        <aside className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Notebook</p>
          <h2 className="mt-2 text-lg font-semibold text-amber-100">线索笔记</h2>
          <div className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
            搜证系统将在下一阶段开放。当前先与角色对话，记录矛盾时间线和可疑细节。
          </div>
        </aside>
      </div>

      <PhaseTransition
        open={transitionOpen}
        phase={transitionPhase}
        onContinue={() => setTransitionOpen(false)}
      />
    </main>
  );
}
