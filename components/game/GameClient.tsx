'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { CharacterCard } from '@/components/game/CharacterCard';
import { ChatPanel } from '@/components/game/ChatPanel';
import { GroupChat } from '@/components/game/GroupChat';
import { InvestigationPanel } from '@/components/game/InvestigationPanel';
import { PhaseIndicator } from '@/components/game/PhaseIndicator';
import { PhaseTransition } from '@/components/game/PhaseTransition';
import { RevealPanel } from '@/components/game/RevealPanel';
import { SceneImage } from '@/components/game/SceneImage';
import { VotingPanel } from '@/components/game/VotingPanel';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PHASE_LABELS, getNextPhase, getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { useGameStore } from '@/lib/store/game-store';
import type {
  Clue,
  CreateGameResponse,
  GamePhase,
  GameStateResponse,
  Scenario,
  VoteResponse,
} from '@/types/game';

interface GameClientProps {
  sessionId: string;
}

const PLAYER_VOTER_ID = 'player';
const DEFAULT_KILLER_ID = 'wang-daming';

interface PhaseScene {
  src?: string;
  title: string;
  subtitle: string;
}

function resolvePhaseScene(scenario: Scenario, phase: GamePhase): PhaseScene {
  const images = scenario.setting.images;

  if (phase === 'DISCUSSION_1' || phase === 'DISCUSSION_2' || phase === 'FINAL_DISCUSSION') {
    return {
      src: images?.livingRoom,
      title: '客厅讨论区',
      subtitle: '火光摇曳的公共空间里，每一句口供都可能藏着新的矛盾。',
    };
  }

  if (phase === 'INVESTIGATION_1' || phase === 'INVESTIGATION_2' || phase === 'VOTING' || phase === 'REVEAL') {
    return {
      src: images?.crimeScene,
      title: '书房案发现场',
      subtitle: '密室、毒酒与旧案线索在这里交汇，细节决定最终结论。',
    };
  }

  if (phase === 'LOBBY') {
    return {
      src: images?.diningHall ?? images?.exterior,
      title: '山庄大厅',
      subtitle: '风雪封山，所有人被迫同席而坐，危险刚刚开始。',
    };
  }

  return {
    src: images?.exterior,
    title: '山庄外景',
    subtitle: '暴风雪吞没了归路，也将每个人的秘密困在同一栋宅邸中。',
  };
}

