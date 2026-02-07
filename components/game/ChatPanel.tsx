'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { MessageBubble } from '@/components/game/MessageBubble';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useGameStore } from '@/lib/store/game-store';
import type { Character, ChatMessage } from '@/types/game';

interface ChatPanelProps {
  sessionId: string;
  character: Character;
}

function buildMessage(role: ChatMessage['role'], characterId: string, content: string): ChatMessage {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    role,
    characterId,
    content,
    timestamp: Date.now(),
  };
}

function parseSSEEvent(raw: string): unknown {
  const dataLines = raw
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim());

  if (dataLines.length === 0) {
    return null;
  }

  return JSON.parse(dataLines.join('\n'));
}

export function ChatPanel({ sessionId, character }: ChatPanelProps) {
  const messages = useGameStore(state => state.messages[character.id] ?? []);
  const addMessage = useGameStore(state => state.addMessage);

  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const renderedMessages = useMemo(() => messages, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [renderedMessages, streamingText]);

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = input.trim();
    if (!content || typing) {
      return;
    }

    addMessage(character.id, buildMessage('player', character.id, content));
    setInput('');
    setTyping(true);
    setStreamingText('');

    let npcText = '';

    try {
      const response = await fetch('/api/game/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          targetCharacterId: character.id,
          message: content,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to open chat stream');
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (buffer.includes('\n\n')) {
          const eventBoundary = buffer.indexOf('\n\n');
          const rawEvent = buffer.slice(0, eventBoundary);
          buffer = buffer.slice(eventBoundary + 2);

          if (!rawEvent.trim()) {
            continue;
          }

          const payload = parseSSEEvent(rawEvent) as
            | { type: 'start' | 'done' }
            | { type: 'chunk'; text: string }
            | { type: 'error'; message?: string }
            | null;

          if (!payload) {
            continue;
          }

          if (payload.type === 'chunk') {
            npcText += payload.text;
            setStreamingText(npcText);
          }

          if (payload.type === 'error') {
            throw new Error(payload.message || 'Chat stream error');
          }
        }
      }
    } catch (error) {
      console.error(error);
      npcText = npcText || '我现在不太方便回答，稍后再聊。';
      setStreamingText(npcText);
    } finally {
      if (npcText.trim()) {
        addMessage(character.id, buildMessage('npc', character.id, npcText));
      }

      setTyping(false);
      setStreamingText('');
    }
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-700/70 bg-slate-950/70 backdrop-blur">
      <div className="border-b border-slate-700/60 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Private Chat</p>
        <h2 className="mt-1 text-lg font-semibold text-amber-100">{character.name}</h2>
      </div>

      <ScrollArea className="h-0 flex-1 px-4 py-4">
        <div className="space-y-3 pr-2">
          {renderedMessages.map(message => (
            <MessageBubble
              key={message.id}
              message={message}
              characterName={character.name}
            />
          ))}

          {typing && streamingText && (
            <MessageBubble
              message={buildMessage('npc', character.id, streamingText)}
              characterName={character.name}
            />
          )}

          {typing && !streamingText && (
            <div className="text-sm text-slate-400">{character.name} 正在思考...</div>
          )}

          <div ref={endRef} />
        </div>
      </ScrollArea>

      <form onSubmit={submitMessage} className="border-t border-slate-700/60 p-4">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="问点什么，比如：昨晚你在哪里？"
            className="border-slate-600 bg-slate-900/80 text-slate-100 placeholder:text-slate-500"
          />
          <Button
            type="submit"
            disabled={typing || !input.trim()}
            className="bg-amber-700 text-amber-50 hover:bg-amber-600"
          >
            发送
          </Button>
        </div>
      </form>
    </div>
  );
}
