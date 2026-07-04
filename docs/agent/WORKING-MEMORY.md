# Working memory (short-term)

> Scratch state for the *current* phase of work. Rewrite freely. "Where we are right now."

## Snapshot — 2026-07-04 (latest) — Batch F finished (all tractable): F4-c/d + F2 solvability + UGC import MERGED

**State:** Green on `main` @ `b2475cc`. `npm test` = **365 checks** (info-isolation 128 + gameplay-chat 56 +
gameplay-reveal 98 + scenario-validation 7 + flow 49 + gameplay-investigation 7 + solvability 20), tsc/eslint clean,
Turbopack build ✓ Compiled. Worktrees cleaned; no in-flight work.

**What landed this session (4 PRs, opus workers in worktrees, orchestrator audited every diff + ran the authoritative
build on main + squash-merged; F4-c ‖ solvability ran in parallel, F4-d then UGC sequential — page.tsx/types overlap):**
- **PR #36 (F4-c)** — scenario-driven GM narration: `Scenario.narrations` (keyed by GamePhase) + `narrationForPhase`;
  `PHASE_NARRATIONS` rewritten scenario-NEUTRAL, storm flavor moved verbatim into `storm-mansion.json` (GM text
  byte-identical). `Scenario.phaseDurations` → public projection → `PhaseIndicator` "建议时长" chip. Closes KI-032/057.
- **PR #37 (F2 solvability)** — `lib/scenarios/solvability.ts` (pure, LLM-free): `analyzeSolvability`/`analyzeAllFlows`
  prove a scenario is *winnable* per flow (clue reachability, prereq round-monotonicity, killer well-defined, dangling
  refs). Real storm-mansion solvable under standard+quick, 0 issues. The safety gate for generated/UGC content.
- **PR #38 (F4-d)** — opt-in deadline-based auto-advance: `Room.autoAdvance` + persisted `Room.phaseDeadline`
  (`phaseDeadlineFor`); client countdown → POSTs `advance {auto:true}` past deadline; server re-validates
  `autoAdvance && now>=deadline` with force semantics. No server timers (restart-tolerant). Manual path unchanged.
- **PR #39 (F2 UGC import)** — host imports custom scenario JSON at room creation: 256KB cap + `validateScenario` +
  `analyzeAllFlows` gate → stored server-only on `room.customScenario`, resolved everywhere via `getRoomScenario`,
  projected with IDENTICAL per-player isolation (runtime-probed: no customScenario/truth/other-script/significance leak).

**Isolation audits (all passed):** F4-c narration server-side only (phaseDurations public); F4-d autoAdvance/phaseDeadline
public (countdown); UGC customScenario SERVER-ONLY — verified a custom-scenario room leaks no more than a built-in one.

**Batch F remaining = BLOCKED, not tractable this session:** LLM-assisted scenario generation (no live model key in env),
a hand-authored scenario matrix (creative content), random-killer variants (unsound without regeneration). All the
*engineering* scaffolding they'd use — multi-scenario registry, `resolveFlow`, the per-flow solvability gate, the UGC
import path — is in place. Also still open before public hosting: **KI-023** (rate-limit/auth breadth).

---

## Snapshot — 2026-07-03 (earlier) — F4 flow data-ization (a+b) MERGED

**State:** Green on `main` @ `43944da`. `npm test` = **327 checks** (info-isolation 123 + gameplay-chat 51 +
gameplay-reveal 98 + scenario-validation 7 + **flow 41** + **gameplay-investigation 7**), tsc/eslint clean,
Turbopack build ✓ Compiled. Worktrees cleaned; no in-flight work.

**What landed (2 PRs, opus workers in worktrees `wf4a`/`wf4b`, orchestrator audited every diff for behavior
equivalence + isolation, ran the authoritative build on main, squash-merged):**
- **PR #33 (F4-a, zero behavior change)** — `lib/game-engine/flow.ts` (`FLOWS`/`resolveFlow`); `Room.phaseSequence?`
  stamped at `createRoom`; `getNextPhase(current, sequence)` parametrized. KI-032: one `PHASE_ROUND` map +
  exported `roundForPhase`; deleted the duplicate in room-engine + the dead `canAdvance(session)`. `FLOWS.standard`
  == old `PHASE_SEQUENCE` byte-for-byte → all 279 pre-existing checks unchanged (+28 flow tests).
