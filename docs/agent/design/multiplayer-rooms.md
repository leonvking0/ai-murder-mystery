# Design: multiplayer rooms + play-as-character

> Status: **in progress** (started 2026-06-30). This is the target architecture for the rebuild from
> single-player "detective" to multiplayer rooms where each human plays one of the cast.
> Source decisions: see DECISIONS.md (2026-06-30 entries). Track progress in WORKING-MEMORY.md.

## Goals (from the product owner)

1. **Play as a character.** Each human plays one of the scenario's characters (not an outside detective).
2. **Rooms with friends.** Host creates a room, shares a code/link; friends join; play together.
3. **Random character assignment** at game start. Uncontrolled characters become AI NPCs. The killer
   may be a human or an NPC (as in real 剧本杀).
4. **Self-hosted** via Docker Compose on a VPS (single container, single Node process).
5. Default LLM = **Google Gemini 2.5 Flash** (`gemini-2.5-flash`), env-configurable.

This rebuild also *subsumes* the critical review findings: per-player projection fixes **KI-001**
(info isolation), the persistent store fixes **KI-002**, and server-authoritative atomic updates fix
the concurrency races (**KI-007/KI-024**).

## Core model

- **Room** = the top-level game instance (replaces the old single-player `GameSession`). A room with a
  single human is just the single-player case (human plays one character, rest NPC).
- **Player** = a connected human: `{ id, name, isHost, assignedCharacterId?, connected }`.
- **characterControl**: `Record<characterId, { kind: 'human', playerId } | { kind: 'npc' }>` — set at
  game start by random assignment.
- NPC memory/LLM only runs for `npc`-controlled characters. Human characters are driven by their player.

```
Room {
  id, code (short join code), scenarioId,
  status: 'lobby' | 'in_progress' | 'finished',
  currentPhase, round, hostPlayerId,
  players: Player[],
  characterControl: Record<charId, Control>,
  characterMemories: Record<charId, CharacterMemory>,   // NPCs only (humans ignored)
  discoveredClues: Record<playerId, Clue[]>,             // per-player notebook (private clues)
  publicClues: Clue[],                                   // shared
  groupChatHistory: ChatMessage[],
  privateChats: Record<threadKey, ChatMessage[]>,        // playerId<->characterId threads
  votes: Record<playerId, accusedCharacterId>,
  createdAt, updatedAt,
}
```

## Persistence — SQLite (better-sqlite3, already a dependency)

- One DB file at `DATABASE_PATH` (default `./data/game.db`; Docker volume `/app/data`).
- Table `rooms(id TEXT PK, code TEXT UNIQUE, status, phase, updated_at, data JSON)`; `data` is the
  serialized Room. Index `code` for join lookups.
- All mutations go through `updateRoom(id, room => room')` doing a **synchronous transaction**
  (SELECT → mutate in JS → UPDATE) — atomic on a single writer, kills the read-modify-write races.
- Synchronous better-sqlite3 keeps call sites simple; no async store needed for a single container.
- Document: scaling to multiple instances later would need Postgres/Redis + external pub/sub.

## Realtime — in-process pub/sub + SSE

- A module-level `EventEmitter` keyed by room id (single process → fine for one Docker container).
- `GET /api/room/[id]/events` (SSE): subscribes the client; server emits typed events:
  `room_state` (lobby/roster), `phase_change`, `group_message`, `npc_start|npc_chunk|npc_done`,
  `private_message`, `clue_found`, `vote_update`, `reveal`.
- iOS / fallback: poll `GET /api/room/[id]/state` (same projection) — reuse the existing iOS sync
  pattern. Keep one shared SSE/iOS client helper (fixes KI-020 duplication).
- When scaling out later: swap the EventEmitter for Redis pub/sub behind the same interface.

## Information isolation — per-player projection (KI-001)

`projectRoomForPlayer(room, playerId)` returns ONLY:
- public scenario (`ScenarioPublic`: no `case.truth`, no `isKiller`, no other characters'
  `privateScript`/`alibi.truth`/`secrets`/`privateRelation`, no `clue.significance`, public timeline only);
- the requesting player's **own** assigned character's full private data;
- that player's own discovered private clues + all public clues + group chat + their own private threads;
- roster (names + assigned character *names*, not secrets), phase, votes count (not who/whom until reveal).
`case.truth` + full cast secrets are sent **only** when `currentPhase === 'REVEAL'`, via the projection.
NPC private scripts are never sent to any client (they exist only server-side for prompt building).

## Lifecycle / flow

1. **Create**: `POST /api/room` (scenarioId, hostName) → `{ roomId, code }`, status `lobby`.
2. **Join**: `POST /api/room/[id]/join` (name) → player added; broadcast roster. Shareable link
   `/room/[code]`.
3. **Start** (host): `POST /api/room/[id]/start` → random-assign characters to players (shuffle;
   leftovers = NPC), init NPC memories, status `in_progress`, phase `READING`; broadcast.
4. **READING**: each human sees their own character's private script (role reveal).
5. **Discussion/Investigation/Vote/Reveal**: as today but room-scoped + per-player. Host advances phases
   (later: gate on min participation). NPC turns in group chat only generate for NPC characters.
6. **Vote**: each human votes once; result = most-voted character; correct iff == killer character.

## Implementation phases (keep build green each step)

- **A. Backend foundation** — types (Room/Player/Control/projection), `lib/store/rooms.ts` (SQLite +
  atomic update), `lib/scenarios/projection.ts` (`ScenarioPublic` + `projectRoomForPlayer`).
- **B. Room lifecycle APIs** — create / join / state / start (assignment) / advance.
- **C. Realtime** — `lib/realtime/room-bus.ts` (EventEmitter) + `/api/room/[id]/events` SSE + shared
  client SSE helper.
- **D. Gameplay APIs (room-scoped)** — group-chat (humans post; NPCs via existing LLM path for
  npc-controlled only), private-chat (human→NPC; human→human stretch), investigate (per-player),
  vote (per-player), reveal.
- **E. Client rebuild** — home (create/join), `/room/[code]` lobby, role reveal, in-game wired to room +
  SSE, per-player identity + notebook.
- **F. Cleanup** — retire old `/api/game/*` + `game-sessions.ts` single-player path (clean cutover, no
  permanent duplication), update harness, add info-isolation + assignment tests.

## Open / deferred
- Human↔human private DM (Phase D stretch; human→NPC first).
- NPC voting (adds social deduction; stretch).
- Reconnect/identity: player id in a cookie/localStorage so a refresh rejoins the same seat.
- Min-players & late-join policy: MVP allows host to start with ≥1 human; late join only during `lobby`.
