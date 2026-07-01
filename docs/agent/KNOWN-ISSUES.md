# Known issues register

> The live to-do list. Pick from here; update `Status` as you go (open → in-progress → fixed / wontfix).
> Severity: critical (breaks game/security/deploy) · high · medium · low · nit.
> Seeded 2026-06-30 from a multi-agent review (adversarially verified). IDs are stable; don't renumber.

## Resolution status after the 2026-06-30 multiplayer rebuild

The single-player path (`/api/game/*`, `game-sessions.ts`, old components) was **retired** and replaced
by the room system, which fixed most findings at the root. Detailed per-item status:

- **✅ Fixed / obsolete:** KI-001 (per-player projection; e2e-verified), KI-002 (SQLite store),
  KI-003 (dead GM code deleted), KI-004 (`assignedCharacterId` now real), KI-005 (single validated
  `registry.ts`; loader + old store deleted), KI-006 (`ClueView` strips significance), KI-007 & KI-024
  (atomic `updateRoom`), KI-008 (Gemini 2.5 + env models), KI-012 (old modal gone), KI-014
  (better-sqlite3 now used), KI-020 (shared SSE helper + EventSource), KI-021 (LOBBY used), KI-022
  (hardcoded killer removed), KI-025 (old streaming-persist gone), KI-029 (`maxDuration` set), KI-033
  (AGENTS.md banner).
- **🟡 Partial / improved:** KI-017 (tests added — store/projection/bus + gameplay e2e; more TODO),
  KI-018 (server-external set; security headers still TODO), KI-019/KI-028 (validation runs at startup
  via registry; standalone script + stronger checks still TODO), KI-026 (new client surfaces an error
  banner; can go deeper).
