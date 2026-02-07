'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import scenario from '@/data/scenarios/storm-mansion.json';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { CreateGameResponse } from '@/types/game';

export default function HomePage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startGame = async () => {
    setCreating(true);
    setError(null);

    try {
      const response = await fetch('/api/game/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scenarioId: scenario.id }),
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      const data = (await response.json()) as CreateGameResponse;
      router.push(`/game/${data.sessionId}`);
    } catch (createError) {
      console.error(createError);
      setError('创建房间失败，请稍后重试。');
      setCreating(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_12%_14%,rgba(180,83,9,0.24),transparent_42%),radial-gradient(circle_at_84%_78%,rgba(30,41,59,0.4),transparent_48%),linear-gradient(135deg,#020617,#111827_42%,#0f172a)] px-5 py-12 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent_95%,rgba(148,163,184,0.08)_100%)] bg-[length:100%_22px]" />
      <Card className="relative z-10 w-full max-w-2xl border-slate-700/80 bg-slate-950/75 text-slate-100 backdrop-blur">
        <CardHeader className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">AI Murder Mystery</p>
          <CardTitle className="text-3xl text-amber-100">{scenario.title}</CardTitle>
          <CardDescription className="text-base leading-relaxed text-slate-300">
            {scenario.description}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-2 text-sm text-slate-300">
          <p>背景：{scenario.setting.location} / {scenario.setting.era}</p>
          <p>难度：{scenario.difficulty}</p>
          <p>预计时长：{scenario.estimatedDuration} 分钟</p>
        </CardContent>

        <CardFooter className="flex flex-col items-start gap-3">
          <Button
            onClick={startGame}
            disabled={creating}
            className="h-11 bg-amber-700 px-6 text-base text-amber-50 hover:bg-amber-600"
          >
            {creating ? '准备中...' : 'Start Game'}
          </Button>
          {error && <p className="text-sm text-red-300">{error}</p>}
        </CardFooter>
      </Card>
    </main>
  );
}
