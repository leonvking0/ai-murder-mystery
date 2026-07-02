'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { nameMapOf } from '@/components/room/RoomPanels';
import type { ClueView, PlayerRoomView } from '@/types/game';

// Per-room open-state persistence. Mirrors lib/room/identity.ts (UX bookkeeping only; guarded for SSR).
function caseFileKey(roomId: string): string {
  return `mm_casefile_open_${roomId}`;
}

function getCaseFileOpen(roomId: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(caseFileKey(roomId)) === '1';
}

function setCaseFileOpen(roomId: string, open: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(caseFileKey(roomId), open ? '1' : '0');
}

// Local accordion section — intentionally NOT RoomPanels' unexported Section (this owns collapse state).
function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-700/60">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-900/40"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-amber-100">{title}</span>
        <span className="text-lg leading-none text-slate-400">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// Local labelled field helper.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <div className="mt-1 text-sm leading-relaxed text-slate-200">{children}</div>
    </div>
  );
}

/**
 * D1 always-on 案情档案 + 我的剧本 drawer. A right-side slide-over that renders ONLY the per-player
 * projection. Private data comes SOLELY from `view.yourCharacter` (the requester's own Character);
 * the public cast comes from `view.scenario.characters` (sanitized CharacterPublic). Never reads
 * `view.reveal`, never renders a raw playerId.
 */