- **⬜ Still open (carried forward):** KI-009 (NPC maxOutputTokens still 5000), KI-010 (suspicion/emotion
  inert), KI-011 (player-found clues not injected into NPC memory), KI-013 (NPCs don't vote — by design
  for now), KI-015 (`round:0`), KI-016 (room path doesn't summarize long memories yet), KI-023
  (**no rate limit / auth beyond playerId possession — still important before public hosting**), KI-027
  (LLM failures swallowed; no SSE error surfaced), KI-030/KI-031 (content bugs), KI-032 (phase engine
  ignores `scenario.phases`).

New follow-ups worth filing: human↔human private chat, NPC voting, reconnect hardening (signed cookie),
prompt-caching for cost, per-phase min-participation gates. See `design/multiplayer-rooms.md` "deferred".

---

## Critical

### KI-001 · Client receives the full solution (information isolation broken at transport) · security · open
- **Where — 4 independent leak vectors, same root cause (server sends un-sanitized data):**
  1. `app/page.tsx:6` imports `storm-mansion.json` into the **static** client bundle (`/` builds as
     `○ Static`) — the answer is in the JS even before a game starts.
  2. `app/api/game/create/route.ts:23-28` returns the whole `scenario`.
  3. `app/api/game/[id]/state/route.ts:22-27` returns the whole `scenario` **and** the whole `session`
     — and `session.characterMemories[*].privateScript` / `suspicions` is a **second leak vector** even
     if you only sanitize the scenario.
  4. `app/api/game/[id]/investigate/route.ts:55` returns the entire `scenario.locations`, so one search
     hands the player **all clues from both rounds** (incl. the密室暗道 + the clues naming 王大明) —
     investigation is architecturally bypassable.
  - `RevealPanel.tsx:98` reads `scenario.case.truth` on the client; `DEFAULT_KILLER_ID='wang-daming'`
    is hardcoded client-side (`GameClient.tsx:33`, `RevealPanel.tsx:88`).
- **Impact:** A player (or anyone) can read `case.truth`, every `privateScript` / `alibi.truth` /
  `secrets`, `isKiller`, `clue.significance`, and the private timeline from DevTools or the bundle —
  the entire answer, no deduction. Defeats the game's #1 rule.
- **Fix:** Build a server-side `ScenarioPublic` projection (strip `case.truth`, `isKiller`,
  `privateScript`, `alibi.truth`, `secrets`, `relationships[].privateRelation`, non-public timeline,
  undiscovered clues, `clue.significance`). Send only that from create/state/investigate; sanitize
  `session.characterMemories` too. Deliver truth via a dedicated endpoint **only when**
  `currentPhase === 'REVEAL'`. Make `app/page.tsx` a server component that passes only
  `id/title/description/setting/difficulty/duration`. `isCorrect` is already computed server-side in the
  vote route, so the client never needs the killer id. **Do all of this together** — partial fixes
  leave a vector open.

### KI-002 · In-memory session store dies on serverless / restart · deploy · open
- **Where:** `lib/store/game-sessions.ts:11` (`const gameSessions = new Map(...)`).
- **Impact:** On Vercel (the stated target) each serverless invocation / instance has its own empty
  Map, so a valid `sessionId` returns 404 almost immediately; even on a single host, a restart wipes
  all games. `better-sqlite3` is a dependency but never used.
- **Fix:** Introduce a persistence layer (SQLite via better-sqlite3 for single-host, or
  Upstash/Redis/Postgres for serverless) behind the existing `getSession/updateSession/createSession`
  API so call sites don't change.

## High

### KI-003 · GM "agent" is dead code; no dynamic GM exists · design/maintainability · open
- **Where:** `lib/agents/gm-agent.ts` — `streamGMResponse`, `buildGMSystemPrompt` (embeds full truth),
  `shouldAdvancePhase`, `GM_SYSTEM_PROMPT_TEMPLATE` have no caller; there is no `/api/game/[id]/gm`
  route. Only `decideRespondingNPCs` + `generateNarration` are used.
- **Impact:** The brief's dynamic GM (pacing, clue release, anti-冷场, narration) doesn't run; phase
  text is the static `PHASE_NARRATIONS`. Dead code invites accidental misuse (e.g. exposing the
  full-truth GM prompt to the client).
- **Fix:** Decide: either (a) wire a real GM endpoint (server-only, truth never sent to client), or
  (b) delete the dead GM code and keep static narration. Record the choice in DECISIONS.md.

### KI-004 · `playerCharacterId` never set; play-as-character unimplemented · design · open
- **Where:** `app/api/game/create/route.ts:21` calls `createSession(scenarioId)` only;
  `lib/store/game-sessions.ts:27` `createSession` takes no `playerCharacterId`; the field exists on
  `GameSession` / `CreateGameRequest` in `types/game.ts` but is always undefined.
- **Impact:** Player is always the generic "detective" (`GameClient.tsx:365-369` fallback). The brief's
  "play as one of the characters" mode is absent; the type fields are misleading dead state.
- **Fix:** Either implement character selection (pass + store `playerCharacterId`, exclude that
  character from NPC chat, give the player their own private script) or drop the fields and document
  the detective model in DECISIONS.md.

### KI-005 · Two scenario systems; runtime path is unvalidated · maintainability · open
- **Where:** `lib/scenarios/loader.ts` + `lib/scenarios/schema.ts` (async, validated, cached) are
  **unused at runtime**; `lib/store/game-sessions.ts:3-9` imports the JSON statically with no validation.
- **Impact:** Scenarios are never validated when the app runs; adding a new scenario file has no effect
  until `game-sessions.ts` is edited. Confusing duplication.
- **Fix:** Route runtime scenario access through `loadScenarioById` (validate + support multiple files),
  or delete the loader/schema if the static single-scenario approach is intentional.

### KI-006 · Investigation reveals GM-only `significance` to the player · ux/design · open
- **Where:** `components/game/InvestigationPanel.tsx:124` renders `clue.significance` for each newly
  found clue.
- **Impact:** `significance` is the GM's interpretation ("锁定熟悉结构者", "下毒材料与管家直接关联", …) — it
  hands the player the deduction and spoils the mystery.
- **Fix:** Don't render `significance` in the player UI (show `content` only). If it's ever sent to the
  client it should also be stripped server-side (see KI-001).

## Medium

### KI-007 · Lost-update race on NPC memory during chat · bug/concurrency · open
- **Where:** `app/api/game/chat/route.ts:104-155` (and `chat-sync/route.ts:81-132`) build `nextMemory`
  from the `memory` captured at request start, then write it inside `updateSession`'s functional
  update instead of reading `current.characterMemories[targetCharacterId]`.
- **Impact:** Two near-concurrent messages to the same NPC → the second clobbers the first's memory
  update (lost turns). Unlikely in solo play but a real correctness gap.
- **Fix:** Inside the functional update, derive next memory from `current.characterMemories[id]`.

### KI-008 · Model ids are stale / wrong and drift from docs · bug · ✅ fixed (2026-06-30)
> Fixed: default = Google `gemini-2.5-flash` (verified free-tier id); Anthropic default `claude-sonnet-4-6`;
> both env-overridable (`GOOGLE_MODEL`/`ANTHROPIC_MODEL`/`LLM_PROVIDER`); `.env.local.example` reconciled.
- **Where:** `lib/agents/llm-provider.ts:8-9` (`claude-sonnet-4-5`, `gemini-3-flash-preview`); README
  says `claude-sonnet-4-5` / `gemini-2.0-flash`.
- **Impact:** `gemini-3-flash-preview` may not be a valid id (provider switch could 4xx); Claude id is
  behind the current generation. Docs and code disagree.
- **Fix:** Verify current ids via the `claude-api` skill; update to a current Claude model
  (e.g. the latest Sonnet) and a valid Gemini id; reconcile README. Consider env-overridable model ids.

### KI-009 · `maxOutputTokens: 5000` for 1–3 sentence replies · perf/cost · open
- **Where:** `lib/agents/npc-agent.ts:73,116`.
- **Impact:** Wasteful ceiling; the "prevent hallucination" rationale (commit `59ed493`) is incorrect.
- **Fix:** Lower to a sane bound (e.g. 300–600) for chat; keep summaries small.

### KI-010 · Suspicion/emotion modeled but never updated or used · design · open
- **Where:** `memory-manager.ts` `updateSuspicion` (unused); `CharacterMemory.suspicions` /
  `emotionalState` set once in `initializeMemory` and only read into the prompt.
- **Impact:** NPC psychology is static; the "怀疑度/情绪 drives behavior" design is inert.
- **Fix:** Update suspicion/emotion from conversation/clue events and feed deltas back, or remove the
  fields to reduce dead surface.

### KI-011 · NPCs can't react to player-found clues or to each other mid-turn · design · open
- **Where:** `group-chat-manager.ts:74-107` builds one `groupContext` snapshot before the turn; private
  clues the player finds never enter NPC memory.
- **Impact:** NPCs ignore the player's private evidence; in a multi-NPC turn, later speakers don't see
  earlier speakers' just-generated lines.
- **Fix:** Optionally let the player "present" a clue to inject it into NPC context; rebuild context
  between speakers within a turn.

### KI-012 · Phase-transition modal pops on every page load · ux · open
- **Where:** `components/game/GameClient.tsx:156` (`setTransitionOpen(true)` in the load effect).
- **Impact:** Refreshing mid-game re-shows the "entering phase X" GM modal, which is noise.
- **Fix:** Only open the modal on an actual phase change, not on initial hydrate.

### KI-013 · NPCs don't vote; only the player's single vote decides · design · open
- **Where:** `app/api/game/[id]/vote/route.ts` records `votes.player` only; `votes` is a
  `Record<characterId, votedForId>` but no NPC ever votes.
- **Impact:** Diverges from the brief's "most-voted = accused"; it's just player-correct-or-not. Fine
  as a simplification, but the data shape implies more.
- **Fix:** Either implement NPC voting (adds social-deduction depth) or simplify the type/UI to a single
  accusation.

## Low / nit

### KI-014 · `better-sqlite3` dependency is unused · maintainability · open
Remove it, or use it for KI-002. (`package.json`)

### KI-015 · `appendConversation` always stamps `round: 0` · bug(minor) · open
`memory-manager.ts:36` — round context is lost from conversation summaries.

### KI-016 · `summarizeConversations` can append summary facts repeatedly · perf(minor) · open
`chat/route.ts:116-123` re-triggers each time conversations re-cross 10, growing `knownFacts`.

### KI-017 · No tests, no `typecheck` script · maintainability · 🟡 in progress (2026-06-30)
> Done: `npm run typecheck` (`tsc --noEmit`) + `npm test` scripts; `tests/info-isolation.test.ts`
> covers the SQLite store + per-player projection (info-isolation regression). Still TODO: phase
> machine, `investigateLocation`, scenario validation, and the room lifecycle once Phase B lands.

### KI-018 · `next.config.ts` is empty · deploy/security · open
No security headers, no image config. Add headers (and image domains if portraits ever go remote).

### KI-019 · `scripts/validate-scenario.ts` is broken and unrunnable · maintainability · open
It `require()`s `../lib/scenarios/schema.ts` (a `.ts` path) at runtime and `schema.ts` uses TS
parameter properties — both crash under Node's type-stripping. There's also no runner script in
`package.json`. Add e.g. `"validate:scenario": "tsx scripts/validate-scenario.ts"` and fix the import.
Related: validation only runs in this (dead) script, never at app startup — see KI-005, KI-028.

### KI-020 · Duplicated SSE/iOS helper code · maintainability · open
`parseSSEEvent` / `extractSSEEvents` / `isIOSDevice` are copy-pasted in `ChatPanel.tsx` and
`GroupChat.tsx`. Extract to a shared module.

### KI-021 · `LOBBY` phase is unreachable · nit · open
Sessions start at `READING` (`game-sessions.ts:37`); `LOBBY` is in the sequence/config but never used.

### KI-022 · Hardcoded `DEFAULT_KILLER_ID = 'wang-daming'` fallback · maintainability · open
Couples generic code to one scenario in `vote/route.ts:14`, `GameClient.tsx:33`, `RevealPanel.tsx:88`.
The `isKiller` lookup already covers it; drop the hardcoded fallback. (Also a KI-001 leak vector.)

---

## Added by the 2026-06-30 multi-agent review (adversarially verified)

> Severities below are the verifiers' *corrected* values (many were calibrated down — e.g. the chat
> lost-update is "low" in solo play). Full evidence per item: `reviews/2026-06-30-full-review.md`.

