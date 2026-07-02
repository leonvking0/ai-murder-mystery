import { randomUUID } from 'node:crypto';

import { streamNPCResponse } from '@/lib/agents/npc-agent';
import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { getAuthedPlayerId } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import type { ChatMessage } from '@/types/game';

export const maxDuration = 120;

interface PrivateChatBody {
  targetCharacterId?: string;
  message?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
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

    const playerId = getAuthedPlayerId(req, id);
    if (!playerId) {
      return Response.json({ error: 'Not authenticated for this room' }, { status: 403 });
    }
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

    if (!getPhaseConfig(room.currentPhase).allowsChat) {
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
    // C10 (KI-021): cap what we hand the model so the prompt can't grow unbounded. The FULL thread is
    // still persisted below (and is what the requesting player sees) — only the model input is trimmed.
    const PRIVATE_HISTORY_LIMIT = 16;
    const history = (room.privateChats[threadKey] ?? []).slice(-PRIVATE_HISTORY_LIMIT);

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

    // C7 (KI-039) — the private turn is persisted ONLY to this player's isolated thread. It must NOT
    // enter the SHARED `characterMemories[targetCharacterId]`: that shared memory is rendered into
    // EVERY player's prompt/group context for this NPC, so writing a private line there would leak
    // player A's private conversation into player B's view of the NPC. The isolated thread below is
    // this player's private history with the NPC, and it is what feeds their own `conversationHistory`.
    updateRoom(id, current => {
      const currentThread = current.privateChats[threadKey] ?? [];
      return {
        ...current,
        privateChats: { ...current.privateChats, [threadKey]: [...currentThread, playerMessage, npcMessage] },
      };
    });

    return Response.json({ ok: true, message: npcMessage });
  } catch (error) {
    console.error('Room private chat failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