export function CaseFileDrawer({ view }: { view: PlayerRoomView }) {
  const roomId = view.room.id;
  const [open, setOpen] = useState(false);

  // Restore persisted open state after mount (default-collapsed; avoids SSR/hydration mismatch).
  useEffect(() => {
    setOpen(getCaseFileOpen(roomId));
  }, [roomId]);

  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      setCaseFileOpen(roomId, next);
      return next;
    });
  };

  const names = useMemo(() => nameMapOf(view), [view]);
  const scenario = view.scenario;
  const character = view.yourCharacter;

  // 我的线索: merge public + your clues by id (dedup). Both are already-sanitized ClueViews.
  const clues = useMemo<ClueView[]>(() => {
    const byId = new Map<string, ClueView>();
    for (const clue of view.room.publicClues) {
      byId.set(clue.id, clue);
    }
    for (const clue of view.room.yourClues) {
      byId.set(clue.id, clue);
    }
    return [...byId.values()];
  }, [view.room.publicClues, view.room.yourClues]);

  const nameOf = (id: string): string => names.get(id) ?? id;

  return (
    <>
      {/* Fixed toggle — always available while the drawer is mounted. */}
      <Button
        type="button"
        onClick={toggle}
        className="fixed bottom-5 right-5 z-40 bg-amber-700 text-amber-50 shadow-lg shadow-black/40 hover:bg-amber-600"
      >
        {open ? '关闭档案' : '案情档案'}
      </Button>

      {open && (
        <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-700/70 bg-slate-950/95 shadow-2xl shadow-black/60 backdrop-blur">
          <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-amber-300/90">Case File · 案情档案</p>
              <p className="mt-0.5 text-sm font-semibold text-amber-100">{scenario.title}</p>
            </div>
            <button
              type="button"
              onClick={toggle}
              aria-label="关闭"
              className="rounded-md border border-slate-600 px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
            >
              ✕
            </button>
          </div>

          <ScrollArea className="h-0 flex-1">
            <div className="pb-6">
              {/* 1. 案情概要 */}
              <Section title="案情概要" defaultOpen>
                <Field label="剧本简介">{scenario.description}</Field>
                <Field label="时代">{scenario.setting.era}</Field>
                <Field label="地点">{scenario.setting.location}</Field>
                <Field label="氛围">{scenario.setting.atmosphere}</Field>
                <Field label="背景故事">
                  <p className="whitespace-pre-wrap">{scenario.setting.backgroundStory}</p>
                </Field>
                <Field label="死者">{scenario.case.victim}</Field>
                <Field label="死因">{scenario.case.causeOfDeath}</Field>
                <Field label="死亡时间">{scenario.case.timeOfDeath}</Field>
                <Field label="案发现场">{scenario.case.crimeScene}</Field>
              </Section>

              {/* 2. 公开时间线 */}
              <Section title="公开时间线">
                {scenario.timeline.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-400">暂无公开时间线。</p>
                ) : (
                  <ul className="mt-1 space-y-3">
                    {scenario.timeline.map((entry, index) => (
                      <li key={`${entry.time}:${index}`} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                        <p className="text-sm font-medium text-amber-100">{entry.time}</p>
                        <p className="mt-1 text-sm text-slate-200">{entry.event}</p>
                        {entry.involvedCharacters.length > 0 && (
                          <p className="mt-1 text-xs text-slate-400">
                            涉及：{entry.involvedCharacters.map(nameOf).join('、')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* 3. 登场人物 (public only) */}
              <Section title="登场人物">
                <ul className="mt-1 space-y-3">
                  {scenario.characters.map(publicCharacter => (
                    <li key={publicCharacter.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <p className="text-sm font-semibold text-slate-100">
                        {publicCharacter.name}
                        <span className="ml-1 text-xs font-normal text-slate-400">
                          {publicCharacter.age}岁 · {publicCharacter.occupation}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-slate-300">{publicCharacter.publicInfo}</p>
                      {publicCharacter.publicRelations.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
                          {publicCharacter.publicRelations.map((relation, index) => (
                            <li key={`${relation.characterId}:${index}`}>
                              {nameOf(relation.characterId)}：{relation.publicRelation}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>

              {/* 4. 我的剧本 — the ONLY private section; sourced solely from view.yourCharacter. */}
              <Section title="我的剧本" defaultOpen>
                {character ? (
                  <>
                    <Field label="身份">
                      {character.name}（{character.age}岁 · {character.occupation}）
                    </Field>
                    <Field label="性格">{character.personality}</Field>
                    <Field label="说话风格">{character.speakingStyle}</Field>
                    <Field label="公开信息（所有人都知道）">{character.publicInfo}</Field>
                    <Field label="私密剧本（绝密）">
                      <p className="whitespace-pre-wrap">{character.privateScript}</p>
                    </Field>
                    <Field label="不在场证明">
                      <p>对外宣称：{character.alibi.claimed}</p>
                      <p className="mt-1 text-amber-200/90">真实行踪：{character.alibi.truth}</p>
                    </Field>
                    {character.objectives.length > 0 && (
                      <Field label="你的任务">
                        <ul className="list-disc space-y-1 pl-5">
                          {character.objectives.map((objective, index) => (
                            <li key={index}>{objective.description}</li>
                          ))}
                        </ul>
                      </Field>
                    )}
                    {character.secrets.length > 0 && (
                      <Field label="你想隐瞒的秘密">
                        <ul className="list-disc space-y-1 pl-5">
                          {character.secrets.map((secret, index) => (
                            <li key={index}>{secret}</li>
                          ))}
                        </ul>
                      </Field>
                    )}
                    {character.relationships.length > 0 && (
                      <Field label="人物关系">
                        <ul className="space-y-1">
                          {character.relationships.map((relationship, index) => (
                            <li key={`${relationship.characterId}:${index}`}>
                              <span className="text-slate-100">{nameOf(relationship.characterId)}</span>
                              <span className="ml-1">：{relationship.publicRelation}</span>
                              {relationship.privateRelation && (
                                <span className="ml-1 text-amber-200/90">（实际：{relationship.privateRelation}）</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </Field>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-slate-400">尚未分配角色。</p>
                )}
              </Section>

              {/* 5. 我的线索 */}
              <Section title="我的线索">
                {clues.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-400">暂无线索。搜证阶段去各地点搜查。</p>
                ) : (
                  <ul className="mt-1 space-y-2">
                    {clues.map(clue => (
                      <li key={clue.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
                        <p className="text-slate-100">{clue.content}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {clue.type === 'public' ? '公共线索' : '私密线索'}
                          {clue.foundAt ? ` · ${clue.foundAt}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </ScrollArea>
        </aside>
      )}
    </>
  );
}