### KI-023 · No auth, no rate limit, no message-length cap → LLM-cost DoS · security/high · open
- **Where:** every LLM route (`app/api/game/chat/route.ts:21`, `group-chat/route.ts`, sync variants).
  Only "auth" is possession of the session UUID (URL leak = full read/write). `chat/route.ts:33`
  accepts arbitrarily long messages, which are also replayed into `summarizeConversations`.
- **Impact:** An anonymous script can loop POSTs to run up an Anthropic/Google bill and exhaust
  function execution; giant prompts amplify token cost + memory.
- **Fix:** Rate-limit (Upstash/KV token bucket by IP + sessionId) ahead of every LLM call; bind the
  session to a signed httpOnly cookie issued at create; cap message length (~1–2k chars) → 400;
  consider Edge middleware for global limiting.

### KI-024 · `investigate` route overwrites the whole session from a stale snapshot · bug/medium · open
- **Where:** `app/api/game/[id]/investigate/route.ts:49` builds a new session from the request-start
  snapshot and writes it back wholesale (`updateSession(id, nextSession)` object form).
- **Impact:** Worse than the chat lost-update (KI-007): any concurrent change (a finishing chat stream,
  a group-chat append, a phase advance) is silently discarded. The store already supports the safe
  functional form.
- **Fix:** Use `updateSession(id, current => …)` and merge `discoveredClues` / system messages / public
  facts onto the latest `current`.

