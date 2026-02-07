'use client';

import type { ChatMessage } from '@/types/game';

interface MessageBubbleProps {
  message: ChatMessage;
  characterName: string;
}

export function MessageBubble({ message, characterName }: MessageBubbleProps) {
  const isPlayer = message.role === 'player';

  return (
    <div className={`flex ${isPlayer ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isPlayer
            ? 'bg-amber-700/90 text-amber-50 shadow-[0_8px_30px_rgba(120,53,15,0.35)]'
            : 'bg-slate-800/90 text-slate-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]',
        ].join(' ')}
      >
        {!isPlayer && (
          <p className="mb-1 text-xs font-semibold tracking-wide text-amber-200/90">
            {characterName}
          </p>
        )}
        <p>{message.content}</p>
      </div>
    </div>
  );
}
