// SQLite-backed room store (multiplayer). Synchronous better-sqlite3 on a single container gives
// atomic read-modify-write (fixes the in-memory Map persistence + concurrency issues, KI-002/007/024).

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Relative + explicit `.ts` so the strip-types test runner resolves this value import at runtime
// (`@/` aliases resolve only for type-only imports there). See tests/info-isolation.test.ts.
import { generatePublicId } from '../room/auth.ts';
import { resolveFlow } from '../game-engine/flow.ts';
import type { FlowId } from '../game-engine/flow.ts';
import type { Player, Room, RoomStatus } from '@/types/game';

// Survive Next dev HMR (module reloads) by hanging the db handle off globalThis, mirroring the emitter
// registry in lib/realtime/room-bus.ts. Without this, each HMR reload leaks an unclosed better-sqlite3
// connection (KI-053).
const globalForDb = globalThis as unknown as {
  __roomsDb?: Database.Database;
  __roomsLastPrune?: number;
};

// Finished rooms are never otherwise deleted → unbounded SQLite growth (KI-054). Sweep them after a TTL.
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS) || 24 * 60 * 60 * 1000;

function getDb(): Database.Database {
  if (globalForDb.__roomsDb) {
    return globalForDb.__roomsDb;
  }

  const path = process.env.DATABASE_PATH ?? './data/game.db';
  mkdirSync(dirname(path), { recursive: true });

  const instance = new Database(path);
  instance.pragma('journal_mode = WAL');
  instance.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  globalForDb.__roomsDb = instance;
  return instance;
}

/**
 * KI-054: delete `finished` rooms whose last update is older than the TTL. Never touches `lobby` or
 * `in_progress` rooms. Returns the number of rows removed. Pure-ish: pass `now` for deterministic tests.
 */
export function pruneFinishedRooms(now = Date.now()): number {
  const database = getDb();
  const cutoff = now - ROOM_TTL_MS;
  const result = database
    .prepare(`DELETE FROM rooms WHERE status = 'finished' AND updated_at < ?`)
    .run(cutoff);
  return result.changes;
}

const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // opportunistic sweep at most once/hour

// Run the TTL sweep opportunistically but throttled, so a DELETE isn't issued on every request.
function maybePruneFinishedRooms(now: number): void {
  const lastPrune = globalForDb.__roomsLastPrune ?? 0;
  if (now - lastPrune > PRUNE_INTERVAL_MS) {
    globalForDb.__roomsLastPrune = now;
    pruneFinishedRooms(now);
  }
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no easily-confused chars

function generateRoomCode(): string {
  const database = getDb();
  const existsStmt = database.prepare('SELECT 1 FROM rooms WHERE code = ?');

  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = '';
    for (let i = 0; i < 5; i += 1) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }

    if (!existsStmt.get(code)) {
      return code;
    }
  }

  throw new Error('Failed to generate a unique room code');
}

function persist(room: Room): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO rooms (id, code, status, phase, updated_at, data)
       VALUES (@id, @code, @status, @phase, @updated_at, @data)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code,
         status = excluded.status,
         phase = excluded.phase,
         updated_at = excluded.updated_at,
         data = excluded.data`,
    )
    .run({
      id: room.id,
      code: room.code,
      status: room.status,
      phase: room.currentPhase,
      updated_at: room.updatedAt,
      data: JSON.stringify(room),
    });
}

function parseRow(row: { data: string } | undefined): Room | undefined {
  if (!row) {
    return undefined;
  }

  return JSON.parse(row.data) as Room;
}

export interface CreateRoomInput {
  scenarioId: string;
  hostName: string;
  flowId?: FlowId;
  // F4-d: opt in to deadline-based auto-advance (default false). No phaseDeadline is set at LOBBY; the
  // host still starts the game deliberately, and deadlines are stamped on each in-game phase entry.
  autoAdvance?: boolean;
}

export function createRoom(input: CreateRoomInput): Room {
  const now = Date.now();
  const hostPlayer: Player = {
    id: randomUUID(),
    publicId: generatePublicId(),
    name: input.hostName.trim() || '房主',
    isHost: true,
    connected: true,
    joinedAt: now,
  };

  const room: Room = {
    id: randomUUID(),
    code: generateRoomCode(),
    scenarioId: input.scenarioId,
    status: 'lobby',
    currentPhase: 'LOBBY',
    round: 1,
    phaseSequence: resolveFlow(input.flowId),
    autoAdvance: input.autoAdvance === true,
    hostPlayerId: hostPlayer.id,
    players: [hostPlayer],
    characterControl: {},
    characterMemories: {},
    discoveredClues: {},
    publicClues: [],
    groupChatHistory: [],
    privateChats: {},
    votes: {},
    createdAt: now,
    updatedAt: now,
  };

  maybePruneFinishedRooms(now);
  persist(room);
  return room;
}

export function getRoom(id: string): Room | undefined {
  const database = getDb();
  return parseRow(database.prepare('SELECT data FROM rooms WHERE id = ?').get(id) as { data: string } | undefined);
}

export function getRoomByCode(code: string): Room | undefined {
  const database = getDb();
  return parseRow(
    database.prepare('SELECT data FROM rooms WHERE code = ?').get(code.toUpperCase()) as
      | { data: string }
      | undefined,
  );
}

/**
 * Atomic read-modify-write. `mutator` receives the current room and returns the next room (or null
 * to abort). Runs inside a transaction so concurrent requests cannot lose each other's writes.
 */
export function updateRoom(id: string, mutator: (room: Room) => Room | null): Room | undefined {
  const database = getDb();
  const txn = database.transaction((roomId: string): Room | undefined => {
    const current = parseRow(
      database.prepare('SELECT data FROM rooms WHERE id = ?').get(roomId) as { data: string } | undefined,
    );
    if (!current) {
      return undefined;
    }

    const next = mutator(current);
    if (!next) {
      return current;
    }

    next.updatedAt = Date.now();
    persist(next);
    return next;
  });

  return txn(id);
}

export function setRoomStatus(id: string, status: RoomStatus): Room | undefined {
  return updateRoom(id, room => ({ ...room, status }));
}
