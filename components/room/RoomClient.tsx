'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhaseIndicator } from '@/components/game/PhaseIndicator';
import {
  GroupChatPanel,
  InvestigationRoom,
  Lobby,
  Notebook,
  PrivateChatPanel,
  RevealRoom,
  RoleReveal,
  VotingRoom,
} from '@/components/room/RoomPanels';
import { getNextPhase } from '@/lib/game-engine/phase-manager';
import { getPlayerId, setPlayerId } from '@/lib/room/identity';
import type { ChatMessage, ClueView, PlayerRoomView } from '@/types/game';

interface RoomClientProps {
  code: string;
}

type LoadState = 'resolving' | 'need-join' | 'ready' | 'error';

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
  const [streaming, setStreaming] = useState<{ characterId: string; text: string } | null>(null);

  const playerIdRef = useRef<string | null>(null);
  playerIdRef.current = playerId;

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
          setPlayerIdState(existing);
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
    // Auth is the httpOnly cookie (sent automatically for same-origin) — never a ?playerId= query.
    const res = await fetch(`/api/room/${rid}/state`, { cache: 'no-store' });
    if (res.status === 403) {
      // Missing/stale seat cookie → force rejoin (also clears our local bookkeeping).
      setPlayerIdState(null);
      setLoadState('need-join');
      return;
    }
    if (res.ok) {
      const data = (await res.json()) as PlayerRoomView;
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

  // 3. Realtime via EventSource.
  useEffect(() => {
    if (!roomId || !playerId) {
      return;
    }
    // EventSource sends the same-origin httpOnly seat cookie automatically — no query token needed.
    const source = new EventSource(`/api/room/${roomId}/events`);
    source.onmessage = event => {
      let payload: { type: string; [key: string]: unknown };
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (payload.type) {
        case 'room_state':
        case 'phase_change':
        case 'reveal':
        case 'vote_update':
          refetchState();
          break;
        case 'group_message':
        case 'clue_public':
          setLiveMessages(prev => [...prev, payload.message as ChatMessage]);
          break;
        case 'npc_start':
          setStreaming({ characterId: payload.characterId as string, text: '' });
          break;
        case 'npc_chunk':
          setStreaming(prev => ({
            characterId: payload.characterId as string,
            text: (prev?.text ?? '') + (payload.text as string),
          }));
          break;
        case 'npc_done':
          setLiveMessages(prev => [...prev, payload.message as ChatMessage]);
          setStreaming(null);
          break;
        default:
          break;
      }
    };
    return () => source.close();
  }, [roomId, playerId, refetchState]);

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

  const action = useCallback(
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
      if (!res.ok) {
        throw new Error(data?.error ?? '操作失败');
      }
      return data;
    },
    [roomId, playerId],
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

  const doAdvance = async () => {
    setBusy(true);
    setError(null);
    try {
      await action('advance', {});
      await refetchState();
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

  const sendPrivate = async (characterId: string, message: string) => {
    await action('private-chat', { targetCharacterId: characterId, message });
    await refetchState();
  };

  const investigate = async (
    locationId: string,
  ): Promise<{ locationName: string; newlyFound: ClueView[] } | null> => {
    const data = await action('investigate', { locationId });
    await refetchState();
    return data?.result ?? null;
  };

  const vote = async (characterId: string) => {
    await action('vote', { accusedCharacterId: characterId });
    await refetchState();
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
              <Button onClick={doAdvance} disabled={busy} className="bg-amber-700 text-amber-50 hover:bg-amber-600">
                {busy ? '...' : advanceLabel}
              </Button>
            )}
          </div>
        </header>

        {inProgress && <div className="mb-4"><PhaseIndicator phase={phase} /></div>}
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
                <GroupChatPanel view={view} messages={groupMessages} streaming={streaming} onSend={sendGroup} />
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

        {phase === 'VOTING' && inProgress && <VotingRoom view={view} onVote={vote} />}

        {phase === 'REVEAL' && <RevealRoom view={view} />}
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
