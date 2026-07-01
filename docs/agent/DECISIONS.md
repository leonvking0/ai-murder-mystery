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
