import { randomUUID } from 'node:crypto';

import { manageRoomGroupResponse } from '@/lib/agents/room-group-chat';
import { appendConversation } from '@/lib/game-engine/memory-manager';
import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { getAuthedPlayerId } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { getRoom, updateRoom } from '@/lib/store/rooms';
import { publish } from '@/lib/realtime/room-bus';
import { runExclusive } from '@/lib/realtime/room-lock';
import type { ChatMessage } from '@/types/game';

export const maxDuration = 300;

// Contract (A5): a real message posts + triggers NPCs; an explicit `{ nudge: true }` re-prompts the
// NPCs without posting anything; a truly-empty, non-nudge body is rejected (400) so it can never
// silently drive LLM replies. The existing client only ever sends a non-empty `message`.
interface GroupChatBody {
  message?: string;
  nudge?: boolean;
}

interface RouteContext {
  params: Promise<{ id: string }>;
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

    const playerId = getAuthedPlayerId(req, id);
    if (!playerId) {
      return Response.json({ error: 'Not authenticated for this room' }, { status: 403 });
    }
    const message = (body.message ?? '').trim().slice(0, 2000);
    const nudge = body.nudge === true;

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
      return Response.json({ error: `当前阶段不能群聊：${room.currentPhase}` }, { status: 403 });
    }

    // A5 throttle contract: an empty, non-nudge post must never trigger LLM replies.
    if (!message && !nudge) {
      return Response.json({ error: 'message is required' }, { status: 400 });
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

    // 2. Stream NPC responses. Serialized per-room (C1) so two concurrent turns never interleave
    //    `npc_*` events. The human line above was already posted+broadcast BEFORE the lock, so player
    //    lines stay immediate and in order; only this NPC block is exclusive.
    //    `turnId` identifies this POST's turn; each responder carries a stable `messageId` (reused as
    //    the persisted ChatMessage.id) so the client can key + dedup its streaming bubble. Each
    //    `npc_start` is followed by exactly one terminal `npc_done` OR `npc_error` for that messageId.
    const turnId = randomUUID();
    await runExclusive(id, async () => {
      const fresh = getRoom(id);
      if (!fresh) {
        return;
      }

      for await (const event of manageRoomGroupResponse(fresh, scenario, message)) {
        const { characterId, messageId } = event;
        switch (event.kind) {
          case 'start':
            publish(id, { type: 'npc_start', turnId, messageId, characterId });
            break;
          case 'chunk':
            publish(id, { type: 'npc_chunk', turnId, messageId, characterId, text: event.text });
            break;
          case 'error':
            publish(id, { type: 'npc_error', turnId, messageId, characterId, reason: event.reason });
            break;
          case 'done': {
            const trimmed = event.content.trim();
            const npcMessage: ChatMessage = {
              id: messageId,
              role: 'npc',
              characterId,
              content: trimmed,
              timestamp: Date.now(),
            };

            // C6: never persist an empty/whitespace-only turn — but still emit the terminal npc_done
            // so the client can always clear the streaming bubble (C4).
            if (trimmed) {
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
            }

            publish(id, { type: 'npc_done', turnId, messageId, characterId, message: npcMessage });
            break;
          }
        }
      }
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error('Room group chat failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
