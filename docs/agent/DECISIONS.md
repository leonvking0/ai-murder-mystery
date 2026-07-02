# Decision log (ADR-style)

> Long-term memory of *why*. Append a new entry when you make or discover an architectural choice.
> Newest on top. Format: date — title — Status — Context / Decision / Consequences.
> "Discovered" = inferred from the codebase, not necessarily a deliberate choice; flag for revisit.

---

## 2026-06-30 — Rebuild to multiplayer rooms + play-as-character — Accepted (in progress)
**Context:** Product owner wants friends to play together in rooms, each playing one of the cast, with
random character assignment; deploy via Docker Compose on a VPS.
**Decision:** Introduce a `Room` model (top-level, replaces single-player `GameSession`; a 1-human room
== single-player). Random character assignment at start; uncontrolled characters become NPCs; killer may
be human or NPC. Persistence via **SQLite (better-sqlite3)**; realtime via an **in-process EventEmitter
+ SSE** (single container) with a polling fallback. Per-player server-side projection enforces info
isolation. Full plan: `docs/agent/design/multiplayer-rooms.md`.
**Consequences:** This subsumes KI-001 (per-player projection), KI-002 (persistent store), and the
concurrency races (atomic SQLite updates). The old `/api/game/*` + `game-sessions.ts` path will be
cleanly retired at the end (no permanent duplication). Scaling beyond one container later needs
Postgres/Redis + external pub/sub.

## 2026-06-30 — Default LLM = Google Gemini 2.5 Flash (`gemini-2.5-flash`) — Accepted
**Context:** Owner wants the free tier. Verified (2026-06): `gemini-2.5-flash` is the stable id and is
free-tier eligible (no card), but limited (~10 RPM / 250 RPD / 250K TPM).
**Decision:** Default provider = google, default model `gemini-2.5-flash`, both env-overridable
(`LLM_PROVIDER`, `GOOGLE_MODEL`, `ANTHROPIC_MODEL`). Anthropic default bumped to `claude-sonnet-4-6`.
**Consequences:** Multiplayer fires many NPC calls/turn — 250 RPD will throttle real sessions. Recommend
`gemini-2.5-flash-lite` (higher free RPM) for busy rooms; documented in `.env.local.example`. Fixes KI-008.

## 2026-06-30 — Self-host via Docker Compose + SQLite volume — Accepted
**Context:** Deploy target is a VPS / own server with docker compose (not Vercel serverless).
**Decision:** `Dockerfile` (node:22 slim, full node_modules so the better-sqlite3 native binding works)
+ `docker-compose.yml` (app + named volume `game-data` at `/app/data`). DB at `DATABASE_PATH`.
`next.config.ts` marks `better-sqlite3` as a server-external package.
**Consequences:** Single long-lived container → in-memory pub/sub and synchronous SQLite are valid.
Not suitable for multi-instance scale-out without revisiting (would need shared pub/sub + DB).

## 2026-06-30 — Harness infrastructure added under `docs/agent/` — Accepted
**Context:** Multiple agents will work on this repo; knowledge was scattered across `AGENTS.md` and
`docs/PROJECT-BRIEF.md` with no record of decisions, pitfalls, or current state.
**Decision:** Add `CLAUDE.md` (entry point) + `docs/agent/{README,ARCHITECTURE,DECISIONS,PITFALLS,
KNOWN-ISSUES,WORKING-MEMORY}.md`. `AGENTS.md` stays as the original spec; `ARCHITECTURE.md` documents
what is *actually built*.
**Consequences:** Future agents onboard from `CLAUDE.md`. Keep these files current or they rot.

## 2026-06-30 — (Discovered) Runtime uses static scenario import, not the validated loader — Revisit
**Context:** `lib/scenarios/loader.ts` + `schema.ts` provide async loading + validation, but every
runtime path imports `data/scenarios/storm-mansion.json` directly via `lib/store/game-sessions.ts`.
**Decision (as-built):** Static import wins; the loader is dead code.
**Consequences:** Scenarios are never validated at runtime; adding a scenario file does nothing until
`game-sessions.ts` is edited. Revisit: either route runtime through `loadScenarioById` (validated,
multi-scenario) or delete the loader to remove confusion. See KNOWN-ISSUES.