### KI-025 · A chat turn is persisted only if the whole stream succeeds · bug/low · open
- **Where:** `app/api/game/chat/route.ts:141` (persist after the full stream).
- **Impact:** A mid-stream disconnect drops the entire turn server-side, diverging from the client's
  optimistic UI (the player sees a reply the server never saved).
- **Fix:** Persist the player message up front; in `finally`, save whatever NPC text accumulated.

### KI-026 · Client disguises transport/backend errors as NPC dialogue · ux/low · open
- **Where:** `ChatPanel.tsx:207` turns a failed request (session gone, phase disabled, rate-limited)
  into an in-character line ("我现在不太方便回答…"); `GroupChat.tsx:249` has **no** error feedback at all
  and loses already-streamed text on error (`GroupChat.tsx:251` reads stale closure state).
- **Impact:** Real failures (incl. KI-002 / KI-023) are invisible — hard to debug, bad UX.
- **Fix:** Distinguish a visible error state from NPC content; add an error banner; accumulate streaming
  text in a ref so a catch can save the partial; cancel the SSE reader on error (also fixes a leak,
  `ChatPanel.tsx:172`).

### KI-027 · LLM failures are swallowed into one fallback line (no observability) · ux/low · open
- **Where:** `npc-agent.ts:88` catches everything and yields a single canned sentence; the same canned
  line is also the "not configured" path. A misconfigured deploy (bad key/model id) "looks like it's
  running" but every NPC is a stub.
