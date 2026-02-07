'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useGameStore } from '@/lib/store/game-store';
import type { Character, ChatMessage } from '@/types/game';

interface GroupChatProps {
  sessionId: string;
  characters: Character[];
}

function buildPlayerMessage(content: string): ChatMessage {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    role: 'player',
    content,
    timestamp: Date.now(),
  };
}

function buildNPCMessage(characterId: string, content: string): ChatMessage {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    role: 'npc',
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

export function GroupChat({ sessionId, characters }: GroupChatProps) {
  const messages = useGameStore(state => state.groupMessages);
  const addGroupMessage = useGameStore(state => state.addGroupMessage);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingCharacterId, setStreamingCharacterId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const characterMap = useMemo(
    () => Object.fromEntries(characters.map(character => [character.id, character])),
    [characters],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingText, streamingCharacterId]);

  const sendMessage = async (message: string) => {
    if (streaming) {
      return;
    }

    const trimmed = message.trim();
    const isContinue = trimmed.length === 0;

    if (!isContinue) {
      addGroupMessage(buildPlayerMessage(trimmed));
      setInput('');
    }

    setStreaming(true);
    setStreamingCharacterId(null);
    setStreamingText('');

    try {
      const response = await fetch(`/api/game/${sessionId}/group-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmed,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to open group chat stream');
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
            | { type: 'npc_start'; characterId: string; text?: string }
            | { type: 'npc_chunk'; characterId: string; text: string }
            | { type: 'npc_done'; characterId: string; text: string }
            | null;

          if (!payload) {
            continue;
          }

          if (payload.type === 'npc_start') {
            setStreamingCharacterId(payload.characterId);
            setStreamingText('');
          }

          if (payload.type === 'npc_chunk') {
            setStreamingCharacterId(payload.characterId);
            setStreamingText(previous => previous + payload.text);
          }

          if (payload.type === 'npc_done') {
            if (payload.text.trim()) {
              addGroupMessage(buildNPCMessage(payload.characterId, payload.text));
            }

            setStreamingCharacterId(null);
            setStreamingText('');
          }
        }
      }
    } catch (error) {
      console.error(error);
      if (streamingCharacterId && streamingText.trim()) {
        addGroupMessage(buildNPCMessage(streamingCharacterId, streamingText));
      }
    } finally {
      setStreaming(false);
      setStreamingCharacterId(null);
      setStreamingText('');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = input.trim();
    if (!content || streaming) {
      return;
    }

    await sendMessage(content);
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-600/80 bg-gradient-to-b from-slate-900/85 to-slate-950/90 backdrop-blur">
      <div className="border-b border-slate-700/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Group Chat</p>
        <h2 className="mt-1 text-lg font-semibold text-amber-100">公共讨论区</h2>
      </div>

      <ScrollArea className="h-0 flex-1 px-4 py-4">
        <div className="space-y-3 pr-2">
          {messages.map(message => {
            const isPlayer = message.role === 'player';
            const isSystem = message.role === 'system' || message.role === 'gm';
            const character = message.characterId ? characterMap[message.characterId] : undefined;
            const name = character?.name ?? '未知角色';

            if (isSystem) {
              return (
                <div key={message.id} className="flex justify-center">
                  <div className="max-w-[92%] rounded-xl border border-amber-500/30 bg-amber-900/15 px-3 py-2 text-sm text-amber-100">
                    {message.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={message.id} className={`flex ${isPlayer ? 'justify-end' : 'justify-start'}`}>
                {isPlayer ? (
                  <div className="max-w-[78%] rounded-2xl bg-amber-700/90 px-4 py-3 text-sm text-amber-50 shadow-[0_8px_30px_rgba(120,53,15,0.35)]">
                    {message.content}
                  </div>
                ) : (
                  <div className="flex max-w-[88%] gap-3">
                    <Avatar className="mt-1 border border-slate-600">
                      <AvatarFallback className="bg-slate-700 text-xs text-slate-100">
                        {name.slice(0, 1)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="rounded-2xl bg-slate-800/90 px-4 py-3 text-sm text-slate-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
                      <p className="mb-1 text-xs font-semibold tracking-wide text-amber-200/90">{name}</p>
                      <p>{message.content}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {streamingCharacterId && streamingText && (
            <div className="flex justify-start">
              <div className="flex max-w-[88%] gap-3">
                <Avatar className="mt-1 border border-slate-600">
                  <AvatarFallback className="bg-slate-700 text-xs text-slate-100">
                    {(characterMap[streamingCharacterId]?.name ?? '角').slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
                <div className="rounded-2xl bg-slate-800/90 px-4 py-3 text-sm text-slate-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
                  <p className="mb-1 text-xs font-semibold tracking-wide text-amber-200/90">
                    {characterMap[streamingCharacterId]?.name ?? streamingCharacterId}
                  </p>
                  <p>{streamingText}</p>
                </div>
              </div>
            </div>
          )}

          {streaming && !streamingText && (
            <p className="text-sm text-slate-400">NPC 正在讨论中...</p>
          )}

          <div ref={endRef} />
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="border-t border-slate-700/70 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-slate-400">你可以随时发言，也可以让 NPC 继续互相讨论。</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => sendMessage('')}
            disabled={streaming}
            className="border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800"
          >
            Continue Discussion
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="在公共讨论中发言..."
            disabled={streaming}
            className="border-slate-600 bg-slate-900/80 text-slate-100 placeholder:text-slate-500"
          />
          <Button
            type="submit"
            disabled={streaming || !input.trim()}
            className="bg-amber-700 text-amber-50 hover:bg-amber-600"
          >
            发送
          </Button>
        </div>
      </form>
    </div>
  );
}
