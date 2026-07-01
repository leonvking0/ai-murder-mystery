# Working memory (short-term)

> Scratch state for the *current* phase of work. Rewrite freely. "Where we are right now."

## Snapshot — 2026-06-30 (multiplayer rebuild COMPLETE, end-to-end verified)

**State:** Green — `npm run typecheck`, `npm test` (22/22), `npm run lint`, `npm run build` all pass.
Full multiplayer game plays end-to-end (verified over HTTP against a running server, 26/26 checks). The
old single-player path has been fully removed (clean cutover). **Committed** this session.

**What the game is now:** host creates a room → friends join by code → host starts → each human is
randomly assigned a character (rest are AI NPCs, killer may be human or NPC) → READING role reveal →
discussion (group chat where humans speak as their character + AI NPCs reply; plus private chat to
NPCs) → investigation (per-player, clues sanitized) → more discussion/investigation → voting (majority)
→ reveal (truth, killer, tally, who-played-whom). Default LLM Google `gemini-2.5-flash`. Deploy via
Docker Compose + SQLite volume.

**Done across this session (Phases A–F):**
- Harness (`CLAUDE.md` + `docs/agent/*`), archived review (`reviews/2026-06-30-full-review.md`).
- Gemini 2.5 default (env-configurable) · Docker Compose + SQLite · `next.config` external.
- A: types (Room/Player/projections), `registry.ts` (validated), `store/rooms.ts` (SQLite, atomic),
  `projection.ts` (isolation), `room-engine.ts` (assign/advance).
- B: room lifecycle routes (create/resolve/join/state/start/advance).
- C: `realtime/room-bus.ts` + `sse.ts` + `/events` SSE; client uses EventSource.
- D: gameplay routes — group-chat (humans + NPC LLM), private-chat (human→NPC), investigate
  (per-player, significance stripped), vote (majority).
- E: client rebuilt — `app/page.tsx` (create/join), `app/room/[code]`, `RoomClient` + `RoomPanels`.
- F: cutover — deleted `/api/game/*`, `/game`, old `GameClient`/chat/vote/reveal components,
  `game-sessions.ts`, `game-store.ts`, `gm-agent.ts`, `group-chat-manager.ts`, `clue-manager.ts`,
  `loader.ts`. Rewrote `ARCHITECTURE.md`; updated `KNOWN-ISSUES.md` status matrix.
- Tests: `tests/info-isolation.test.ts` (store + projection + bus). Gameplay verified via HTTP e2e.

**Not yet done / recommended next (see KNOWN-ISSUES "still open" + design doc "deferred"):**
- **Real LLM smoke test**: needs a `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local` — I verified the
  model id + fallback path but couldn't call the live API. First real-play task: add a key, create a
  room solo, confirm NPCs respond in-character.
- **KI-023 rate limiting / abuse protection** before exposing publicly.
- Carry-forward polish: KI-009/010/011/015/016/027/030/031/032; NPC voting; human↔human DM;
  reconnect via signed cookie; prompt caching.

## Handoff notes
- As-built truth = `ARCHITECTURE.md` (now describes the room system). `AGENTS.md`/`PROJECT-BRIEF.md`
  are the original single-player *vision* — banner added.
- Identity = server-minted `playerId` in localStorage (`lib/room/identity.ts`); possession == seat.
- Review workflow run id: `wf_0d0409a1-7a9`.