- **Fix:** Differentiate "not configured" vs "request failed"; surface an SSE `error` event to the
  client; log the real error. Pairs with KI-008 (bad model id is exactly this failure).

### KI-028 · `validateScenario` is too weak to catch real scenario bugs · maintainability/low · open
- **Where:** `lib/scenarios/schema.ts` checks types/lengths but not: exactly-one/at-least-one killer
  consistency for play, **clue id uniqueness**, or referential integrity (relationship/timeline
  `characterId`s, clue→location). It's also dead at runtime (KI-005, KI-019).
- **Fix:** Strengthen the checks and actually run them at startup on the active scenario.

### KI-029 · Streaming routes have no `maxDuration` · deploy/low · open
- **Where:** `group-chat/route.ts` (and chat) drive up to ~5 sequential NPC LLM calls per turn with no
  `export const maxDuration`. On Vercel the default function timeout can kill a turn mid-flight,
  leaving a half-updated session.
- **Fix:** `export const maxDuration = 60;` (Node runtime) on the streaming routes; budget NPC count.

### KI-030 · Content bug: poison source is internally inconsistent · content/low · open
- **Where:** `data/scenarios/storm-mansion.json:414` — `kitchen-clue-02` says the取走的药 is
  地高辛/digoxin (a manufactured drug), but the canonical method everywhere else is a **hand-extracted
  foxglove (洋地黄) cardiac glycoside** (`case.truth:28`, timeline:617, `kitchen-clue-01`, garden clues).
- **Impact:** The single most damning clue contradicts the murder method; confuses the deduction.
- **Fix:** Make the领用本 clue reference foxglove extract / digitalis consistently, or reconcile the
  truth to a digoxin theft.

### KI-031 · Content bug: clock-skew clue is unsolvable (no owner) · content/low · open
- **Where:** `data/scenarios/storm-mansion.json:386` — `living-clue-03` asserts the主钟 was set back 12
  minutes by someone, but no character's timeline/script accounts for doing it.
- **Impact:** A red herring the player can never resolve into the answer.
- **Fix:** Attribute the clock change to a character (and reflect it in their timeline), or cut it.

### KI-032 · Phase engine ignores `scenario.phases` entirely · design/low · open
- **Where:** `phase-manager.ts:10-110` hardcodes `PHASE_SEQUENCE` / `PHASE_CONFIGS` / `PHASE_NARRATIONS`
  and `expectedRoundForPhase`; the scenario's `phases` (with `round`/`duration`/`gmScript`) are never
  read. The round→phase map is also duplicated in `advance/route.ts:14` (drift risk).
- **Fix:** Drive the flow from `scenario.phases` (data-driven), or delete the unused scenario `phases`
  + `duration` to stop implying configurability. De-duplicate the round mapping.

### KI-033 · `AGENTS.md` tech stack is stale and will mislead agents · maintainability/nit · open
- **Where:** `AGENTS.md:13-16` still says `@anthropic-ai/sdk` + SQLite/Drizzle; the code uses the Vercel
  AI SDK and an in-memory Map. An agent following AGENTS.md will write conflicting code.
- **Fix:** Update AGENTS.md to match reality (point to `docs/agent/ARCHITECTURE.md` as the as-built
  source) or add a banner that ARCHITECTURE.md wins on conflicts.
