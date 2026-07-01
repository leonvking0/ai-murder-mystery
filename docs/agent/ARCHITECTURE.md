# Architecture map

> Long-term memory. How the system is actually wired **as built**.
> Last verified against code: 2026-06-30 (after the multiplayer rebuild + cutover).

## What it is now

Multiplayer, play-as-character AI 剧本杀. A host creates a **room**, friends join with a code, and at
start each human is **randomly assigned** one of the cast; the rest are AI NPCs (the killer can be a
human or an NPC). Players read their own secret script, then discuss (group + private-to-NPC chat),
investigate, vote, and get the reveal. A single human room == single-player.

## High-level

```
Browser (React 19 client components)
  │  fetch (actions)  +  EventSource (realtime)
  ▼
Next.js App Router routes under app/api/room/**
  │
  ├─ lib/store/rooms.ts          ← SQLite (better-sqlite3) room store, atomic updateRoom()
  ├─ lib/scenarios/registry.ts   ← validated scenario source (validates at startup)
  ├─ lib/scenarios/projection.ts ← per-player view (information isolation) + clue/scenario sanitizers
  ├─ lib/game-engine/*           ← room-engine (assign/advance), room-investigation, phase-manager, memory
  ├─ lib/agents/*                ← npc-agent (LLM), room-group-chat (NPC turn-taking), prompts, llm-provider
  └─ lib/realtime/*              ← room-bus (in-process pub/sub), sse helpers
        │
        ▼
   Vercel AI SDK (`ai`) → @ai-sdk/google (default, gemini-2.5-flash) | @ai-sdk/anthropic
```

## Data model (`types/game.ts`)

- **Room** = top-level instance: `code`, `scenarioId`, `status` (lobby|in_progress|finished),
  `currentPhase`, `round`, `hostPlayerId`, `players[]`, `characterControl` (charId → human/npc),
  `characterMemories` (NPCs only), `discoveredClues` (per playerId), `publicClues`, `groupChatHistory`,
  `privateChats` (`${playerId}:${characterId}` → messages), `votes` (playerId → charId).
- **Player**: `id` (server-minted), `name`, `isHost`, `assignedCharacterId?`, `connected`.
- **Projections** (server → client, sanitized): `ScenarioPublic`, `CharacterPublic`, `ClueView`
  (no `significance`), `PlayerRoomView`, `RevealInfo`. See "information isolation" below.

## Persistence — SQLite (`lib/store/rooms.ts`)

- One file at `DATABASE_PATH` (default `./data/game.db`; Docker volume `/app/data`, gitignored locally).
- Table `rooms(id, code UNIQUE, status, phase, updated_at, data JSON)`; the Room is the `data` blob.
- **All mutations** go through `updateRoom(id, room => room')` in a **synchronous transaction**
  (atomic read-modify-write) — no lost-update races. `getRoom`, `getRoomByCode`, `createRoom`,
  `setRoomStatus` round it out.

## Realtime — `lib/realtime/room-bus.ts` + SSE

- Module-level `EventEmitter` per room (globalThis-cached to survive Next HMR). `publish/subscribe`.
- `GET /api/room/[id]/events` (SSE) subscribes a client; the browser uses native `EventSource`.
- Event payloads are **public-safe only**: `room_state` (signal to refetch), `phase_change`,
  `group_message`, `npc_start|npc_chunk|npc_done`, `clue_public`, `vote_update`, `reveal`.
- Anything per-player (private chat, your clues, the reveal truth) is delivered via the projected
  `/state` endpoint, never broadcast.
- Client pattern: on `room_state`/`phase_change`/`vote_update`/`reveal` → refetch `/state`; on
  `group_message`/`clue_public`/`npc_done` → append (dedup by message id); `npc_*` drives a live bubble.
- Single Docker container = single process, so in-process pub/sub is sufficient. Scaling out → Redis.

## Phase machine (`lib/game-engine/phase-manager.ts` + `room-engine.ts`)