## 2026-06-30 — (Discovered) In-memory `Map` session store — Revisit (blocks Vercel)
**Context:** `game-sessions.ts` keeps sessions in a module-level `Map`. `better-sqlite3` is a
dependency but unused; the brief targets Vercel.
**Decision (as-built):** Sessions live in process memory only.
**Consequences:** Works for a single long-lived `next start` / `next dev` process. **Breaks on Vercel
serverless / multi-instance and across restarts** (sessions vanish → 404). Needs a real store
(SQLite/Postgres/Upstash/Redis) before any real deployment. See KNOWN-ISSUES.

## 2026-06-30 — (Discovered) Player is a detective, not one of the 5 characters — Revisit
**Context:** Brief says the player plays one character. Code never sets `playerCharacterId`; all 5
characters are NPCs and the player chats with all of them from outside.
**Decision (as-built):** Single-player "outside detective" model.
**Consequences:** Simpler, but `playerCharacterId` is dead, and information isolation is one-directional
(player should not see solution — currently they can; see KNOWN-ISSUES). Revisit when adding
play-as-character mode.

## 2026-06-30 — (Discovered) GM is static narration, not a live agent — Revisit
**Context:** Brief describes a dynamic GM agent. In code, `gm-agent.ts`'s streaming GM is never called
by any route; phase narration is the static `PHASE_NARRATIONS` map.
**Decision (as-built):** No live GM. `decideRespondingNPCs` (turn selection) is the only GM logic used.
**Consequences:** No dynamic pacing, clue release, or anti-冷场 nudging. Lots of GM code is dead.
Revisit if/when wiring a real GM (and keep its full-truth prompt server-only).

## 2026-06-30 — (Discovered) Dual chat transports: SSE + non-streaming "-sync" fallback — Accepted
**Context:** Commits `84db28d`/`c7c848e` added `chat-sync` / `group-chat-sync` because SSE streaming
was unreliable on iOS Safari/Chrome.
**Decision:** Client picks the `-sync` route when it detects iOS, else uses SSE.
**Consequences:** Logic is duplicated across the streaming and sync routes and across `ChatPanel` /
`GroupChat`. Keep the two in sync when changing chat behavior, or refactor to share a core.

