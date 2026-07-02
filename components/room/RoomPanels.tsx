'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getPhaseConfig, PHASE_LABELS } from '@/lib/game-engine/phase-manager';
import type { ChatMessage, ClueView, PlayerRoomView } from '@/types/game';

export function nameMapOf(view: PlayerRoomView): Map<string, string> {
  return new Map(view.scenario.characters.map(character => [character.id, character.name]));
}

export function humanCharacterIds(view: PlayerRoomView): Set<string> {
  return new Set(
    view.room.players
      .map(player => player.assignedCharacterId)
      .filter((id): id is string => Boolean(id)),
  );
}

// ---------- Roster presence bits (D2) ----------
// Public-safe: reads only PublicPlayer fields (connected / controlledByNpc). Never a raw playerId.

function PresenceDot({ connected }: { connected: boolean }) {
  return (
    <span
      aria-label={connected ? '在线' : '离线'}
      title={connected ? '在线' : '离线'}
      className={[
        'inline-block h-2 w-2 shrink-0 rounded-full',
        connected ? 'bg-emerald-400' : 'bg-slate-500',
      ].join(' ')}
    />
  );
}

function NpcChip() {
  return (
    <span className="rounded-full border border-sky-500/40 bg-sky-900/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-200">
      AI 接管
    </span>
  );
}

// ---------- Lobby ----------

