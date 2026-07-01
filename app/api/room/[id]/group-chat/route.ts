import { randomUUID } from 'node:crypto';

import { manageRoomGroupResponse } from '@/lib/agents/room-group-chat';
import { appendConversation } from '@/lib/game-engine/memory-manager';
import { getScenarioById } from '@/lib/scenarios/registry';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { publish } from '@/lib/realtime/room-bus';
import type { ChatMessage, GamePhase } from '@/types/game';

export const maxDuration = 300;

interface GroupChatBody {
  playerId?: string;
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

    let body: GroupChatBody;
    try {
      body = (await req.json()) as GroupChatBody;
    } catch {
      body = {};
    }

    const playerId = body.playerId?.trim() ?? '';
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
      return Response.json({ error: `当前阶段不能群聊：${room.currentPhase}` }, { status: 403 });
    }

    // 1. Post the human's message (as their assigned character) and broadcast it.
    if (message) {
      const playerMessage: ChatMessage = {
        id: randomUUID(),
        role: 'player',
        characterId: player.assignedCharacterId,
        playerId: player.id,
        content: message,
        timestamp: Date.now(),
      };
      updateRoom(id, current => ({
        ...current,
        groupChatHistory: [...current.groupChatHistory, playerMessage],
      }));
      publish(id, { type: 'group_message', message: playerMessage });
    }

    // 2. Stream NPC responses, broadcasting to everyone; persist each as it finishes.
    const fresh = getRoom(id);
    if (fresh) {
      const accumulated = new Map<string, string>();
      let active: string | null = null;

      for await (const item of manageRoomGroupResponse(fresh, scenario, message)) {
        if (item.characterId !== active) {
          active = item.characterId;
          accumulated.set(item.characterId, '');
          publish(id, { type: 'npc_start', characterId: item.characterId });
        }
        accumulated.set(item.characterId, (accumulated.get(item.characterId) ?? '') + item.text);
        publish(id, { type: 'npc_chunk', characterId: item.characterId, text: item.text });
      }

      for (const [characterId, text] of accumulated) {
        const trimmed = text.trim();
        if (!trimmed) {
          continue;
        }
        const npcMessage: ChatMessage = {
          id: randomUUID(),
          role: 'npc',
          characterId,
          content: trimmed,
          timestamp: Date.now(),
        };

        updateRoom(id, current => {
          const memory = current.characterMemories[characterId];
          let nextMemory = memory;
          if (memory) {
            if (message) {
              nextMemory = appendConversation(nextMemory, { role: 'player', content: message, characterId });
            }
            nextMemory = appendConversation(nextMemory, { role: 'npc', content: trimmed, characterId });
          }
          return {
            ...current,
            groupChatHistory: [...current.groupChatHistory, npcMessage],
            characterMemories: nextMemory
              ? { ...current.characterMemories, [characterId]: nextMemory }
              : current.characterMemories,
          };
        });

        publish(id, { type: 'npc_done', characterId, message: npcMessage });
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error('Room group chat failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