`PHASE_SEQUENCE`: LOBBY → READING → INTRO → DISCUSSION_1 → INVESTIGATION_1 → DISCUSSION_2 →
INVESTIGATION_2 → FINAL_DISCUSSION → VOTING → REVEAL. Rooms start at `LOBBY` (status lobby); `start`
moves to `READING`. `room-engine.advanceRoom` / `canAdvanceRoom` drive transitions (host-only);
VOTING→REVEAL needs ≥1 vote; reaching REVEAL sets status `finished`. `PHASE_CONFIGS` gives
allowsChat/Investigation/Voting. `PHASE_NARRATIONS` is static GM flavor text.

## Routes (all under `app/api/room`)

- `POST /api/room` — create → `{roomId, code, playerId}` (host)
- `GET /api/room/resolve/[code]` — public code → room lookup (join page)
- `POST /api/room/[id]/join` — `{name}` → `{playerId}` (lobby only, capped at #characters)
- `GET /api/room/[id]/state` — per-player projection (`?playerId=` or `x-player-id`; 403 non-member)
- `POST /api/room/[id]/start` — host → random assignment, READING
- `POST /api/room/[id]/advance` — host → next phase
- `POST /api/room/[id]/group-chat` — `{playerId, message}`; posts as your character, NPCs reply via
  LLM, all broadcast over the bus
- `POST /api/room/[id]/private-chat` — `{playerId, targetCharacterId, message}` human→NPC (non-stream)
- `POST /api/room/[id]/investigate` — `{playerId, locationId}` per-player; returns only this search's
  clues (significance stripped); public clues shared, private stay with the player
- `POST /api/room/[id]/vote` — `{playerId, accusedCharacterId}` (changeable until REVEAL)
- `GET /api/room/[id]/events` — SSE realtime

## Client (`app/`, `components/room`)

- `app/page.tsx` — home: create room (name) / join by code. **Does not import scenario data.**
- `app/room/[code]/page.tsx` → `components/room/RoomClient.tsx` — resolves code→roomId, manages
  `playerId` (localStorage via `lib/room/identity.ts`), opens the SSE stream, routes by phase.
- `components/room/RoomPanels.tsx` — Lobby, RoleReveal, GroupChatPanel, PrivateChatPanel,
  InvestigationRoom, VotingRoom, RevealRoom, Notebook (presentational).
- Reused from the old UI: `components/game/PhaseIndicator.tsx` + shadcn `components/ui/*`.

## Information isolation (the #1 rule) — enforced server-side

`projectRoomForPlayer(room, scenario, playerId)`:
- public scenario only (`toScenarioPublic`: strips `case.truth/murderMethod/motive`, `isKiller`,
  other characters' `privateScript/alibi.truth/secrets/privateRelation`, non-public timeline);
- locations carry **no** clues (you only see what you discover); `ClueView` strips GM `significance`;
- the requesting player's **own** full character (their secret script) + their own private threads +
  their own discovered clues + shared public clues;
- `reveal` (truth, killer, tally, who-played-whom) **only** when `currentPhase === 'REVEAL'`.
NPC private scripts never leave the server (used only for prompt building). Covered by
`tests/info-isolation.test.ts` + the gameplay E2E.

## LLM (`lib/agents/llm-provider.ts`)

Default provider Google, model `gemini-2.5-flash` (env: `LLM_PROVIDER`, `GOOGLE_MODEL`,
`ANTHROPIC_MODEL`; Anthropic default `claude-sonnet-4-6`). If no key is configured, NPC calls yield a
safe fallback line (game stays navigable). `npc-agent.ts` streams; `room-group-chat.ts` selects which
**NPC** characters respond per turn (humans drive their own).

## Deploy (Docker Compose)

`Dockerfile` (node:22-slim, full node_modules so better-sqlite3's native binding works) +
`docker-compose.yml` (app + `game-data` volume at `/app/data`). `next.config.ts` marks
`better-sqlite3` server-external. Run: `cp .env.local.example .env.local` (add key) →
`docker compose up -d --build`.

## Scenario data

Single scenario `data/scenarios/storm-mansion.json` (5 chars, killer `wang-daming`, 5 locations ×
round-gated clues). Validated at startup by `registry.ts`. Two minor content bugs remain (KI-030/031).

## Tooling

`npm run dev|build|start|lint|typecheck|test`. `test` = `node --experimental-strip-types
tests/info-isolation.test.ts` (no extra deps). Baseline is green.