export function Lobby({
  view,
  onStart,
  starting,
  onKick,
}: {
  view: PlayerRoomView;
  onStart: () => void;
  starting: boolean;
  onKick?: (publicId: string) => void;
}) {
  const isHost = view.you.isHost;
  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/room/${view.room.code}` : '';
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-6 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.24em] text-amber-300/90">Lobby · 等待玩家</p>
      <h2 className="mt-1 text-2xl font-semibold text-amber-100">{view.scenario.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">{view.scenario.description}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-lg tracking-[0.3em] text-amber-100">
          {view.room.code}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800"
          onClick={() => {
            if (shareUrl) {
              navigator.clipboard?.writeText(shareUrl).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }
          }}
        >
          {copied ? '已复制链接' : '复制邀请链接'}
        </Button>
        <span className="text-xs text-slate-400">把房间码或链接发给朋友即可加入</span>
      </div>

      <div className="mt-5">
        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
          玩家（{view.room.players.length}/{view.scenario.characters.length}）
        </p>
        <ul className="mt-2 space-y-2">
          {view.room.players.map(player => (
            <li
              key={player.publicId}
              className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2 text-slate-100">
                <PresenceDot connected={player.connected} />
                <span>
                  {player.name}
                  {player.isSelf && <span className="ml-1 text-amber-300">（你）</span>}
                </span>
                {player.controlledByNpc && <NpcChip />}
              </span>
              <span className="flex items-center gap-2">
                {player.isHost && <span className="text-xs text-amber-300">房主</span>}
                {isHost && !player.isSelf && !player.isHost && onKick && (
                  <button
                    type="button"
                    onClick={() => onKick(player.publicId)}
                    className="rounded-md border border-rose-500/40 px-2 py-0.5 text-xs text-rose-200 hover:bg-rose-900/30"
                  >
                    移除
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        {isHost ? (
          <Button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="bg-amber-700 text-amber-50 hover:bg-amber-600"
          >
            {starting ? '开始中...' : '开始游戏（随机分配角色）'}
          </Button>
        ) : (
          <p className="text-sm text-slate-400">等待房主开始游戏...</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          未被玩家选中的角色将由 AI 扮演。开始后将随机为每位玩家分配一个角色。
        </p>
      </div>
    </div>
  );
}

// ---------- In-progress roster (D2) ----------
// Compact presence list for the in-progress game (host/next-worker mounts this in RoomClient). Keyed
// by publicId; renders only public player fields — never a raw playerId or any private role data.

export function Roster({ view }: { view: PlayerRoomView }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">玩家在场</p>
      <ul className="mt-3 space-y-2">
        {view.room.players.map(player => (
          <li
            key={player.publicId}
            className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2 text-slate-100">
              <PresenceDot connected={player.connected} />
              <span>
                {player.name}
                {player.isSelf && <span className="ml-1 text-amber-300">（你）</span>}
              </span>
              {player.controlledByNpc && <NpcChip />}
            </span>
            {player.isHost && <span className="text-xs text-amber-300">房主</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Role reveal (READING) ----------

export function RoleReveal({
  view,
  onAdvance,
  advancing,
}: {
  view: PlayerRoomView;
  onAdvance: () => void;
  advancing: boolean;
}) {
  const character = view.yourCharacter;
  const isHost = view.you.isHost;

  if (!character) {
    return (
      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-6 text-slate-300">
        正在分配角色...
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-6 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.24em] text-amber-300/90">你的角色（仅你可见）</p>
      <h2 className="mt-1 text-2xl font-semibold text-amber-100">
        {character.name}（{character.age}岁 · {character.occupation}）
      </h2>

      <Section title="性格">{character.personality}</Section>
      <Section title="说话风格">{character.speakingStyle}</Section>
      <Section title="公开信息（所有人都知道）">{character.publicInfo}</Section>
      <Section title="你的私密剧本（绝密）">{character.privateScript}</Section>

      {character.alibi && (
        <Section title="你的不在场证明">
          <p>对外宣称：{character.alibi.claimed}</p>
          <p className="mt-1 text-amber-200/90">真实行踪：{character.alibi.truth}</p>
        </Section>
      )}

      {character.objectives.length > 0 && (
        <Section title="你的任务">
          <ul className="list-disc space-y-1 pl-5">
            {character.objectives.map((objective, index) => (
              <li key={index}>{objective.description}</li>
            ))}
          </ul>
        </Section>
      )}

      {character.secrets.length > 0 && (
        <Section title="你想隐瞒的秘密">
          <ul className="list-disc space-y-1 pl-5">
            {character.secrets.map((secret, index) => (
              <li key={index}>{secret}</li>
            ))}
          </ul>
        </Section>
      )}

      <div className="mt-6">
        {isHost ? (
          <Button
            type="button"
            onClick={onAdvance}
            disabled={advancing}
            className="bg-amber-700 text-amber-50 hover:bg-amber-600"
          >
            {advancing ? '推进中...' : '所有人已读完，开始游戏'}
          </Button>
        ) : (
          <p className="text-sm text-slate-400">读完你的剧本后，等待房主推进到下一阶段。</p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{title}</p>
      <div className="mt-1 text-sm leading-relaxed text-slate-200">{children}</div>
    </div>
  );
}

// ---------- Group chat ----------

export function GroupChatPanel({
  view,
  messages,
  streaming,
  onSend,
  onNudge,
}: {
  view: PlayerRoomView;
  messages: ChatMessage[];
  // C1: one entry per NPC currently streaming this turn (multiple can type at once).
  streaming: { id: string; characterId: string; text: string }[];
  onSend: (message: string) => void;
  // D3(a): optional — when provided, a "催一下" button prompts the NPCs after the room goes idle.
  // The current RoomClient call-site does not pass it yet; a later worker wires it up.
  onNudge?: () => void;
}) {
  const names = useMemo(() => nameMapOf(view), [view]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  // D3(a): client-side idle detection. `idle` flips true ~25s after the last chat activity (a new
  // message or a streaming-state change) and resets on every such change — same deps as auto-scroll.
  const [idle, setIdle] = useState(false);
  // Post-click debounce so one nudge can't be spammed.
  const [nudgeCooling, setNudgeCooling] = useState(false);
  const nudgeCooldownRef = useRef<number | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming]);

  useEffect(() => {
    const timer = window.setTimeout(() => setIdle(true), 25000);
    // Reset on every activity change (cleanup runs before the next effect) so a fresh 25s window starts.
    return () => {
      window.clearTimeout(timer);
      setIdle(false);
    };
  }, [messages, streaming]);

  useEffect(() => () => {
    if (nudgeCooldownRef.current !== null) {
      window.clearTimeout(nudgeCooldownRef.current);
    }
  }, []);

  const allowsChat = getPhaseConfig(view.room.currentPhase).allowsChat;
  // Enabled only when a handler exists, the room has gone idle, chat is open, nothing is streaming,
  // and we are not in the post-click cooldown. Never rendered/enabled when onNudge is undefined.
  const nudgeReady = Boolean(onNudge) && idle && allowsChat && streaming.length === 0 && !nudgeCooling;

  const nudge = () => {
    if (!onNudge || !nudgeReady) {
      return;
    }
    onNudge();
    setNudgeCooling(true);
    if (nudgeCooldownRef.current !== null) {
      window.clearTimeout(nudgeCooldownRef.current);
    }
    nudgeCooldownRef.current = window.setTimeout(() => {
      setNudgeCooling(false);
      nudgeCooldownRef.current = null;
    }, 8000);
  };

  const speakerName = (message: ChatMessage): string => {
    if (message.role === 'player') {
      if (message.playerId === view.you.id) {
        return '你';
      }
      return message.characterId ? names.get(message.characterId) ?? '玩家' : '玩家';
    }
    return message.characterId ? names.get(message.characterId) ?? '角色' : '角色';
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) {
      return;
    }
    onSend(value);
    setInput('');
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-slate-700/70 bg-slate-950/70 backdrop-blur">
      <div className="border-b border-slate-700/60 px-4 py-3">
        <p className="text-sm font-semibold text-amber-100">公共讨论区</p>
        <p className="text-xs text-slate-400">你以「{view.yourCharacter?.name ?? '你的角色'}」的身份发言；AI 角色会参与讨论。</p>
      </div>

      <ScrollArea className="h-0 flex-1 px-4 py-3">
        <div className="space-y-3 pr-2">
          {messages.map(message => {
            if (message.role === 'system') {
              return (
                <div key={message.id} className="flex justify-center">
                  <div className="max-w-[92%] rounded-xl border border-amber-500/30 bg-amber-900/15 px-3 py-2 text-xs text-amber-100">
                    {message.content}
                  </div>
                </div>
              );
            }
            const mine = message.role === 'player' && message.playerId === view.you.id;
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={[
                    'max-w-[82%] rounded-2xl px-3 py-2 text-sm',
                    mine ? 'bg-amber-700/90 text-amber-50' : 'bg-slate-800/90 text-slate-100',
                  ].join(' ')}
                >
                  {!mine && <p className="mb-0.5 text-xs font-semibold text-amber-200/90">{speakerName(message)}</p>}
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            );
          })}

          {streaming.map(bubble => (
            <div key={bubble.id} className="flex justify-start">
              <div className="max-w-[82%] rounded-2xl bg-slate-800/90 px-3 py-2 text-sm text-slate-100">
                <p className="mb-0.5 text-xs font-semibold text-amber-200/90">
                  {names.get(bubble.characterId) ?? '角色'}
                </p>
                <p className="whitespace-pre-wrap">{bubble.text || '正在输入…'}</p>
              </div>
            </div>
          ))}

          <div ref={endRef} />
        </div>
      </ScrollArea>

      <form onSubmit={submit} className="flex gap-2 border-t border-slate-700/60 p-3">
        <Input
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder="在公共讨论中发言..."
          className="border-slate-600 bg-slate-900/80 text-slate-100 placeholder:text-slate-500"
        />
        {/* D3(a): only mounted when a handler is wired; disabled until the room is idle. */}
        {onNudge && (
          <Button
            type="button"
            onClick={nudge}
            disabled={!nudgeReady}
            variant="outline"
            className="border-amber-500/50 bg-amber-900/20 text-amber-100 hover:bg-amber-900/40"
          >
            催一下
          </Button>
        )}
        <Button type="submit" disabled={!input.trim()} className="bg-amber-700 text-amber-50 hover:bg-amber-600">
          发送
        </Button>
      </form>
    </div>
  );
}

// ---------- Private chat (human → NPC) ----------

export function PrivateChatPanel({
  view,
  onSend,
}: {
  view: PlayerRoomView;
  onSend: (characterId: string, message: string) => Promise<void>;
}) {
  const names = useMemo(() => nameMapOf(view), [view]);
  const humans = useMemo(() => humanCharacterIds(view), [view]);
  const npcCharacters = useMemo(
    () => view.scenario.characters.filter(character => !humans.has(character.id)),
    [humans, view.scenario.characters],
  );

  const [targetId, setTargetId] = useState<string | null>(npcCharacters[0]?.id ?? null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const thread = (targetId ? view.room.yourPrivateChats[targetId] : undefined) ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread.length, sending]);

  if (npcCharacters.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 text-sm text-slate-400">
        本局所有角色都由真人扮演，请在公共讨论区交流。
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value || !targetId || sending) {
      return;
    }
    setSending(true);
    setInput('');
    try {
      await onSend(targetId, value);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-2xl border border-slate-700/70 bg-slate-950/70 backdrop-blur">
      <div className="border-b border-slate-700/60 px-4 py-3">
        <p className="text-sm font-semibold text-amber-100">私聊 AI 角色</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {npcCharacters.map(character => (
            <button
              key={character.id}
              type="button"
              onClick={() => setTargetId(character.id)}
              className={[
                'rounded-full border px-3 py-1 text-xs transition',
                character.id === targetId
                  ? 'border-amber-500/70 bg-amber-900/30 text-amber-100'
                  : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500',
              ].join(' ')}
            >
              {character.name}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="h-0 flex-1 px-4 py-3">
        <div className="space-y-3 pr-2">
          {thread.map(message => {
            const mine = message.role === 'player';
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={[
                    'max-w-[82%] rounded-2xl px-3 py-2 text-sm',
                    mine ? 'bg-amber-700/90 text-amber-50' : 'bg-slate-800/90 text-slate-100',
                  ].join(' ')}
                >
                  {!mine && (
                    <p className="mb-0.5 text-xs font-semibold text-amber-200/90">
                      {targetId ? names.get(targetId) : ''}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            );
          })}
          {sending && <p className="text-xs text-slate-400">对方正在回复...</p>}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <form onSubmit={submit} className="flex gap-2 border-t border-slate-700/60 p-3">
        <Input
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder={`私聊 ${targetId ? names.get(targetId) ?? '' : ''}...`}
          disabled={sending}
          className="border-slate-600 bg-slate-900/80 text-slate-100 placeholder:text-slate-500"
        />
        <Button type="submit" disabled={sending || !input.trim()} className="bg-amber-700 text-amber-50 hover:bg-amber-600">
          发送
        </Button>
      </form>
    </div>
  );
}

// ---------- Investigation ----------

export function InvestigationRoom({
  view,
  onInvestigate,
}: {
  view: PlayerRoomView;
  onInvestigate: (locationId: string) => Promise<{ locationName: string; newlyFound: ClueView[] } | null>;
}) {
  const [selected, setSelected] = useState<string | null>(view.scenario.locations[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ locationName: string; newlyFound: ClueView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // C8: per-phase search budget (server also enforces it — this is just UX).
  const remaining = Math.max(0, view.room.investigationBudget - view.room.yourInvestigationsThisPhase);
  const exhausted = remaining <= 0;

  const run = async () => {
    if (!selected || busy || exhausted) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await onInvestigate(selected);
      if (outcome) {
        setResult(outcome);
      }
    } catch (investigateError) {
      setError(investigateError instanceof Error ? investigateError.message : '搜证失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Investigation · 第 {view.room.round} 轮搜证</p>
      <h2 className="mt-1 text-lg font-semibold text-amber-100">选择一个地点搜查</h2>
      <p className="mt-1 text-sm text-slate-300">
        本阶段剩余搜证次数：{remaining}/{view.room.investigationBudget}
      </p>
      {/* D6: static hint only — never expose clue content/significance/prerequisite ids or counts. */}
      <p className="mt-1 text-xs text-slate-400">部分线索需先找到前置线索后才能获取。</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {view.scenario.locations.map(location => (
          <button
            key={location.id}
            type="button"
            onClick={() => setSelected(location.id)}
            className={[
              'rounded-xl border p-3 text-left transition',
              location.id === selected
                ? 'border-amber-500/60 bg-amber-900/20'
                : 'border-slate-700 bg-slate-900/60 hover:border-slate-500',
            ].join(' ')}
          >
            <p className="font-medium text-slate-100">{location.name}</p>
            <p className="mt-1 text-xs text-slate-400">{location.description}</p>
          </button>
        ))}
      </div>

      <div className="mt-4">
        <Button type="button" onClick={run} disabled={!selected || busy || exhausted} className="bg-amber-700 text-amber-50 hover:bg-amber-600">
          {busy ? '搜证中...' : exhausted ? '本阶段搜证已用完' : '开始搜证'}
        </Button>
      </div>

      {error && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-900/20 px-3 py-2 text-sm text-red-200">{error}</p>}

      {result && (
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-3">
          <p className="text-sm font-medium text-amber-100">搜查：{result.locationName}</p>
          {result.newlyFound.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm text-slate-200">
              {result.newlyFound.map(clue => (
                <li key={clue.id} className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2">
                  <p>{clue.content}</p>
                  <p className="mt-1 text-xs text-slate-400">{clue.type === 'public' ? '公共线索' : '私密线索'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-400">这里本轮没有新的线索了。</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Voting ----------

export function VotingRoom({
  view,
  onVote,
}: {
  view: PlayerRoomView;
  onVote: (characterId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(view.room.youVotedFor ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!selected || busy) {
      return;
    }
    setBusy(true);
    try {
      await onVote(selected);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Final Vote · 指认凶手</p>
      <h2 className="mt-1 text-lg font-semibold text-amber-100">你认为谁是凶手？</h2>
      {/* C9: show human vote progress (never who-voted-for-whom) + all-voted / revote hints. */}
      <p className="mt-1 text-sm text-slate-300">
        已投票 {view.room.humansVotedCount}/{view.room.connectedHumanCount}
        {view.room.allHumansVoted ? ' · 所有人已投票' : ''}（投票前可随时更改）。
      </p>
      {view.room.voteRevoteCount > 0 && (
        <p className="mt-1 text-sm text-amber-200">上一轮平票，正在重新投票。</p>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {view.scenario.characters.map(character => (
          <button
            key={character.id}
            type="button"
            onClick={() => setSelected(character.id)}
            className={[
              'rounded-xl border p-3 text-left transition',
              character.id === selected
                ? 'border-amber-500/70 bg-amber-900/20'
                : 'border-slate-700 bg-slate-900/60 hover:border-slate-500',
            ].join(' ')}
          >
            <p className="font-medium text-slate-100">{character.name}</p>
            <p className="mt-1 text-xs text-slate-400">{character.occupation}</p>
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={submit} disabled={!selected || busy} className="bg-amber-700 text-amber-50 hover:bg-amber-600">
          {busy ? '提交中...' : view.room.youVotedFor ? '更改投票' : '确认指认'}
        </Button>
        {view.room.youVotedFor && (
          <span className="text-sm text-slate-300">
            你已投：{view.scenario.characters.find(c => c.id === view.room.youVotedFor)?.name}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- Reveal ----------

// D5(b): the reveal unfolds in ordered, client-only stages (pure front-end pacing — no server events).
// A "继续" button walks through them; each higher stage keeps everything below it visible.
const REVEAL_STAGE = {
  banner: 0,
  killer: 1,
  truth: 2,
  tally: 3,
  ballots: 4,
  recap: 5,
} as const;
const REVEAL_STAGE_MAX = REVEAL_STAGE.recap;

export function RevealRoom({ view }: { view: PlayerRoomView }) {
  const reveal = view.reveal;
  // D5(b): staged reveal gate (client-only). Hook order must stay stable, so declare before any early
  // return — the `reveal` guard below still short-circuits rendering when there is nothing to show.
  const [stage, setStage] = useState<number>(REVEAL_STAGE.banner);
  if (!reveal) {
    return null;
  }
  const names = nameMapOf(view);
  const killerName = names.get(reveal.killerCharacterId) ?? reveal.killerCharacterId;
  const won = reveal.outcome === 'win';

  // Faction-aware banner. The killer wins by ESCAPING, so never frame their result as "指认错误".
  const bannerTitle = reveal.youWereKiller
    ? (won ? '你成功隐藏了身份，全身而退！' : '你的伪装被识破，未能全身而退。')
    : (won ? '你们锁定了真凶，本局获胜！' : '真凶逃过了指认，本局落败。');

  // A personal-accusation footnote only makes sense for non-killers who actually voted.
  const youVotedCorrect = !reveal.youWereKiller && view.room.youVotedFor
    ? view.room.youVotedFor === reveal.killerCharacterId
    : undefined;

  // Human/AI annotation for a voter — resolved from the public `cast` map, never a playerId.
  const castLabel = (characterId: string): string => {
    const castEntry = reveal.cast.find(c => c.characterId === characterId);
    return castEntry?.playerName ? `玩家：${castEntry.playerName}` : 'AI';
  };

  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-6 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-300/90">Final Reveal · 真相揭晓</p>

      <div
        className={[
          'mt-3 rounded-xl border px-4 py-3',
          won ? 'border-emerald-500/40 bg-emerald-900/20 text-emerald-100' : 'border-rose-500/40 bg-rose-900/20 text-rose-100',
        ].join(' ')}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-90">{won ? '胜利' : '失败'}</p>
        <p className="mt-1 text-base font-semibold">{bannerTitle}</p>
        {reveal.youWereKiller && (
          <p className="mt-1 text-xs opacity-80">你就是本案的真凶。</p>
        )}
        {typeof youVotedCorrect === 'boolean' && (
          <p className="mt-1 text-xs opacity-80">{youVotedCorrect ? '你的指认正确。' : '你的个人指认与真凶不符。'}</p>
        )}
      </div>

      {stage >= REVEAL_STAGE.killer && (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-900/20 px-4 py-3">
          <p className="text-sm text-amber-100/90">真凶</p>
          <p className="mt-1 text-2xl font-bold text-amber-100">{killerName}</p>
          <p className="mt-1 text-xs text-amber-100/80">
            全体指认：{reveal.accusedCharacterId ? names.get(reveal.accusedCharacterId) : '未达成多数'}
            {reveal.accusedCharacterId && (reveal.groupCorrect ? '（正确）' : '（错误）')}
          </p>
        </div>
      )}

      {stage >= REVEAL_STAGE.truth && (
        <>
          <Section title="案件真相">{reveal.truth}</Section>
          <Section title="作案手法">{reveal.murderMethod}</Section>
          <Section title="作案动机">{reveal.motive}</Section>
        </>
      )}

      {stage >= REVEAL_STAGE.tally && (
        <Section title="角色归属与得票">
          <ul className="space-y-1">
            {reveal.tally.map(entry => {
              const castEntry = reveal.cast.find(c => c.characterId === entry.characterId);
              return (
                <li key={entry.characterId} className="flex justify-between">
                  <span>
                    {names.get(entry.characterId)}
                    <span className="ml-1 text-xs text-slate-400">
                      （{castEntry?.playerName ? `玩家：${castEntry.playerName}` : 'AI'}）
                    </span>
                    {entry.characterId === reveal.killerCharacterId && <span className="ml-1 text-rose-300">· 凶手</span>}
                  </span>
                  <span className="text-slate-400">{entry.votes} 票</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {stage >= REVEAL_STAGE.ballots && (
        <Section title="逐票明细">
          {reveal.ballots.length === 0 ? (
            <p className="text-sm text-slate-400">本局没有有效投票。</p>
          ) : (
            <ul className="space-y-1">
              {reveal.ballots.map((ballot, index) => (
                <li key={`${ballot.voterCharacterId}:${index}`} className="flex flex-wrap items-center gap-x-1.5">
                  <span className="text-slate-100">{names.get(ballot.voterCharacterId) ?? ballot.voterCharacterId}</span>
                  <span className="text-xs text-slate-400">（{castLabel(ballot.voterCharacterId)}）</span>
                  <span className="text-slate-500">→</span>
                  <span className="text-slate-100">{names.get(ballot.accusedCharacterId) ?? ballot.accusedCharacterId}</span>
                  {ballot.accusedCharacterId === reveal.killerCharacterId && <span className="text-xs text-rose-300">· 凶手</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* Per-character script recap — reveal.characters carries full private data and is ONLY present at
          REVEAL (projection attaches it only then). Rendering it here is safe; do NOT reuse elsewhere. */}
      {stage >= REVEAL_STAGE.recap && (
        <div className="mt-6">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">角色剧本复盘</p>
          <div className="mt-2 space-y-4">
            {reveal.characters.map(character => (
              <div key={character.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-amber-100">{character.name}</p>
                  <span className="text-xs text-slate-400">{character.age}岁 · {character.occupation}</span>
                  {character.isKiller && (
                    <span className="rounded-full border border-rose-500/50 bg-rose-900/20 px-2 py-0.5 text-xs text-rose-200">
                      真凶
                    </span>
                  )}
                </div>

                <Section title="私密剧本">{character.privateScript}</Section>

                <Section title="不在场证明">
                  <p>对外宣称：{character.alibi.claimed}</p>
                  <p className="mt-1 text-amber-200/90">真实行踪：{character.alibi.truth}</p>
                </Section>

                {character.objectives.length > 0 && (
                  <Section title="任务目标">
                    <ul className="list-disc space-y-1 pl-5">
                      {character.objectives.map((objective, index) => (
                        <li key={index}>{objective.description}</li>
                      ))}
                    </ul>
                  </Section>
                )}

                {character.secrets.length > 0 && (
                  <Section title="隐藏的秘密">
                    <ul className="list-disc space-y-1 pl-5">
                      {character.secrets.map((secret, index) => (
                        <li key={index}>{secret}</li>
                      ))}
                    </ul>
                  </Section>
                )}

                {character.relationships.length > 0 && (
                  <Section title="人物关系">
                    <ul className="space-y-1">
                      {character.relationships.map((relationship, index) => (
                        <li key={index}>
                          <span className="text-slate-100">
                            {names.get(relationship.characterId) ?? relationship.characterId}
                          </span>
                          <span className="ml-1">：{relationship.publicRelation}</span>
                          {relationship.privateRelation && (
                            <span className="ml-1 text-amber-200/90">（实际：{relationship.privateRelation}）</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {stage < REVEAL_STAGE_MAX && (
        <div className="mt-6">
          <Button
            type="button"
            onClick={() => setStage(current => Math.min(current + 1, REVEAL_STAGE_MAX))}
            className="bg-amber-700 text-amber-50 hover:bg-amber-600"
          >
            继续
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------- Notebook ----------

export function Notebook({
  view,
  onPresent,
}: {
  view: PlayerRoomView;
  onPresent?: (clueId: string) => void;
}) {
  const clues: ClueView[] = useMemo(() => {
    const byId = new Map<string, ClueView>();
    for (const clue of view.room.publicClues) {
      byId.set(clue.id, clue);
    }
    for (const clue of view.room.yourClues) {
      byId.set(clue.id, clue);
    }
    return [...byId.values()];
  }, [view.room.publicClues, view.room.yourClues]);

  // A clue already in the shared pool is public to everyone; presenting it again is a no-op.
  const publicIds = useMemo(
    () => new Set(view.room.publicClues.map(clue => clue.id)),
    [view.room.publicClues],
  );
  // Presenting a clue is a discussion act — only offer it while chat is allowed.
  const canPresent = getPhaseConfig(view.room.currentPhase).allowsChat;

  return (
    <aside className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Notebook · 线索笔记</p>
      {clues.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-3 text-sm text-slate-400">
          暂无线索。搜证阶段去各地点搜查。
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {clues.map(clue => {
            const isPublic = publicIds.has(clue.id);
            return (
              <div key={clue.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-sm">
                <p className="text-slate-100">{clue.content}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">
                    {clue.type === 'public' ? '公共线索' : '私密线索'}
                    {clue.foundAt ? ` · ${clue.foundAt}` : ''}
                  </p>
                  {isPublic ? (
                    <span className="shrink-0 text-xs text-emerald-300/80">已公开</span>
                  ) : (
                    onPresent && canPresent && (
                      <button
                        type="button"
                        onClick={() => onPresent(clue.id)}
                        className="shrink-0 rounded-md border border-amber-500/50 px-2 py-0.5 text-xs text-amber-200 hover:bg-amber-900/30"
                      >
                        出示
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

export function phaseLabel(view: PlayerRoomView): string {
  return PHASE_LABELS[view.room.currentPhase];
}
