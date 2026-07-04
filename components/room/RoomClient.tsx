'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhaseIndicator } from '@/components/game/PhaseIndicator';
import { CaseFileDrawer } from '@/components/room/CaseFileDrawer';
import {
  GroupChatPanel,
  InvestigationRoom,
  Lobby,
  Notebook,
  PrivateChatPanel,
  RevealRoom,
  RoleReveal,
  Roster,
  VotingRoom,
} from '@/components/room/RoomPanels';
import { getNextPhase } from '@/lib/game-engine/phase-manager';
import { getPlayerId, setPlayerId } from '@/lib/room/identity';
import type { ChatMessage, ClueView, PlayerRoomView } from '@/types/game';

interface RoomClientProps {
  code: string;
}

type LoadState = 'resolving' | 'need-join' | 'ready' | 'error';

// C1/C4: an in-flight NPC streaming bubble, tracked per messageId.
interface StreamBubble {
  characterId: string;
  turnId: string;
  text: string;
  updatedAt: number;
}

// How long (ms) a streaming entry may go without an update before the sweep drops it (C4 safety net).
const STREAM_STALE_MS = 30_000;

const DISCUSSION_PHASES = new Set(['DISCUSSION_1', 'DISCUSSION_2', 'FINAL_DISCUSSION']);
const INVESTIGATION_PHASES = new Set(['INVESTIGATION_1', 'INVESTIGATION_2']);

