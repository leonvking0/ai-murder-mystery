// In-process pub/sub for room realtime. One Docker container = one Node process, so a module-level
// EventEmitter is sufficient (see design/multiplayer-rooms.md). Scaling out later → swap for Redis
// pub/sub behind this same interface.
//
// All event payloads are PUBLIC-safe (group chat is shared; phase/roster/vote-count are public).
// Anything per-player (private chat, your own clues, the reveal truth) is delivered via the projected
// /state endpoint, never broadcast here.

import { EventEmitter } from 'node:events';

import type { ChatMessage } from '@/types/game';

export type RoomEvent =
  | { type: 'room_state' } // signal: refetch projected /state (roster / lobby / status changed)
  | { type: 'phase_change'; phase: string; round: number }
  | { type: 'group_message'; message: ChatMessage }
  // NPC group-chat streaming. Every event carries `turnId` (one per group-chat POST) + `messageId`
  // (stable across a single responder's start→chunk→done, and reused as the persisted ChatMessage.id
  // so the client can key its streaming bubble and dedup it against /state). Each `npc_start` is
  // eventually followed by exactly one terminal `npc_done` OR `npc_error` for the same `messageId`.
  | { type: 'npc_start'; turnId: string; messageId: string; characterId: string }
  | { type: 'npc_chunk'; turnId: string; messageId: string; characterId: string; text: string }
  | { type: 'npc_done'; turnId: string; messageId: string; characterId: string; message: ChatMessage }
  | { type: 'npc_error'; turnId: string; messageId: string; characterId: string; reason: 'not_configured' | 'failed' }
  | { type: 'clue_public'; message: ChatMessage }
  | { type: 'vote_update'; voteCount: number }
  // D2 presence / disconnect takeover. Payloads carry ONLY public render ids (publicId / hostPublicId)
  // and characterId — NEVER a real (secret) playerId. `presence` toggles a member's connected dot;
  // `seat_takeover` signals a seat flipped controller (NPC took over, or the human reclaimed it);
  // `host_change` names the new host. Clients also receive a `room_state` alongside these to refetch.
  | { type: 'presence'; publicId: string; connected: boolean }
  | { type: 'seat_takeover'; characterId: string; publicId: string }
  | { type: 'host_change'; hostPublicId: string }
  | { type: 'reveal' };

type RoomEventHandler = (event: RoomEvent) => void;

// Survive Next dev HMR (module reloads) by hanging the registry off globalThis.
const globalForBus = globalThis as unknown as { __roomEmitters?: Map<string, EventEmitter> };
const emitters: Map<string, EventEmitter> = (globalForBus.__roomEmitters ??= new Map());

function emitterFor(roomId: string): EventEmitter {
  let emitter = emitters.get(roomId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(0); // many concurrent SSE subscribers per room
    emitters.set(roomId, emitter);
  }
  return emitter;
}

export function publish(roomId: string, event: RoomEvent): void {
  emitterFor(roomId).emit('event', event);
}

export function subscribe(roomId: string, handler: RoomEventHandler): () => void {
  const emitter = emitterFor(roomId);
  emitter.on('event', handler);

  return () => {
    emitter.off('event', handler);
    // Drop the emitter once nobody is listening, so empty rooms don't leak.
    if (emitter.listenerCount('event') === 0) {
      emitters.delete(roomId);
    }
  };
}

// ---- D2 presence: per-(room, player) SSE connection refcount ----
//
// A single player may hold several concurrent SSE streams (multi-tab, or a brief reconnect overlap).
// We only flip a player's presence when their count crosses the 0↔1 boundary, so a second tab opening
// or a flaky reconnect never falsely marks them offline. Keyed `${roomId}::${playerId}` (both are
// UUIDs, so `::` can't collide). Like the emitter registry above, this hangs off globalThis to
// survive Next HMR.
const globalForPresence = globalThis as unknown as { __roomConnCounts?: Map<string, number> };
const connCounts: Map<string, number> = (globalForPresence.__roomConnCounts ??= new Map());

function presenceKey(roomId: string, playerId: string): string {
  return `${roomId}::${playerId}`;
}

/** Record a new SSE connection. `firstConnection` is true only when the count goes 0 → 1. */
export function markConnected(roomId: string, playerId: string): { firstConnection: boolean } {
  const key = presenceKey(roomId, playerId);
  const next = (connCounts.get(key) ?? 0) + 1;
  connCounts.set(key, next);
  return { firstConnection: next === 1 };
}

/** Record an SSE disconnect. `lastConnection` is true only when the count goes 1 → 0. */
export function markDisconnected(roomId: string, playerId: string): { lastConnection: boolean } {
  const key = presenceKey(roomId, playerId);
  const next = Math.max(0, (connCounts.get(key) ?? 0) - 1);
  if (next === 0) {
    connCounts.delete(key);
  } else {
    connCounts.set(key, next);
  }
  return { lastConnection: next === 0 };
}
