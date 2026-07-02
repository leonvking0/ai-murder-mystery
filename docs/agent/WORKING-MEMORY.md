# Working memory (short-term)

> Scratch state for the *current* phase of work. Rewrite freely. "Where we are right now."

## Snapshot — 2026-07-01 (evening) — Backlog Batch A + B IMPLEMENTED & MERGED

**State:** Green. `npm test` now runs 3 files = **90 checks, all pass** (info-isolation 45 + gameplay-chat 19
+ gameplay-reveal 26). tsc/lint clean; authoritative Turbopack `npm run build` verified on every merge.

**What landed (5 PRs merged to `main` this session, multi-agent orchestration — opus-4.8 workers in git
worktrees, Fable orchestrated + audited every diff for the isolation invariant + merged):**
- **PR #2** — KI-037 (NPC prompt gets public case facts + own `alibi.claimed`) + KI-040 (prompt-injection
  guard section + `<玩家发言>` delimiters on all player text).
- **PR #3** — KI-034 (critical): signed httpOnly per-room seat cookie `mm_auth_<roomId>` (HMAC via
  `node:crypto`, secret `ROOM_AUTH_SECRET` + dev fallback) is now the SOLE auth; projections ship only
  `publicId`+`isSelf`, never real `playerId`. Also KI-038 (SSE membership), KI-041 (join dedup+rate-limit+
  host kick), KI-061 (no more `?playerId=`). New `lib/room/auth.ts`. ADR in DECISIONS.md.
- **PR #4** — KI-036/057 (unified chat gate on `allowsChat` → INTRO works; GM narration broadcast on every
  phase change), KI-045 (per-room NPC cooldown+token-bucket, empty-post 400), KI-013 (NPC voting via new
  `lib/agents/npc-voter.ts`, keyed `npc:<id>`, killer never self-votes, rule-based no-LLM fallback).
- **PR #5** — B2 faction win/loss reveal (killer-escapes-wins; `youWereKiller`+`outcome` on `RevealInfo`),
  B5 present-clue (`presentClue` engine + `POST /present-clue`; presented clue projected via `toClueView`
  so `significance` never leaks).

**⚠️ Prod note:** set `ROOM_AUTH_SECRET` (long random) or seat tokens are forgeable via the dev fallback.

**Recovery note:** the first reveal agent (`G-REVEAL`) stalled with zero output; re-dispatched as
`G-REVEAL2` on a fresh worktree — clean.

**Deferred follow-ups (small):** auto NPC self-intro on INTRO entry (players/nudge drive it now); the
group-chat `groupContext` embeds prior player lines un-delimited — minor residual injection surface (the
guard covers fake phase-change claims). Add these to Batch C/D thinking.

**Next up:** Batch C (robustness) — KI-035 concurrent-turn/streaming, KI-049 idempotent advance,
KI-046 SSE reconnect, KI-043 voting-integrity (all-voted gate + tie revote), etc. See BACKLOG.md.

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

## 2026-07-01 — full re-review of the room system (multi-agent, adversarially verified)

Baseline green (typecheck/lint/test/build). 49 confirmed findings filed as **KI-034..KI-065** in
KNOWN-ISSUES.md (1 critical, 3 high, ~13 medium, ~15 low, incl. 8 content bugs). Nothing changed in
code — this was read-only review + doc registration.

**Top of the fix list (start here):**
1. **KI-034 (critical, security):** projection ships every player's `playerId`; it's also the only auth
   token → any member reads others' secret scripts + `isKiller` via `GET /state?playerId=<other>`.
   Needs a non-auth publicId for the client + signed httpOnly cookie for auth. This re-opens the
   information-isolation guarantee that KI-001 was thought to close.
2. **KI-036 (high):** INTRO phase is dead (3 `isDiscussionPhase` copies vs `allowsChat`) — unify the gate.
3. **KI-035 (high):** concurrent group-chat + single-slot client streaming garbles bubbles / drops replies.
4. **KI-037 (high):** NPC prompt is missing the public case facts + own `alibi.claimed`.

**Gameplay:** engine stores lots of authored material (alibi.claimed, secrets, objectives, emotion/
suspicion, NPC votes, GM narration) that's dead at the mechanics layer → discussion doesn't affect the
ending, evidence doesn't affect NPCs, the ending has no win/loss. Priority-1 (all small, ~2 days):
fix INTRO + unify chat gate + wire GM narration; faction win/loss reveal (killer-escapes-wins + reveal
`playerId` to `buildReveal`); NPC prompt public facts/secrets/killer-strategy; NPC voting; "present clue"
endpoint. Second tier: always-on case+script drawer, disconnect takeover + host handoff, discussion
liveness (in-turn context refresh + idle nudge + NPC cross-talk), activate emotion/suspicion (KI-010),
voting-integrity pack (all-voted gate + VOTING debate + tie revote + ballot reveal), investigation depth
pack (search budget + fuzzy private-find broadcast + prerequisite chains + KI-030/031 content fixes).

Review workflow run id: `wf_38044857-41a` (78 agents). Prior rebuild review: `wf_0d0409a1-7a9`.

## Handoff notes
- As-built truth = `ARCHITECTURE.md` (now describes the room system). `AGENTS.md`/`PROJECT-BRIEF.md`
  are the original single-player *vision* — banner added.
- Identity = server-minted `playerId` in localStorage (`lib/room/identity.ts`); possession == seat.
  ⚠️ This is exactly what KI-034 exploits — the seat token is also broadcast to every member.