- **PR #34 (F4-b, quick preset)** — selectable `flow: 'standard'|'quick'` (home 节奏 picker → validated
  `/api/room` → createRoom). **Flow-aware investigation ceiling** (the crux): the last investigation phase in a
  flow exposes every clue round → quick (single INVESTIGATION_1) stays solvable; standard byte-identical. Projection
  ships public `phaseSequence` (game structure, NOT a secret — the ONLY new client field) so `PhaseIndicator`
  renders quick's 8 steps. +7 investigation checks proving standard-unchanged + quick-solvable, +13 flow checks.

**Isolation audit:** `phaseSequence` is the only new client-visible field and is public phase ordering; no secrets,
NPC prompts, `clue.significance`, reveal, or auth touched. `flowId` sanitized to `'quick'|'standard'` at the route.

**Next:** **F4-c** (per-phase durations + optional auto-advance timers + scenario-driven GM narration override —
own wave; auto-advance interacts with D2 seat takeover) OR **F2 advanced tail** (random-killer variants → LLM-gen
with auto-solve regression → scenario matrix → UGC import). KI-023 (rate-limit/auth breadth) still open before public hosting.

---

## Snapshot — 2026-07-03 (later) — Batch F continued: KI-066 security fix + F5 human private chat MERGED

**State:** Green on `main` @ `70d4091`. `npm test` = **279 checks** (info-isolation 112→**123**: +6 KI-066,
+5 F5; gameplay-chat 51 + gameplay-reveal 98 + scenario-validation 7), tsc/eslint clean, Turbopack build ✓.

**What landed (2 PRs #30–#31, implemented directly by the orchestrator — security-critical + isolation-dense,
so kept in one head rather than delegated):**
- **PR #30 (KI-066, critical security)** — found during F5 pre-flight: group-chat stored the human speaker's
  real `playerId` (the KI-034 seat credential) on the `ChatMessage`, and it reached every client via
  `groupChatHistory` (projected verbatim) + the `group_message` SSE broadcast (forgeable into a seat cookie
  when `ROOM_AUTH_SECRET` is weak/unset). Fix: `ChatMessage.authorPublicId` + `toPublicMessage` sanitizer
  (strip playerId → attach publicId) applied to groupChatHistory + private threads in the projection and to the
  one player-authored broadcast; stored message keeps playerId for server-only NPC labeling; client
  mine-detection → `authorPublicId === you.publicId`. +6 regressions.
- **PR #31 (F5, human↔human private chat)** — a human-controlled private-chat target no longer 400s: message
  stored in the sender's isolated thread + signal-only `room_state` event (no private content on the bus); the
  projection merges, per counterpart character, OUTGOING (`me:character`) with INCOMING
  (`otherPlayer:myCharacter`) threads into one time-sorted conversation; every message sanitized via KI-066.
  `PrivateChatPanel` lists all non-self characters (真人/AI tag), typing hint only for AI, mine via
  authorPublicId. +5 regressions (merge/order, sanitize, symmetric view, third-party non-leak).

**Isolation invariant (re-audited):** a player's projected private view contains ONLY `me:*` (theirs) and
`*:myCharacter` (addressed to them); a third party's thread never surfaces; no real playerId leaves the server
on ANY message (group or private) post-KI-066. Two new ADRs in DECISIONS (message sanitizer; merged private thread).

**Remaining in Batch F:** F4 (flow data-ization — `Room.phaseSequence` + `flow:'quick'|'standard'`, digests
KI-032/057; M/L, touches the phase engine — do as its own wave), F2 tail (random-killer → LLM-gen w/ auto-solve
regression → scenario matrix → UGC import).

---

## Snapshot — 2026-07-03 — Backlog Batch F (content & reach) PARTIAL: F1 + F2-picker + F3 MERGED

**State:** Green on `main` @ `e63b158`. `npm test` = **268 checks** (info-isolation 112 + gameplay-chat 51 +
gameplay-reveal 98 + scenario-validation 7 — F1/F2/F3 added no new test files), tsc clean, authoritative
Turbopack `npm run build` ✓ on the integrated main.

