import { randomUUID } from 'node:crypto';

import { manageRoomGroupResponse } from '@/lib/agents/room-group-chat';
import { appendConversation, applyGroupTurnReaction, compactConversationsIfNeeded } from '@/lib/game-engine/memory-manager';
import { getPhaseConfig } from '@/lib/game-engine/phase-manager';
import { applyDisconnectTakeovers, reassignHostIfNeeded, SEAT_TAKEOVER_IDLE_MS } from '@/lib/game-engine/room-engine';
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
      // KI-066: the stored message keeps the real playerId (server-side NPC labeling reads it), but the
      // broadcast must NOT carry the seat credential — send the author's publicId instead.
      const broadcastMessage: ChatMessage = { ...playerMessage, authorPublicId: player.publicId };
      delete broadcastMessage.playerId;
      publish(id, { type: 'group_message', message: broadcastMessage });
    }

    // 2. Stream NPC responses. Serialized per-room (C1) so two concurrent turns never interleave
    //    `npc_*` events. The human line above was already posted+broadcast BEFORE the lock, so player
    //    lines stay immediate and in order; only this NPC block is exclusive.
    //    `turnId` identifies this POST's turn; each responder carries a stable `messageId` (reused as
    //    the persisted ChatMessage.id) so the client can key + dedup its streaming bubble. Each
    //    `npc_start` is followed by exactly one terminal `npc_done` OR `npc_error` for that messageId.
    const turnId = randomUUID();
    // Speaker labeling for NPC memory (C7 / KI-015): render lines as `[群聊] 张三: …` instead of a
    // generic `玩家: …`. The human's line is attributed to their assigned character (fall back to their
    // display name); each NPC's line to that NPC's own name.
    const characterNameById = new Map(scenario.characters.map(character => [character.id, character.name]));
    const humanSpeakerName =
      (player.assignedCharacterId && characterNameById.get(player.assignedCharacterId)) || player.name;
    await runExclusive(id, async () => {
      // D2 opportunistic sweep (before the NPC turn, under the per-room lock so it can't race another
      // turn): hand any long-disconnected human seat to an NPC, and hand off the host if they've gone
      // idle. Re-read the swept room and drive the turn off it so takeover NPCs answer this turn.
      const before = getRoom(id);
      if (!before) {
        return;
      }
      const now = Date.now();
      updateRoom(id, current =>
        reassignHostIfNeeded(
          applyDisconnectTakeovers(current, scenario, now, SEAT_TAKEOVER_IDLE_MS),
          now,
          SEAT_TAKEOVER_IDLE_MS,
        ),
      );

      const fresh = getRoom(id);
      if (!fresh) {
        return;
      }

      // Broadcast any control changes so every client refetches the (now NPC-driven / re-hosted) roster.
      // Payloads carry only publicId / hostPublicId — never a real playerId.
      let sweptSomething = false;
      for (const character of scenario.characters) {
        const beforeControl = before.characterControl[character.id];
        const afterControl = fresh.characterControl[character.id];
        if (beforeControl?.kind === 'human' && afterControl?.kind === 'npc') {
          const departed = before.players.find(item => item.id === beforeControl.playerId);
          if (departed) {
            publish(id, { type: 'seat_takeover', characterId: character.id, publicId: departed.publicId });
          }
          sweptSomething = true;
        }
      }
      if (before.hostPlayerId !== fresh.hostPlayerId) {
        const newHost = fresh.players.find(item => item.id === fresh.hostPlayerId);
        if (newHost) {
          publish(id, { type: 'host_change', hostPublicId: newHost.publicId });
        }
        sweptSomething = true;
      }
      if (sweptSomething) {
        publish(id, { type: 'room_state' });
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
              const npcSpeakerName = characterNameById.get(characterId) ?? characterId;
              updateRoom(id, current => {
                const memory = current.characterMemories[characterId];
                let nextMemory = memory;
                if (memory) {
                  if (message) {
                    nextMemory = appendConversation(nextMemory, {
                      role: 'player', content: message, characterId,
                      speakerName: humanSpeakerName, channel: 'group', round: current.round,
                    });
                  }
                  nextMemory = appendConversation(nextMemory, {
                    role: 'npc', content: trimmed, characterId,
                    speakerName: npcSpeakerName, channel: 'group', round: current.round,
                  });
                  // D4 (KI-010): fold this group turn into the NPC's internal emotion/suspicion signals.
                  // Guarded on a non-empty human line — a nudge (empty `message`) has no accuser, so we
                  // never bump suspicion or touch emotion on it. `accuserCharacterId` is the human's
                  // CHARACTER id, NEVER `player.id` (a real player id must never enter an NPC record).
                  // These signals stay server-only: no projection field / RoomEvent / SSE publish is added.
                  if (message) {
                    nextMemory = applyGroupTurnReaction(nextMemory, {
                      selfName: npcSpeakerName,
                      triggerText: message,
                      accuserCharacterId: player.assignedCharacterId,
                      accuserName: humanSpeakerName,
                    });
                  }
                }
                return {
                  ...current,
                  groupChatHistory: [...current.groupChatHistory, npcMessage],
                  characterMemories: nextMemory
                    ? { ...current.characterMemories, [characterId]: nextMemory }
                    : current.characterMemories,
                };
              });

              // C10 (KI-021): bound the shared NPC memory. Safe here because the whole responder loop
              // runs under the per-room lock (runExclusive), so no concurrent turn interleaves this
              // read-modify-write. Only rewrites when compaction actually changed the array.
              const afterAppend = getRoom(id)?.characterMemories[characterId];
              if (afterAppend) {
                const compacted = await compactConversationsIfNeeded(afterAppend);
                if (compacted !== afterAppend) {
                  updateRoom(id, current => ({
                    ...current,
                    characterMemories: { ...current.characterMemories, [characterId]: compacted },
                  }));
                }
              }
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
