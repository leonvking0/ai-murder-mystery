import { randomUUID } from 'node:crypto';

import { streamNPCResponse } from '@/lib/agents/npc-agent';
import { appendConversation, summarizeConversations } from '@/lib/game-engine/memory-manager';
import { getScenarioById, getSession, updateSession } from '@/lib/store/game-sessions';
import type { ChatMessage, ChatRequest, GamePhase } from '@/types/game';

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

function createSSEData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequest;

  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, targetCharacterId, message } = body;

  if (!sessionId || !targetCharacterId || !message?.trim()) {
    return Response.json(
      { error: 'sessionId, targetCharacterId, and message are required' },
      { status: 400 },
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const scenario = getScenarioById(session.scenarioId);
  if (!scenario) {
    return Response.json({ error: 'Scenario not found' }, { status: 404 });
  }

  const character = scenario.characters.find(item => item.id === targetCharacterId);
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const memory = session.characterMemories[targetCharacterId];
  const history = session.chatHistories[targetCharacterId] ?? [];

  if (!memory) {
    return Response.json({ error: 'Character memory not found' }, { status: 404 });
  }

  const knownClues = [
    ...memory.discoveredClues.map(clue => clue.content),
    ...memory.knownFacts,
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(createSSEData(payload)));
      };

      let npcReply = '';

      try {
        send({ type: 'start' });

        const responseStream = streamNPCResponse({
          character,
          memory,
          conversationHistory: history,
          gameState: {
            phase: session.currentPhase as GamePhase,
            knownClues,
            emotionalState: memory.emotionalState,
          },
          playerMessage: message,
        });

        for await (const chunk of responseStream) {
          npcReply += chunk;
          send({ type: 'chunk', text: chunk });
        }

        let nextMemory = appendConversation(memory, {
          role: 'player',
          content: message,
          characterId: targetCharacterId,
        });

        nextMemory = appendConversation(nextMemory, {
          role: 'npc',
          content: npcReply,
          characterId: targetCharacterId,
        });

        if (nextMemory.conversations.length > 10) {
          const summary = await summarizeConversations(nextMemory);
          nextMemory = {
            ...nextMemory,
            knownFacts: [...nextMemory.knownFacts, `近期对话摘要：${summary}`],
            conversations: nextMemory.conversations.slice(-6),
          };
        }

        const playerMessage: ChatMessage = {
          id: randomUUID(),
          role: 'player',
          characterId: targetCharacterId,
          content: message,
          timestamp: Date.now(),
        };

        const npcMessage: ChatMessage = {
          id: randomUUID(),
          role: 'npc',
          characterId: targetCharacterId,
          content: npcReply,
          timestamp: Date.now(),
        };

        updateSession(sessionId, current => ({
          ...current,
          chatHistories: {
            ...current.chatHistories,
            [targetCharacterId]: [
              ...(current.chatHistories[targetCharacterId] ?? []),
              playerMessage,
              npcMessage,
            ],
          },
          characterMemories: {
            ...current.characterMemories,
            [targetCharacterId]: nextMemory,
          },
        }));

        send({ type: 'done' });
      } catch (error) {
        console.error('Chat stream failed:', error);
        send({ type: 'error', message: 'NPC response failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: sseHeaders(),
  });
}