**What landed (3 PRs #26–#28, multi-agent orchestration — opus-4.8 workers in git worktrees, orchestrator
audited every diff for the isolation invariant + content coherence + squash-merged; F1‖F2 parallel wave, F3 after
F2's `types/game.ts` merged):**
- **PR #27 (FA · F1)** — content-coherence pass on `data/scenarios/storm-mansion.json` ONLY. KI-050 phantom
  argument reconciled by moving the killer's confrontation earlier (new 23:00 clock-skew event, poison 23:15,
  study 23:30–23:55, leave ~00:00) so 陈志远/林雨晴/赵小雅's testimonies fall in a real window (李教授 still
  leaves 23:20); KI-031 clock skew now owned by 王大明 (timeline + script + clue significance); KI-030 领用本 now
  foxglove/强心苷 consistent, signature reduced to a "DM" initial (no self-naming giveaway); KI-051 public bios
  no longer leak the maintenance passage / professor secret (private facts kept in privateScript); content-lows
  (empty-tray folded into the 23:50 sighting, 十二年→近十年, killer cover-story guidance, footprints re-tied to
  the 22:40 tryst, recorder clue explained). No id/killer/relationship/clue-id changes → scenario-validation green.
- **PR #26 (FB · F2 step 1)** — `GET /api/scenarios` (new `app/api/scenarios/route.ts`) → public `ScenarioCard[]`;
  `toScenarioCard`/`listScenarioCards` (built field-by-field — never spreads the scenario); home page fetches
  the catalog + renders a selectable picker feeding `scenarioId` into room creation (falls back to storm-mansion).
- **PR #28 (FC · F3)** — machine-checkable objectives scoreboard. `RevealInfo.scoreboard: ScoreCard[]` computed
  **generically** in `buildReveal` from the already-revealed tally/ballots (killer→`escape`+2; non-killers→
  `not_accused`/`secret_hidden`[0 votes]/`vote_correct` +1 each); staged "本局结算·积分" leaderboard in
  `RevealRoom` (new stage between ballots and recap, sorted by total, own row highlighted). No scenario-data edits.

**Isolation audited every merge:** F2 card = public metadata only (field-by-field, no characters/case.truth/
isKiller/secrets/clues); F3 scoreboard reads no private data and lives only inside `reveal` (attached only at
REVEAL); F1 fixed a public-leaks-private bug in the correct direction (secrets stay in privateScript). See two
new ADRs in DECISIONS (catalog projection; generic computed scoreboard).

**Remaining in Batch F (not started):** **F4** flow data-ization (`Room.phaseSequence` + `flow:'quick'|'standard'`
+ per-phase durations/auto-advance; digests KI-032/057; M/L, touches the phase engine core — do as its own wave);
**F5** human↔human private chat (add "target is you" thread to the projection + signal-only event; M);
**F2 tail** (random-killer variants → LLM-assisted generation w/ auto-solve regression → scenario matrix → UGC import; the "L total").

---

## Snapshot — 2026-07-02 — Backlog Batch E (robustness lows & housekeeping) IMPLEMENTED & MERGED

**State:** Green on `main` @ `f82fa1e`. `npm test` = **268 checks** (info-isolation 112 + gameplay-chat 51 +
gameplay-reveal 98 + **new** scenario-validation 7), tsc clean, eslint clean, authoritative Turbopack
`npm run build` ✓ Compiled successfully on the integrated main.

**What landed (5 PRs #21–#25, multi-agent orchestration — 4 opus-4.8 workers in git worktrees, all file-disjoint
so a single parallel wave, orchestrator audited every diff + squash-merged; E7 + docs folded into the wrap-up PR):**
- **PR #21 (EA · E1+E2)** — KI-052 SSE `ReadableStream.cancel()` now runs the same idempotent cleanup as
  `req.signal` abort (a consumer cancel that never fires abort no longer leaks the emitter listener + 25s
  heartbeat or leaves the player online); KI-053 db handle on `globalThis.__roomsDb` (mirrors room-bus) so dev
  HMR stops leaking better-sqlite3 connections; KI-054 throttled finished-room TTL sweep (`ROOM_TTL_MS`, 24h
  default, `pruneFinishedRooms`, ≤ once/hour in `createRoom`; never touches lobby/in_progress); KI-055 per-IP
  sliding-window limit (30/60s) → 429 on the public `resolve/[code]` so the code space can't be enumerated.
- **PR #22 (EB · E3)** — KI-056/028 stronger `validateScenario`: **exactly one killer** (0 or >1 both throw),
  `availableInRound` positive integer, relationship `characterId` referential integrity. New
  `tests/scenario-validation.test.ts` (6 checks over the real `storm-mansion.json`) wired into `npm test`.
