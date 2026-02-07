'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { Character } from '@/types/game';

interface CharacterCardProps {
  character: Character;
  selected: boolean;
  onClick: () => void;
}

function initials(name: string): string {
  return name.slice(0, 1);
}

export function CharacterCard({ character, selected, onClick }: CharacterCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full rounded-xl border px-3 py-3 text-left transition',
        selected
          ? 'border-amber-400/70 bg-amber-500/10 shadow-[0_10px_30px_rgba(245,158,11,0.15)]'
          : 'border-slate-700/80 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-800/60',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <Avatar className="border border-slate-600/80 bg-slate-800" size="default">
          <AvatarFallback className="bg-transparent text-slate-100">
            {initials(character.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-slate-100">{character.name}</p>
            <p className="text-xs text-slate-400">{character.age}岁</p>
          </div>
          <p className="mt-1 text-xs text-amber-100/90">{character.occupation}</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            <span className="text-slate-400">性格：</span>
            {character.personality}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-700/80 bg-slate-950/55 p-2.5">
        <p className="text-[11px] font-medium tracking-[0.18em] text-slate-400">公开信息</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-200">{character.publicInfo}</p>
      </div>
    </button>
  );
}
