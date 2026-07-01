'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setPlayerId } from '@/lib/room/identity';

export default function HomePage() {
  const router = useRouter();
  const [hostName, setHostName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRoom = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenarioId: 'storm-mansion', hostName }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? '创建房间失败');
      }
      setPlayerId(data.roomId, data.playerId);
      router.push(`/room/${data.code}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建房间失败');
      setCreating(false);
    }
  };

  const joinRoom = () => {
    const code = joinCode.trim().toUpperCase();
    if (code) {
      router.push(`/room/${code}`);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_12%_14%,rgba(180,83,9,0.24),transparent_42%),radial-gradient(circle_at_84%_78%,rgba(30,41,59,0.4),transparent_48%),linear-gradient(135deg,#020617,#111827_42%,#0f172a)] px-5 py-12 text-slate-100">
      <div className="relative z-10 w-full max-w-xl rounded-2xl border border-slate-700/80 bg-slate-950/75 p-8 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">AI 剧本杀 · 多人</p>
        <h1 className="mt-2 text-3xl font-semibold text-amber-100">暴风雪山庄</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          暴风雪封山，五位宾客困于深山别墅，庄主死于反锁书房。和朋友开一间房，各自扮演一名嫌疑人，
          其余角色由 AI 出演——讨论、搜证、私聊、指认真凶。
        </p>

        <div className="mt-8 space-y-6">
          <section>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">创建房间</p>
            <div className="mt-2 flex gap-2">
              <Input
                value={hostName}
                onChange={e => setHostName(e.target.value)}
                placeholder="你的昵称"
                className="border-slate-600 bg-slate-900/80 text-slate-100 placeholder:text-slate-500"
              />
              <Button
                onClick={createRoom}
                disabled={creating}
                className="shrink-0 bg-amber-700 text-amber-50 hover:bg-amber-600"
              >
                {creating ? '创建中...' : '创建房间'}
              </Button>
            </div>
          </section>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1 bg-slate-700" /> 或 <span className="h-px flex-1 bg-slate-700" />
          </div>

          <section>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">加入房间</p>
            <div className="mt-2 flex gap-2">
              <Input
                value={joinCode}
                onChange={e => setJoinCode(e.target.value)}
                placeholder="输入房间码（如 ABCDE）"
                className="border-slate-600 bg-slate-900/80 font-mono uppercase tracking-[0.2em] text-slate-100 placeholder:text-slate-500 placeholder:tracking-normal"
              />
              <Button
                onClick={joinRoom}
                variant="outline"
                className="shrink-0 border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800"
              >
                加入
              </Button>
            </div>
          </section>
        </div>

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

        <p className="mt-8 text-xs text-slate-500">
          单人也可以玩：直接创建房间并开始，其余角色全部由 AI 扮演。
        </p>
      </div>
    </main>
  );
}
