import { randomUUID } from 'node:crypto';

import { streamNPCResponse } from '@/lib/agents/npc-agent';
import { appendConversation } from '@/lib/game-engine/memory-manager';
import { getScenarioById } from '@/lib/scenarios/registry';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import type { ChatMessage, GamePhase } from '@/types/game';

export const maxDuration = 120;

interface PrivateChatBody {
  playerId?: string;
  targetCharacterId?: string;
  message?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isDiscussionPhase(phase: GamePhase): boolean {
  return phase === 'DISCUSSION_1' || phase === 'DISCUSSION_2' || phase === 'FINAL_DISCUSSION';
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: PrivateChatBody;
    try {
      body = (await req.json()) as PrivateChatBody;
    } catch {
      body = {};
    }

    const playerId = body.playerId?.trim() ?? '';
    const targetCharacterId = body.targetCharacterId?.trim() ?? '';
    const message = (body.message ?? '').trim().slice(0, 2000);

    const room = getRoom(id);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getScenarioById(room.scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    const player = room.players.find(item => item.id === playerId);
    if (!player) {
      return Response.json({ error: 'Not a member of this room' }, { status: 403 });
    }

    if (!isDiscussionPhase(room.currentPhase)) {
      return Response.json({ error: `当前阶段不能私聊：${room.currentPhase}` }, { status: 403 });
    }

    if (!message) {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    const character = scenario.characters.find(item => item.id === targetCharacterId);
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const control = room.characterControl[targetCharacterId];
    if (control?.kind !== 'npc') {
      return Response.json(
        { error: '对方由真人扮演，请在群聊中交流（私聊真人暂未开放）' },
        { status: 400 },
      );
    }

    const memory = room.characterMemories[targetCharacterId];
    if (!memory) {
      return Response.json({ error: 'Character memory not found' }, { status: 404 });
    }

    const threadKey = `${playerId}:${targetCharacterId}`;
    const history = room.privateChats[threadKey] ?? [];

    const knownClues = [
      ...memory.discoveredClues.map(clue => clue.content),
      ...memory.knownFacts,
    ];

    let reply = '';
    const stream = streamNPCResponse({
      character,
      allCharacters: scenario.characters,
      memory,
      conversationHistory: history,
      gameState: { phase: room.currentPhase, knownClues, emotionalState: memory.emotionalState },
      playerMessage: message,
    });
    for await (const chunk of stream) {
      reply += chunk;
    }
    reply = reply.trim();

    const now = Date.now();
    const playerMessage: ChatMessage = {
      id: randomUUID(), role: 'player', characterId: targetCharacterId, playerId, content: message, timestamp: now,
    };
    const npcMessage: ChatMessage = {
      id: randomUUID(), role: 'npc', characterId: targetCharacterId, content: reply, timestamp: now + 1,
    };

    updateRoom(id, current => {
      const currentMemory = current.characterMemories[targetCharacterId];
      let nextMemory = currentMemory;
      if (currentMemory) {
        nextMemory = appendConversation(currentMemory, { role: 'player', content: message, characterId: targetCharacterId });
        nextMemory = appendConversation(nextMemory, { role: 'npc', content: reply, characterId: targetCharacterId });
      }
      const currentThread = current.privateChats[threadKey] ?? [];
      return {
        ...current,
        privateChats: { ...current.privateChats, [threadKey]: [...currentThread, playerMessage, npcMessage] },
        characterMemories: nextMemory
          ? { ...current.characterMemories, [targetCharacterId]: nextMemory }
          : current.characterMemories,
      };
    });

    return Response.json({ ok: true, message: npcMessage });
  } catch (error) {
    console.error('Room private chat failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
