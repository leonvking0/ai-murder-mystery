'use client';

import { useEffect, useMemo, useState } from 'react';

import { CharacterCard } from '@/components/game/CharacterCard';
import { ChatPanel } from '@/components/game/ChatPanel';
import { GroupChat } from '@/components/game/GroupChat';
import { InvestigationPanel } from '@/components/game/InvestigationPanel';
import { PhaseIndicator } from '@/components/game/PhaseIndicator';
import { PhaseTransition } from '@/components/game/PhaseTransition';
import { Button } from '@/components/ui/button';
import { getNextPhase, getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { useGameStore } from '@/lib/store/game-store';
import type { Clue, GamePhase, GameStateResponse, Scenario } from '@/types/game';

interface GameClientProps {
  sessionId: string;
}

export function GameClient({ sessionId }: GameClientProps) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<GamePhase>('READING');
  const [discoveredClues, setDiscoveredClues] = useState<Clue[]>([]);

  const selectedCharacterId = useGameStore(state => state.selectedCharacterId);
  const setSessionId = useGameStore(state => state.setSessionId);
  const selectCharacter = useGameStore(state => state.selectCharacter);
  const setPhase = useGameStore(state => state.setPhase);
  const hydrateMessages = useGameStore(state => state.hydrateMessages);
  const hydrateGroupMessages = useGameStore(state => state.hydrateGroupMessages);
  const gamePhase = useGameStore(state => state.gamePhase);
  const chatMode = useGameStore(state => state.chatMode);
  const setChatMode = useGameStore(state => state.setChatMode);

  const isDiscussionPhase = gamePhase === 'DISCUSSION_1'
    || gamePhase === 'DISCUSSION_2'
    || gamePhase === 'FINAL_DISCUSSION';
  const isInvestigationPhase = gamePhase === 'INVESTIGATION_1'
    || gamePhase === 'INVESTIGATION_2';
  const allowsChat = getPhaseConfig(gamePhase).allowsChat;
  const investigationRound = gamePhase === 'INVESTIGATION_2' ? 2 : 1;

  useEffect(() => {
    setChatMode(isDiscussionPhase ? 'group' : 'private');
  }, [isDiscussionPhase, setChatMode]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setLoadError(null);
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
        hydrateGroupMessages(data.session.groupChatHistory);
        setPhase(data.session.currentPhase);
        setDiscoveredClues(data.session.discoveredClues);
        setTransitionPhase(data.session.currentPhase);
        setTransitionOpen(true);

        if (data.scenario.characters.length > 0) {
          selectCharacter(data.scenario.characters[0].id);
        }
      } catch (fetchError) {
        if (!active) {
          return;
        }

        setLoadError(fetchError instanceof Error ? fetchError.message : 'Load failed');
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
  }, [sessionId, hydrateGroupMessages, hydrateMessages, selectCharacter, setPhase, setSessionId]);

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
    setActionError(null);

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
      setDiscoveredClues(payload.session.discoveredClues);
      setTransitionPhase(payload.session.currentPhase);
      setTransitionOpen(true);
    } catch (advanceError) {
      setActionError(advanceError instanceof Error ? advanceError.message : '阶段推进失败');
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

  if (loadError || !scenario) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-red-300">
        {loadError ?? '无法读取游戏数据'}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {isDiscussionPhase && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setChatMode('group')}
                    className={
                      chatMode === 'group'
                        ? 'bg-amber-700 text-amber-50 hover:bg-amber-600'
                        : 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                    }
                  >
                    Group Chat
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setChatMode('private')}
                    className="border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800"
                  >
                    Private Chat
                  </Button>
                </>
              )}
            </div>
            <Button
              type="button"
              onClick={advancePhase}
              disabled={advancing || !canAdvancePhase}
              className="bg-amber-700 text-amber-50 hover:bg-amber-600"
            >
              {advancing ? '推进中...' : '推进到下一阶段'}
            </Button>
          </div>
          {actionError && (
            <p className="rounded-lg border border-red-500/40 bg-red-900/20 px-3 py-2 text-sm text-red-200">
              {actionError}
            </p>
          )}
          {isInvestigationPhase ? (
            <InvestigationPanel
              sessionId={sessionId}
              locations={scenario.locations}
              round={investigationRound}
              onInvestigationComplete={session => {
                setDiscoveredClues(session.discoveredClues);
                hydrateGroupMessages(session.groupChatHistory);
              }}
            />
          ) : isDiscussionPhase && chatMode === 'group' ? (
            <GroupChat sessionId={sessionId} characters={scenario.characters} />
          ) : selectedCharacter ? (
            <ChatPanel
              sessionId={sessionId}
              character={selectedCharacter}
              disabled={!allowsChat}
              disabledReason={
                gamePhase === 'READING'
                  ? '阅读阶段仅可查看资料，暂不开放对话。'
                  : '当前阶段暂不开放聊天。'
              }
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
          {discoveredClues.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
              暂无线索。进入搜证阶段后可在地点中搜索证据。
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {discoveredClues.map(clue => (
                <div
                  key={clue.id}
                  className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-sm"
                >
                  <p className="text-slate-100">{clue.content}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {clue.type === 'public' ? '公共线索' : '私密线索'} / {clue.foundAt ?? '未知地点'}
                  </p>
                </div>
              ))}
            </div>
          )}
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
