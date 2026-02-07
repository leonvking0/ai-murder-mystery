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
      <div className="flex items-center gap-3">
        <Avatar className="border border-slate-600/80 bg-slate-800" size="default">
          <AvatarFallback className="bg-transparent text-slate-100">
            {initials(character.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{character.name}</p>
          <p className="truncate text-xs text-slate-400">{character.occupation}</p>
        </div>
      </div>
    </button>
  );
}