## 2026-07-01 — Signed httpOnly cookie is the sole seat-auth credential — Accepted
**Context:** The multiplayer routes trusted a `playerId` supplied in the query string (`?playerId=`),
an `x-player-id` header, or the JSON body, and the `/state` projection shipped every member's real
`playerId` in the roster (`toPublicPlayer` returned `id`). Since `playerId` was *also* the only auth
token, any member could read another's id from the roster and `GET /state?playerId=<other>` to receive
that player's full `yourCharacter` (privateScript, secrets, alibi.truth, isKiller) — one request
revealed the solution (KI-034). `/events` (KI-038) and `/join` (KI-041) had no auth/limit at all.
**Decision:** Seat auth is a signed, httpOnly, per-room cookie `mm_auth_<roomId>` (SameSite=Lax,
Path=/). Token = `playerId.HMAC-SHA256(roomId:playerId)` via `node:crypto.createHmac` (no new deps),
secret from `ROOM_AUTH_SECRET` with a documented dev fallback + one-time `console.warn`. Minted on
**create** and **join** (`withAuthCookie`); every route resolves the acting player via
`getAuthedPlayerId(req, roomId)` and 403s otherwise — query/header/body `playerId` are never trusted
for auth again (closes KI-061's URL-token leak too). The roster projection exposes only a non-secret
`publicId` (render key) + server-set `isSelf`; real `playerId`s never leave the server. `/events`
verifies membership; `/join` dedups via the cookie and rate-limits new seats per IP; a host-only
`/kick` (host = cookie == `hostPlayerId`) clears a ghost lobby seat. Binding both `roomId` and
`playerId` into the MAC means a token can't be replayed across seats or rooms.
**Why cookie, not a bearer body/header token:** httpOnly keeps the token out of JS (XSS can't read it)
and `EventSource` sends it automatically for same-origin `/events`, so no client header plumbing.
**Consequences:** `ROOM_AUTH_SECRET` MUST be set in production or tokens are forgeable via the dev
fallback. Cookies are per-room, so one browser can hold several seats. `Player` gains a `publicId`;
clients key/render off `publicId`/`isSelf` instead of `id`. localStorage `playerId` remains only as UX
bookkeeping ("have I joined this room"), never as an auth credential.

## 2026-07-02 — Per-message NPC streaming contract + per-room turn mutex — Accepted
**Context:** Group-chat streamed `npc_start/npc_chunk/npc_done` events carrying only `characterId`, the
route persisted all NPC replies only after the whole turn's generator finished, and there was no
per-room serialization. Two messages within ~1-2s ran overlapping `manageRoomGroupResponse` generators
whose events interleaved with no way to tell them apart; the client's single streaming slot rendered
mixed A+B text; a mid-turn crash dropped all already-broadcast replies (KI-035). There was also no way
to signal an NPC-level failure (KI-044).
**Decision:** (1) A per-room in-process turn mutex (`lib/realtime/room-lock.ts` `runExclusive`, a
promise-chain hung off `globalThis` to survive HMR) serializes only the NPC generate-and-broadcast
block; the human's own message is posted/broadcast *before* the lock so player lines stay immediate.
(2) Every `npc_*` event carries `turnId` (one per POST) + `messageId` (stable across a responder's
start→chunk→done, reused as the persisted `ChatMessage.id` so the client keys its streaming bubble and
dedups against `/state`). (3) Persist + `npc_done` per NPC as each stream finishes, not at turn end.
(4) New `npc_error{reason:'not_configured'|'failed'}`; failed/partial turns are never persisted, and
`streamNPCGroupResponse` no longer swallows provider errors into a canned line — the caller decides.
The generator yields a tagged `NpcTurnEvent` union and lazy-imports `npc-agent` (which statically pulls
in `@/data/*.json`) so it stays loadable under `node --experimental-strip-types` for offline tests; a
`deps` seam injects fakes for the config/stream in tests.
**Consequences:** The client must support multiple simultaneous streaming bubbles (a `Map<messageId,…>`)
and treat each `npc_start` as followed by exactly one terminal `npc_done|npc_error`. Same-room turns run
strictly one-at-a-time (acceptable — discussion is turn-based); different rooms never block each other.

## 2026-07-02 — Private-chat NPC memory is isolated per (playerId, characterId) — Accepted
**Context:** The private-chat route appended both the player's line and the NPC's reply into the SHARED
`characterMemories[characterId].conversations`, which `formatPersonalMemory` renders into *every*
player's prompt for that NPC. So player A's private line to an NPC leaked into player B's prompt/replies
for that NPC — a player-to-player information leak through the NPC (KI-039), the private-chat analogue
of the KI-001/KI-034 isolation guarantee.
**Decision:** Private turns persist ONLY to the already-isolated `privateChats[`${playerId}:${characterId}`]`
thread (which is what feeds that player's own `conversationHistory` back to the model). The shared
`characterMemories[characterId]` is written solely by PUBLIC group-chat lines. `appendConversation`
gained optional speaker/channel/round labeling (fixes KI-015's hardcoded `round:0`), and shared memory
growth is bounded by `summarizeConversations` compaction past a threshold.
**Consequences:** An NPC's "memory" is now two-tier: a shared public memory (group chat, clues) plus each
player's private thread supplied per-request — never cross-pollinated. Voting/pure helpers that tests
load must remain strip-types-loadable, so shared pure vote/tally helpers live in `projection.ts` (not
`room-engine.ts`, whose `@/`-value import chain the strip-types test runner can't resolve).

## 2026-07-02 — Disconnect takeover + host handoff via SSE-refcount presence — Accepted
**Context:** A player who closed their tab left a dead seat; if the host left, the room bricked (only the host
can advance). The prior `Player.connected` was never authoritatively driven. Separately, the projection shipped
the host's real `hostPlayerId` (a seat auth credential) in `PlayerRoomView.room` — a latent KI-034-class leak,
though the client only used `isHost`.
**Decision:** SSE `/events` maintains an in-process **per-(room,player) connection refcount** (`markConnected`/
`markDisconnected`, keyed `roomId::playerId`, hung off `globalThis` for HMR): only the 0↔1 boundary flips
`Player.connected` + stamps **server-only** `disconnectedAt`/`lastSeenAt`, so multi-tab / reconnect overlap never
false-toggles presence. A seat whose human has been disconnected ≥ `SEAT_TAKEOVER_IDLE_MS` (90s) is handed to an
NPC seeded with a fresh `initializeMemory` + the room's **public-clue content only** (never `significance`, never
the departed human's private clues); the host role auto-transfers to the earliest-joined connected human; a
returning human **reclaims** their seat on reconnect. The sweep runs opportunistically inside the group-chat
per-room lock (no cron). The pure selectors (`seatsToTakeOver`/`reassignHost`) live in `projection.ts` (strip-
types-loadable, offline-tested); the scenario-aware mutation (`takeOverSeatAsNpc`) lives in `room-engine.ts`.
The projection now ships `hostPublicId` (render id) instead of `hostPlayerId`, and `PublicPlayer.controlledByNpc`;
the npc `CharacterControl` arm carries a server-only `takenOverFromPlayerId` used only for reveal attribution.
**Consequences:** Presence is best-effort (in-process; a multi-container deploy would need shared state). Takeover
NPC memory is intentionally public-only, so a taken-over seat can't voice the departed human's private clues.
`hostPlayerId` never leaves the server again.

## 2026-07-02 — NPC emotion/suspicion is rule-based and strictly server-side — Accepted
**Context:** `CharacterMemory.suspicions`/`emotionalState` (KI-010) were seeded once and only read into the
prompt — the "怀疑度/情绪 drives behavior" design was inert.
**Decision:** Pure, offline-tested helpers (`deriveGroupTurnReaction`/`applyGroupTurnReaction` in
`memory-manager.ts`) detect an accusation (the trigger names the NPC **and** contains an accusation keyword),
bump suspicion toward the accuser — keyed by **character id, never `player.id`** — and flip emotion to a cornered
label, with a one-notch de-escalation ladder on benign turns. The group-chat `case 'done'` handler folds this
into `characterMemories` (guarded so a nudge never bumps suspicion); `npc-base` renders the NPC's own suspicions
(self filtered out) + static cornered-defense guidance into the prompt. These signals **never** get a projection
field, RoomEvent, or client surface — they are NPC-internal LLM input only (a serialize-scan regression test
asserts a seeded emotion/suspicion sentinel never appears in `projectRoomForPlayer`).
**Consequences:** Suspicion reason strings must always be our own generated text (never sourced from another
character's secrets) so a prompt echo can't leak them. Emotion labels are free-text (read verbatim by
`npc-voter`), so any label is safe.

## 2026-07-02 — VOTING is a concurrent defense round; reveal ballots are keyed by character — Accepted
**Context:** VOTING had `allowsChat:false` (no debate), and the reveal exposed only an aggregate tally. A
per-ballot breakdown risked leaking playerIds (human votes are keyed by `playerId`, NPC votes by `npc:<id>`).
**Decision:** Flip `PHASE_CONFIGS.VOTING.allowsChat` to `true` — the single unified gate opens chat + NPC
responses + present-clue during VOTING, so a defense round runs **concurrently** with balloting (votes stay
changeable until the host advances; no separate "argue-then-lock" sub-state — deferred). `buildReveal` adds
`RevealInfo.ballots` keyed strictly by **character**: `npc:<id>` → the character id; a human `playerId` key is
resolved to their character via `assignedCharacterId` / `human` characterControl, and **dropped** if it maps to
nothing — a raw playerId can never enter a ballot (a taken-over seat still resolves via its `assignedCharacterId`).
The staged reveal is pure client-side progressive disclosure (no server pacing / new events).
**Consequences:** Because chat is open in VOTING, present-clue + private-chat are also available there (same gate)
— intended. The ballots isolation guarantee is covered by a dedicated regression test incl. the taken-over-seat case.