- **PR #23 (EC · E4+E5)** — KI-060 `CHAT_MAX_OUTPUT_TOKENS=500` replaces the 5000 ceiling in both NPC stream
  calls; KI-059 `getLLMProvider()` auto-selects the provider whose key is present when `LLM_PROVIDER` is unset
  (fixes "only ANTHROPIC_API_KEY set → default google → all NPCs mute"), explicit `LLM_PROVIDER` still honored;
  `streamChat` emits a one-time `console.warn` on degraded/mismatched key config. **KI-058 was already resolved
  in Batch C** (group-chat compaction + private-chat 16-msg truncation), so E4 = the token cap only.
- **PR #24 (ED · E6)** — KI-062 both chat panels only auto-scroll when already near the bottom (80px), tracked
  via a native passive listener on the real Radix `ScrollArea` viewport (`data-slot="scroll-area-viewport"`,
  an ancestor — React `onScroll` doesn't bubble). Refs (not state) → no re-render churn; graceful-degrade.
- **PR #25 (docs · E7 + wrap-up)** — KI-033 AGENTS.md stale stack corrected to the as-built (Vercel AI SDK,
  SQLite better-sqlite3, multiplayer rooms, no GM agent) + defer-to-ARCHITECTURE banner; BACKLOG/KNOWN-ISSUES/
  DECISIONS/WORKING-MEMORY updated.

**Isolation audited every merge:** EA adds no new output/SSE fields (only publicId/characterId ever leave the
server); EC's provider changes are server-internal (no client surface); no-key → `isLLMConfigured()` still false
so the offline test fallback holds; ED is pure client scroll behavior. tsc/eslint/test/build all green.

**Deferred (unchanged, Batch F candidates):** D5 "argue-then-lock" ballot sub-state; D6 per-location
`lockedCount` UX; nudge-throttle client feedback. Housekeeping-adjacent: stale merged remote branches
(`origin/feat/*`, `origin/fix/*`, `origin/docs/*`) could be pruned — left for an explicit go-ahead (outward action).

**Next up:** Batch F (content & reach) — storm-mansion content bugs (F1), scenario supply pipeline + home picker
(F2), objectives scoring (F3), flow data-ization (F4), human↔human private chat (F5). See BACKLOG.md.

## Snapshot — 2026-07-02 — Backlog Batch D (gameplay depth) IMPLEMENTED & MERGED

**State:** Green on `main` @ `008f551`. `npm test` = **261 checks** (info-isolation 112 + gameplay-chat 51 +
gameplay-reveal 98), tsc/eslint clean, authoritative Turbopack `npm run build` ✓ on the integrated main.

**What landed (8 PRs #12–#19, multi-agent orchestration — opus-4.8 workers in git worktrees, orchestrator
audited every diff for the isolation invariant + squash-merged; three sequential waves, every file single-owned
per wave):**
- **Wave 1 (4 parallel, file-disjoint):**
  - **PR #12** — D2 presence/takeover/host-handoff + the batch scaffolding (types/room-bus/projection contract).
    SSE-refcount presence; idle-90s seat→NPC (public-clue content only, never significance/private clues); host
    auto-transfer; seat reclaim on reconnect. **Fixed a latent leak**: `hostPlayerId`→`hostPublicId`.
  - **PR #13** — D3 NPC cross-talk (capped in-turn pull-in queue) + D5(a) VOTING `allowsChat=true`.
  - **PR #14** — D6 fuzzy find-hint + `Clue.prerequisite` gating + acyclic schema validation.
  - **PR #15** — D4 emotion/suspicion logic (memory-manager helpers) + prompt rendering, **server-only**.
- **Wave 2 (2 parallel, rebased on Wave 1):**
  - **PR #16** — D5(b) per-ballot reveal tally, keyed by **character** (human playerId keys resolved-or-dropped;
    taken-over seats resolve via `assignedCharacterId` — a raw playerId can never enter a ballot).
  - **PR #17** — D4 route wiring: `applyGroupTurnReaction` in group-chat `case 'done'`, nudge-guarded, accuser =
    character id.
- **Wave 3 (sequenced — the `GroupChatPanel.onNudge` contract couples the two FE files):**
  - **PR #18** — RoomPanels: staged RevealRoom + per-ballot list + per-character recap; roster presence dots +
    `AI 接管` chip; new exported `Roster`; nudge button/idle-timer (optional `onNudge`); locked-clue note.
  - **PR #19** — RoomClient + new `CaseFileDrawer` (D1): drawer mount (gated `inProgress && !REVEAL`); `Roster`
    mount; presence/seat_takeover/host_change SSE handlers; `sendNudge`; VOTING defense-round chat grid.