export function RoomClient({ code }: RoomClientProps) {
  const [loadState, setLoadState] = useState<LoadState>('resolving');
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerIdState] = useState<string | null>(null);
  const [view, setView] = useState<PlayerRoomView | null>(null);

  const [joinName, setJoinName] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chatTab, setChatTab] = useState<'group' | 'private'>('group');

  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  // C1/C4: one streaming bubble per in-flight NPC message, keyed by messageId. Multiple NPCs can
  // stream at once within a turn; entries are removed on the terminal npc_done/npc_error, on
  // phase_change/reveal, or by the stale-entry sweep below.
  const [streamingBubbles, setStreamingBubbles] = useState<Map<string, StreamBubble>>(new Map());
  // C3: SSE connection health banner + a transient notice for NPC failures.
  const [disconnected, setDisconnected] = useState(false);
  const [npcNotice, setNpcNotice] = useState<string | null>(null);
  // C2: host "强制推进" affordance, revealed only after the server reports awaiting_votes.
  const [forceAdvance, setForceAdvance] = useState(false);

  const playerIdRef = useRef<string | null>(null);
  playerIdRef.current = playerId;
  // C11: monotonic guard so a slow earlier /state response can't overwrite newer state.
  const refetchSeqRef = useRef(0);

  // 1. Resolve code → roomId, recover identity.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/room/resolve/${code}`, { cache: 'no-store' });
        const data = await res.json();
        if (!active) {
          return;
        }
        if (!res.ok) {
          setError(data.error ?? '房间不存在');
          setLoadState('error');
          return;
        }
        setRoomId(data.roomId);
        const existing = getPlayerId(data.roomId);
        if (existing) {
          // A returning player (has a seat) may reconnect into an in-progress or finished game.
          setPlayerIdState(existing);
        } else if (data.status !== 'lobby') {
          // C5: no local identity + the room already started/ended → block the join form.
          setError(data.status === 'finished' ? '本局游戏已结束' : '游戏已经开始，无法加入');
          setLoadState('error');
        } else {
          setLoadState('need-join');
        }
      } catch {
        if (active) {
          setError('无法连接房间');
          setLoadState('error');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [code]);

  const refetchState = useCallback(async () => {
    const rid = roomId;
    const pid = playerIdRef.current;
    if (!rid || !pid) {
      return;
    }
    // C11: stamp this request; only the newest in-flight fetch may commit to state.
    const seq = ++refetchSeqRef.current;
    // Auth is the httpOnly cookie (sent automatically for same-origin) — never a ?playerId= query.
    const res = await fetch(`/api/room/${rid}/state`, { cache: 'no-store' });
    if (seq !== refetchSeqRef.current) {
      return;
    }
    if (res.status === 403) {
      // Missing/stale seat cookie → force rejoin (also clears our local bookkeeping).
      setPlayerIdState(null);
      setLoadState('need-join');
      return;
    }
    if (res.ok) {
      const data = (await res.json()) as PlayerRoomView;
      if (seq !== refetchSeqRef.current) {
        return;
      }
      setView(data);
      setLoadState('ready');
    }
  }, [roomId]);

  // 2. Once we have an identity, load state.
  useEffect(() => {
    if (roomId && playerId) {
      refetchState();
    }
  }, [roomId, playerId, refetchState]);

  // 3. Realtime via EventSource. C3: EventSource auto-reconnects, but we also fall back to a
  // low-frequency /state poll while the stream is down and surface a reconnecting banner.
  useEffect(() => {
    if (!roomId || !playerId) {
      return;
    }
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const stopPoll = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const startPoll = () => {
      if (pollTimer === null) {
        pollTimer = setInterval(() => {
          refetchState();
        }, 5000);
      }
    };
    // EventSource sends the same-origin httpOnly seat cookie automatically — no query token needed.
    const source = new EventSource(`/api/room/${roomId}/events`);
    source.onopen = () => {
      setDisconnected(false);
      stopPoll();
    };
    source.onerror = () => {
      // The browser keeps retrying under the hood; show a banner + poll until onopen fires again.
      setDisconnected(true);
      startPoll();
    };
    source.onmessage = event => {
      let payload: { type: string; [key: string]: unknown };
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (payload.type) {
        case 'room_state':
        case 'vote_update':
        case 'presence':
          // D2: roster presence changes (connect/disconnect) — just resync the projection.
          refetchState();
          break;
        case 'seat_takeover':
        case 'host_change':
          // D2: an idle seat became NPC-controlled, or the host handed off. Resync, and flash a brief
          // notice (reuses the transient npcNotice channel).
          setNpcNotice(payload.type === 'host_change' ? '房主已变更' : '有掉线玩家的席位已由 AI 接管');
          refetchState();
          break;
        case 'phase_change':
        case 'reveal':
          // C4: a phase change (or the reveal) ends any in-flight turn — drop ghost bubbles.
          setStreamingBubbles(prev => (prev.size === 0 ? prev : new Map()));
          refetchState();
          break;
        case 'group_message':
        case 'clue_public':
          setLiveMessages(prev => [...prev, payload.message as ChatMessage]);
          break;
        case 'npc_start':
          setStreamingBubbles(prev => {
            const next = new Map(prev);
            next.set(payload.messageId as string, {
              characterId: payload.characterId as string,
              turnId: payload.turnId as string,
              text: '',
              updatedAt: Date.now(),
            });
            return next;
          });
          break;
        case 'npc_chunk':
          setStreamingBubbles(prev => {
            const messageId = payload.messageId as string;
            const existing = prev.get(messageId);
            const next = new Map(prev);
            next.set(messageId, {
              characterId: existing?.characterId ?? (payload.characterId as string),
              turnId: existing?.turnId ?? (payload.turnId as string),
              text: (existing?.text ?? '') + (payload.text as string),
              updatedAt: Date.now(),
            });
            return next;
          });
          break;
        case 'npc_done':
          // Terminal: remove the bubble and persist the finished message (dedups by id downstream).
          setStreamingBubbles(prev => {
            const messageId = payload.messageId as string;
            if (!prev.has(messageId)) {
              return prev;
            }
            const next = new Map(prev);
            next.delete(messageId);
            return next;
          });
          setLiveMessages(prev => [...prev, payload.message as ChatMessage]);
          break;
        case 'npc_error':
          // Terminal failure: drop the bubble (never persist it) and flash a brief notice.
          setStreamingBubbles(prev => {
            const messageId = payload.messageId as string;
            if (!prev.has(messageId)) {
              return prev;
            }
            const next = new Map(prev);
            next.delete(messageId);
            return next;
          });
          setNpcNotice(payload.reason === 'not_configured' ? 'AI 未配置，无法回复' : '有角色回复失败');
          break;
        default:
          break;
      }
    };
    return () => {
      stopPoll();
      source.close();
    };
  }, [roomId, playerId, refetchState]);

  // C4 safety net: drop any streaming bubble that hasn't received an update recently (e.g. a
  // dropped connection that never delivered its terminal event) so it can't linger forever.
  useEffect(() => {
    const timer = setInterval(() => {
      setStreamingBubbles(prev => {
        if (prev.size === 0) {
          return prev;
        }
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [id, bubble] of next) {
          if (now - bubble.updatedAt > STREAM_STALE_MS) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Auto-dismiss the transient NPC failure notice.
  useEffect(() => {
    if (!npcNotice) {
      return;
    }
    const timer = setTimeout(() => setNpcNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [npcNotice]);

  // Merge persisted history + live events, dedup by id, sort by time.
  const groupMessages = useMemo(() => {
    const byId = new Map<string, ChatMessage>();
    for (const message of view?.room.groupChatHistory ?? []) {
      byId.set(message.id, message);
    }
    for (const message of liveMessages) {
      byId.set(message.id, message);
    }
    return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [view?.room.groupChatHistory, liveMessages]);

  // C1: flatten the per-messageId bubble map into a render list (stable id → React key).
  const streamingList = useMemo(
    () =>
      [...streamingBubbles.entries()].map(([id, bubble]) => ({
        id,
        characterId: bubble.characterId,
        text: bubble.text,
      })),
    [streamingBubbles],
  );

  const doJoin = async () => {
    if (!roomId || joining) {
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`/api/room/${roomId}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: joinName }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? '加入失败');
      }
      setPlayerId(roomId, data.playerId);
      setPlayerIdState(data.playerId);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : '加入失败');
    } finally {
      setJoining(false);
    }
  };

  // Low-level POST that never throws — callers inspect status/code themselves (used by doAdvance
  // for the 409 stale_phase / 400 awaiting_votes flows). `data` is loosely typed like res.json().
  const actionRaw = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      if (!roomId || !playerId) {
        return null;
      }
      // The server authenticates via the seat cookie; the body carries only action data (no playerId).
      const res = await fetch(`/api/room/${roomId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },
    [roomId, playerId],
  );

  // Throwing wrapper preserved for every existing caller (start/kick/group-chat/investigate/…).
  const action = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const result = await actionRaw(path, body);
      if (!result) {
        return null;
      }
      if (!result.ok) {
        throw new Error(result.data?.error ?? '操作失败');
      }
      return result.data;
    },
    [actionRaw],
  );

  const doStart = async () => {
    setBusy(true);
    setError(null);
    try {
      await action('start', {});
      await refetchState();
    } catch (e) {
      setError(e instanceof Error ? e.message : '开始失败');
    } finally {
      setBusy(false);
    }
  };

  // C2: `force === true` is only ever passed by the explicit "强制推进" button — comparing against
  // `true` (not truthiness) means an accidental MouseEvent arg from onClick never forces.
  const doAdvance = async (force?: boolean) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await actionRaw('advance', {
        expectedPhase: view?.room.currentPhase,
        ...(force === true ? { force: true } : {}),
      });
      if (!result) {
        return;
      }
      if (result.ok) {
        setForceAdvance(false);
        await refetchState();
      } else if (result.data?.code === 'stale_phase') {
        // 409: the room already moved on — benign, just resync silently.
        setForceAdvance(false);
        await refetchState();
      } else if (result.data?.code === 'awaiting_votes') {
        // 400: not all connected humans voted — offer the host a force affordance.
        setForceAdvance(true);
        setError(result.data?.error ?? '仍有玩家未投票。');
      } else {
        setError(result.data?.error ?? '推进失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '推进失败');
    } finally {
      setBusy(false);
    }
  };

  const doKick = async (publicId: string) => {
    setError(null);
    try {
      await action('kick', { publicId });
      await refetchState();
    } catch (e) {
      setError(e instanceof Error ? e.message : '移除失败');
    }
  };

  const sendGroup = (message: string) => {
    action('group-chat', { message }).catch(e =>
      setError(e instanceof Error ? e.message : '发送失败'),
    );
  };

  // D3(a): nudge the NPCs to speak after the room goes idle (no player message).
  const sendNudge = () => {
    action('group-chat', { nudge: true }).catch(e =>
      setError(e instanceof Error ? e.message : '发送失败'),
    );
  };

  const sendPrivate = async (characterId: string, message: string) => {
    // C11: surface failures via setError instead of leaving an unhandled rejection; the panel still
    // gets a resolved Promise<void> so its own "sending" state clears.
    try {
      await action('private-chat', { targetCharacterId: characterId, message });
      await refetchState();
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败');
    }
  };

  const investigate = async (
    locationId: string,
  ): Promise<{ locationName: string; newlyFound: ClueView[] } | null> => {
    const data = await action('investigate', { locationId });
    await refetchState();
    return data?.result ?? null;
  };

  const vote = async (characterId: string) => {
    // C11: same contract as sendPrivate — errors surface via setError, promise still resolves.
    try {
      await action('vote', { accusedCharacterId: characterId });
      await refetchState();
    } catch (e) {
      setError(e instanceof Error ? e.message : '投票失败');
    }
  };

  const presentClue = async (clueId: string) => {
    try {
      await action('present-clue', { clueId });
      await refetchState();
    } catch (e) {
      setError(e instanceof Error ? e.message : '出示线索失败');
    }
  };

  // ---- render ----

  if (loadState === 'error') {
    return (
      <Centered>
        <p className="text-red-300">{error ?? '出错了'}</p>
      </Centered>
    );
  }

  if (loadState === 'need-join') {
    return (
      <Centered>
        <div className="w-full max-w-sm rounded-2xl border border-slate-700/70 bg-slate-950/70 p-6">
          <h1 className="text-xl font-semibold text-amber-100">加入房间 {code.toUpperCase()}</h1>
          <p className="mt-1 text-sm text-slate-400">输入你的昵称即可加入。</p>
          <Input
            value={joinName}
            onChange={e => setJoinName(e.target.value)}
            placeholder="你的昵称"
            className="mt-4 border-slate-600 bg-slate-900/80 text-slate-100"
          />
          {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
          <Button onClick={doJoin} disabled={joining} className="mt-4 w-full bg-amber-700 text-amber-50 hover:bg-amber-600">
            {joining ? '加入中...' : '加入'}
          </Button>
        </div>
      </Centered>
    );
  }

  if (loadState !== 'ready' || !view) {
    return <Centered><p className="text-slate-300">正在进入房间...</p></Centered>;
  }

  const phase = view.room.currentPhase;
  const isHost = view.you.isHost;
  const inProgress = view.room.status === 'in_progress';
  const showAdvance = isHost && inProgress && phase !== 'REVEAL' && getNextPhase(phase) !== null;
  const advanceLabel = phase === 'VOTING' ? '进入真相揭晓' : phase === 'READING' ? '开始游戏' : '推进到下一阶段';

  return (
    <main className="min-h-screen bg-[linear-gradient(160deg,#020617,#0f172a_45%,#111827)] text-slate-100">
      <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-amber-300/90">AI 剧本杀 · 房间 {view.room.code}</p>
            <h1 className="mt-1 text-xl font-semibold text-amber-100">{view.scenario.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            {view.yourCharacter && (
              <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-100">
                你扮演：{view.yourCharacter.name}
              </span>
            )}
            {showAdvance && (
              <Button onClick={() => doAdvance()} disabled={busy} className="bg-amber-700 text-amber-50 hover:bg-amber-600">
                {busy ? '...' : advanceLabel}
              </Button>
            )}
            {showAdvance && forceAdvance && (
              <Button
                onClick={() => doAdvance(true)}
                disabled={busy}
                variant="outline"
                className="border-rose-500/50 bg-rose-900/20 text-rose-100 hover:bg-rose-900/40"
              >
                强制推进
              </Button>
            )}
          </div>
        </header>

        {inProgress && (
          <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <PhaseIndicator
              phase={phase}
              sequence={view.room.phaseSequence}
              suggestedDuration={view.scenario.phaseDurations?.[phase]}
            />
            <Roster view={view} />
          </div>
        )}
        {(disconnected || npcNotice) && (
          <div className="mb-4 flex flex-wrap justify-center gap-2">
            {disconnected && (
              <span className="rounded-full border border-amber-500/40 bg-amber-900/20 px-3 py-1 text-xs text-amber-200">
                连接中断，正在重连…
              </span>
            )}
            {npcNotice && (
              <span className="rounded-full border border-rose-500/30 bg-rose-900/20 px-3 py-1 text-xs text-rose-200">
                {npcNotice}
              </span>
            )}
          </div>
        )}
        {error && (
          <p className="mb-4 rounded-lg border border-red-500/40 bg-red-900/20 px-3 py-2 text-sm text-red-200">{error}</p>
        )}

        {view.room.status === 'lobby' && (
          <Lobby view={view} onStart={doStart} starting={busy} onKick={doKick} />
        )}

        {phase === 'READING' && inProgress && (
          <RoleReveal view={view} onAdvance={doAdvance} advancing={busy} />
        )}

        {(phase === 'INTRO' || DISCUSSION_PHASES.has(phase)) && inProgress && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <div className="mb-3 flex gap-2">
                <TabButton active={chatTab === 'group'} onClick={() => setChatTab('group')}>群聊</TabButton>
                <TabButton active={chatTab === 'private'} onClick={() => setChatTab('private')}>私聊 AI</TabButton>
              </div>
              {chatTab === 'group' ? (
                <GroupChatPanel
                  view={view}
                  messages={groupMessages}
                  streaming={streamingList}
                  onSend={sendGroup}
                  onNudge={sendNudge}
                />
              ) : (
                <PrivateChatPanel view={view} onSend={sendPrivate} />
              )}
            </div>
            <Notebook view={view} onPresent={presentClue} />
          </div>
        )}

        {INVESTIGATION_PHASES.has(phase) && inProgress && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <InvestigationRoom view={view} onInvestigate={investigate} />
            <Notebook view={view} onPresent={presentClue} />
          </div>
        )}

        {/* D5(a): the defense/vote round keeps its group chat (mirrors the discussion layout). */}
        {phase === 'VOTING' && inProgress && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <VotingRoom view={view} onVote={vote} />
              <div>
                <div className="mb-3 flex gap-2">
                  <TabButton active={chatTab === 'group'} onClick={() => setChatTab('group')}>群聊</TabButton>
                  <TabButton active={chatTab === 'private'} onClick={() => setChatTab('private')}>私聊 AI</TabButton>
                </div>
                {chatTab === 'group' ? (
                  <GroupChatPanel
                    view={view}
                    messages={groupMessages}
                    streaming={streamingList}
                    onSend={sendGroup}
                    onNudge={sendNudge}
                  />
                ) : (
                  <PrivateChatPanel view={view} onSend={sendPrivate} />
                )}
              </div>
            </div>
            <Notebook view={view} onPresent={presentClue} />
          </div>
        )}

        {phase === 'REVEAL' && <RevealRoom view={view} />}

        {/* D1: always-on case-file + own-script reference. LOBBY has no assigned character; REVEAL
            already discloses everything, so it is intentionally not mounted in those states. */}
        {inProgress && phase !== 'REVEAL' && <CaseFileDrawer view={view} />}
      </div>
    </main>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-lg px-4 py-1.5 text-sm transition',
        active ? 'bg-amber-700 text-amber-50' : 'bg-slate-900 text-slate-200 hover:bg-slate-800',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center">
      {children}
    </main>
  );
}
