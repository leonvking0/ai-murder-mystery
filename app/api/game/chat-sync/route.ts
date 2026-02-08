import { randomUUID } from 'node:crypto';

import { streamNPCResponse } from '@/lib/agents/npc-agent';
import { appendConversation, summarizeConversations } from '@/lib/game-engine/memory-manager';
import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { getScenarioById, getSession, updateSession } from '@/lib/store/game-sessions';
import type { ChatMessage, ChatRequest, GamePhase } from '@/types/game';

export async function POST(req: Request): Promise<Response> {
  try {
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

    if (!getPhaseConfig(session.currentPhase).allowsChat) {
      return Response.json(
        { error: `Chat is disabled during phase ${session.currentPhase}` },
        { status: 403 },
      );
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

    let npcReply = '';

    const responseStream = streamNPCResponse({
      character,
      allCharacters: scenario.characters,
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

    return Response.json({ success: true, message: npcReply });
  } catch (error) {
    console.error('Chat sync route failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