**KI closed:** KI-010 (emotion/suspicion now updated + fed back). **Isolation audited every merge:** emotion/
suspicion stay in `characterMemories` (serialize-scan proves absent from projection); no real playerId in any
projection/SSE/ballot; `hostPlayerId` leak closed; drawer private data only from `view.yourCharacter`.

**Deferred (small):** D5 "argue-then-lock" ballot sub-state (current = concurrent chat+ballot, changeable until
host advances); D6 per-location `lockedCount` UX (Option A shipped = static note only); nudge throttle has no
client feedback when the server silently swallows a cooled-down nudge. All Batch E/F candidates.

**Next up:** Batch E (robustness lows & housekeeping) or Batch F (content & reach). See BACKLOG.md.

## Snapshot — 2026-07-02 — Backlog Batch C (robustness) IMPLEMENTED & MERGED

**State:** Green on `main` @ f9da7fc. `npm test` = **156 checks** (info-isolation 57 + gameplay-chat 37 +
gameplay-reveal 62), tsc/eslint clean, authoritative Turbopack `npm run build` verified on the integrated main.

**What landed (4 PRs, same multi-agent orchestration — opus-4.8 workers in git worktrees, Fable audited every
diff for the isolation invariant + squash-merged; two waves, disjoint file sets within each wave):**
- **Wave 1 (parallel):**
  - **PR #7** — ENGINE (C2/C8/C9): idempotent advance (`expectedPhase`→409 `stale_phase`); per-phase
    investigation budget (`INVESTIGATION_BUDGET=2`, `Room.investigationCounts`); voting integrity —
    all-connected-humans-voted gate (`canAdvanceRoom(room,{force})`) + host `force` + tie→one revote
    (`voteRevoteCount`). Shared pure `tallyVotes`/`connectedHumanVoteState`/`applyTieRevote` in
    `projection.ts` (NOT room-engine — strip-types loadability), reused by `buildReveal`.
  - **PR #8** — CHAT (C1/C4-server/C6): per-room turn mutex (`lib/realtime/room-lock.ts` `runExclusive`);
    `npc_*` events now carry `turnId`+`messageId`; per-NPC persist + `npc_done` as each stream finishes;
    new `npc_error` (`not_configured` vs `failed`), never persist failed/partial turns. Generator yields a
    tagged `NpcTurnEvent` union + lazy-imports npc-agent + has a `deps` test seam.
- **Wave 2 (parallel, off merged Wave-1 main):**
  - **PR #9** — FRONT (C1-client/C2-client/C3/C4-client/C5/C8/C9-UI/C11): streaming bubbles keyed by
    `messageId` (multi-NPC) + terminal/stale clearing; SSE `onopen`/`onerror` reconnect banner + 5s `/state`
    poll fallback; join-status gate; advance busy-guard + `expectedPhase` (409 silent, 400 `awaiting_votes`→
    host "强制推进" with `force===true` guard); investigation-budget + vote-progress/revote UI; `.catch` on
    private/vote + monotonic `refetchState` seq guard.
  - **PR #10** — MEMORY (C7/C10): **C7 isolation fix** — private-chat turns no longer write to shared
    `characterMemories` (they'd leak player A's private line into player B's NPC prompt); the isolated
    `privateChats[playerId:characterId]` thread is the sole private history. Speaker/channel/round labeling
    in `appendConversation`. C10: in-turn groupContext rebuild between speakers; private history capped to
    last 16 for the model; shared NPC memory compacted via `summarizeConversations` (offline-safe) past 20
    entries. Regression test (info-isolation 45→57) with a positive control + sentinel.

**Deferred follow-ups (small, noted in BACKLOG):** first-come-exclusive private clues (C8 optional part);
signed reconnect cookie to rebind a seat (C5/D2); private-chat not-configured still returns a canned line
(KI-059, Batch E); the compaction read-modify-write can, in theory, race a concurrent `present-clue`
knownFacts merge during a discussion phase — narrow window, only clobbers a re-derivable public clue fact,
self-healing (Batch E nit).

**Next up:** Batch D (gameplay depth — always-on case/script drawer, disconnect takeover + host handoff,
discussion liveness, activate emotion/suspicion, voting-integrity UX, investigation depth) or Batch E
(robustness lows & housekeeping). See BACKLOG.md.

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