export function GameClient({ sessionId }: GameClientProps) {
  const router = useRouter();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [playerCharacterId, setPlayerCharacterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creatingNewGame, setCreatingNewGame] = useState(false);
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
  const hasVoted = useGameStore(state => state.hasVoted);
  const votedAccusedId = useGameStore(state => state.votedAccusedId);
  const voteIsCorrect = useGameStore(state => state.voteIsCorrect);
  const setVoteResult = useGameStore(state => state.setVoteResult);
  const resetVoteResult = useGameStore(state => state.resetVoteResult);

  const isDiscussionPhase = gamePhase === 'DISCUSSION_1'
    || gamePhase === 'DISCUSSION_2'
    || gamePhase === 'FINAL_DISCUSSION';
  const isInvestigationPhase = gamePhase === 'INVESTIGATION_1'
    || gamePhase === 'INVESTIGATION_2';
  const isVotingPhase = gamePhase === 'VOTING';
  const isRevealPhase = gamePhase === 'REVEAL';
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

        const data = (await response.json()) as GameStateResponse & { error?: string };

        if (!response.ok) {
          throw new Error(data.error ?? 'Session not found');
        }

        if (!active) {
          return;
        }

        const existingVoteId = data.session.votes[PLAYER_VOTER_ID];
        if (existingVoteId) {
          const killerId = data.scenario.characters.find(character => character.isKiller)?.id ?? DEFAULT_KILLER_ID;
          setVoteResult(existingVoteId, existingVoteId === killerId);
        } else {
          resetVoteResult();
        }

        setScenario(data.scenario);
        setPlayerCharacterId(data.session.playerCharacterId ?? null);
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
  }, [
    sessionId,
    hydrateGroupMessages,
    hydrateMessages,
    resetVoteResult,
    selectCharacter,
    setPhase,
    setSessionId,
    setVoteResult,
  ]);

  const selectedCharacter = useMemo(() => {
    if (!scenario || !selectedCharacterId) {
      return null;
    }

    return scenario.characters.find(character => character.id === selectedCharacterId) ?? null;
  }, [scenario, selectedCharacterId]);

  const playerCharacter = useMemo(() => {
    if (!scenario || !playerCharacterId) {
      return null;
    }

    return scenario.characters.find(character => character.id === playerCharacterId) ?? null;
  }, [playerCharacterId, scenario]);

  const phaseScene = useMemo(
    () => (scenario ? resolvePhaseScene(scenario, gamePhase) : null),
    [gamePhase, scenario],
  );

  const canAdvancePhase = getNextPhase(gamePhase) !== null;

  const startNewGame = async () => {
    if (creatingNewGame || !scenario) {
      return;
    }

    setCreatingNewGame(true);
    setActionError(null);

    try {
      const response = await fetch('/api/game/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scenarioId: scenario.id }),
      });

      const payload = (await response.json()) as CreateGameResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? '创建新游戏失败');
      }

      router.push(`/game/${payload.sessionId}`);
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : '创建新游戏失败');
    } finally {
      setCreatingNewGame(false);
    }
  };

  const advancePhase = async (): Promise<boolean> => {
    if (advancing || !canAdvancePhase) {
      return false;
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
      return true;
    } catch (advanceError) {
      setActionError(advanceError instanceof Error ? advanceError.message : '阶段推进失败');
      return false;
    } finally {
      setAdvancing(false);
    }
  };

  const handleVoteSubmitted = async (result: VoteResponse) => {
    setVoteResult(result.accusedId, result.isCorrect);
    const advanced = await advancePhase();

    if (!advanced) {
      setActionError('投票已提交，但自动进入揭晓阶段失败。请点击“进入真相揭晓”重试。');
    }
  };

  const advanceDisabled = advancing
    || !canAdvancePhase
    || (isVotingPhase && !hasVoted);

  const advanceLabel = (() => {
    if (advancing) {
      return '推进中...';
    }

    if (isVotingPhase && !hasVoted) {
      return '完成投票后可推进';
    }

    if (isVotingPhase) {
      return '进入真相揭晓';
    }

    return '推进到下一阶段';
  })();

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
      <div className="mx-auto max-w-[1500px] px-4 py-4 lg:px-6 lg:py-6">
        <header className="mb-4 rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.26em] text-amber-300/90">AI Murder Mystery</p>
              <h1 className="mt-2 text-2xl font-semibold text-amber-100">{scenario.title}</h1>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={startNewGame}
              disabled={creatingNewGame}
              className="bg-slate-200 text-slate-950 hover:bg-slate-300"
            >
              {creatingNewGame ? '创建新局中...' : 'New Game'}
            </Button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{scenario.description}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
            <span className="rounded-md border border-slate-600/70 bg-slate-900/70 px-2 py-1">
              地点：{scenario.setting.location}
            </span>
            <span className="rounded-md border border-slate-600/70 bg-slate-900/70 px-2 py-1">
              时代：{scenario.setting.era}
            </span>
            <span className="rounded-md border border-slate-600/70 bg-slate-900/70 px-2 py-1">
              预计时长：{scenario.estimatedDuration} 分钟
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.22em] text-amber-200/90">玩家身份</p>
            {playerCharacter ? (
              <div className="mt-2 space-y-1 text-sm text-amber-50/95">
                <p className="font-semibold">
                  你扮演 {playerCharacter.name}（{playerCharacter.age}岁，{playerCharacter.occupation}）
                </p>
                <p className="text-amber-50/90">性格：{playerCharacter.personality}</p>
                <p className="leading-relaxed text-amber-50/90">公开信息：{playerCharacter.publicInfo}</p>
              </div>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-amber-50/95">
                你是一名被困在山庄的侦探，需要通过与其他宾客交谈、梳理线索并在投票阶段指出凶手。
              </p>
            )}
          </div>
        </header>

        {phaseScene && (
          <SceneImage
            src={phaseScene.src}
            alt={phaseScene.title}
            title={phaseScene.title}
            subtitle={phaseScene.subtitle}
            badge={`当前阶段 · ${PHASE_LABELS[gamePhase]}`}
            className="mb-4"
          />
        )}

        <div className="grid min-h-[72vh] grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)_300px]">
          <aside className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur lg:min-h-0">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Characters / NPC档案</p>
            <h2 className="mt-2 text-lg font-semibold text-amber-100">可对话角色</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              点击任意角色可切换私聊对象；每位角色均展示名字、年龄、职业、性格与公开信息。
            </p>

            <ScrollArea className="mt-4 h-[50vh] pr-2 lg:h-[calc(72vh-8rem)]">
              <div className="space-y-2">
                {scenario.characters.map(character => (
                  <CharacterCard
                    key={character.id}
                    character={character}
                    selected={character.id === selectedCharacterId}
                    onClick={() => selectCharacter(character.id)}
                  />
                ))}
              </div>
            </ScrollArea>
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
              {!isRevealPhase && (
                <Button
                  type="button"
                  onClick={advancePhase}
                  disabled={advanceDisabled}
                  className="bg-amber-700 text-amber-50 hover:bg-amber-600"
                >
                  {advanceLabel}
                </Button>
              )}
            </div>
            {actionError && (
              <p className="rounded-lg border border-red-500/40 bg-red-900/20 px-3 py-2 text-sm text-red-200">
                {actionError}
              </p>
            )}
            {isRevealPhase ? (
              <RevealPanel
                key={`${votedAccusedId ?? 'none'}-${String(voteIsCorrect)}`}
                scenario={scenario}
                votedAccusedId={votedAccusedId}
                voteIsCorrect={voteIsCorrect}
              />
            ) : isVotingPhase ? (
              <VotingPanel
                sessionId={sessionId}
                characters={scenario.characters}
                hasVoted={hasVoted}
                votedAccusedId={votedAccusedId}
                onVoteSubmitted={handleVoteSubmitted}
              />
            ) : isInvestigationPhase ? (
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
      </div>

      <PhaseTransition
        open={transitionOpen}
        phase={transitionPhase}
        onContinue={() => setTransitionOpen(false)}
      />
    </main>
  );
}
