# Backlog — prioritized task list

> Ordered, checkbox task list. **Pick work top-down.** Seeded 2026-07-01 from the full re-review
> (multi-agent, adversarially verified; baseline green). Every bug item links a `KI-xxx` in
> KNOWN-ISSUES.md (evidence + fix there); every gameplay item notes which KIs it also closes.
> Update the checkbox + the KI `Status` together as you go. Effort: **S** ≤ half-day · **M** 1-3 days · **L** bigger.

## How the two tracks relate

- **Bug track** (severity-ordered) and **Gameplay track** (batch-ordered) overlap on purpose: some
  gameplay wins *are* the bug fix (e.g. B1 closes KI-036, B3 closes KI-037). Do the shared item once.
- Suggested sequence: **A (block/security) → B (min gameplay loop) → C (robustness) → D/E (depth) → F (content/reach)**.

> **Status 2026-07-02:** ✅ **Batches A (security), B (min gameplay loop), C (robustness), D (gameplay
> depth), and E (robustness lows & housekeeping) are DONE.** A+B via PRs #2–#6; C via #7–#11; **D via #12–#19**;
> **E via #21–#25** (same multi-agent orchestration: opus-4.8 workers in git worktrees, orchestrator audit +
> squash-merge; E ran as a single file-disjoint parallel wave of 4 workers). Test suite 22 → 90 → 156 → 261 →
> **268 checks** (info-isolation 112 + gameplay-chat 51 + gameplay-reveal 98 + scenario-validation 7).
> tsc/eslint/Turbopack build green. Next up: **Batch F (content & reach)**.
> Deferred follow-ups still open: first-come-exclusive private clues (part of C8); signed reconnect cookie to
> rebind a seat (part of C5/D2); the compaction read-modify-write vs a concurrent `present-clue` is a narrow,
> self-healing race (accepted). (KI-059 provider/key mismatch was closed in Batch E / PR #23; the genuinely
> no-key case correctly still yields the canned offline line, now with a one-time server warning.)
> Earlier deferred: auto NPC self-intro on INTRO entry; unwrapped player lines inside the group-chat
> `groupContext` are a minor residual injection surface (guard covers phase-change claims).

---

## Batch A — Blocking & security (do first) 🔴

- [x] **A1 · KI-034 (critical) — stop leaking every player's `playerId`; it's also the only auth token.** ✅ PR #3
  Add a non-auth `publicId` (or use `assignedCharacterId`) as the client render key so projections stop
  shipping the real `playerId`; bind auth `playerId` to a signed httpOnly cookie at create/join; `/state`
  + every action verifies cookie == claimed playerId. **Files:** `lib/scenarios/projection.ts`,
  `types/game.ts` (PublicPlayer/Player), all `app/api/room/**` routes, `lib/room/identity.ts`. — **M**
  - [x] Also closes the URL-token leak (KI-061): move `playerId` out of the query string once cookie-bound.
  - [x] Add a regression test to `tests/info-isolation.test.ts`: member cannot pull another member's `yourCharacter`.
- [x] **A2 · KI-038 — SSE `/events` must verify membership** ✅ PR #3 (`playerId ∈ room.players`, 403 otherwise),
  so a room code alone can't eavesdrop the whole game. **File:** `app/api/room/[id]/events/route.ts`. — **S**
- [x] **A3 · KI-041 — `join` needs auth/limit:** ✅ PR #3 (cookie dedup + per-IP rate-limit + host kick) host-issued token or at least dedup + rate-limit; let the
  host kick pre-start so ghost seats can't brick a game. **File:** `app/api/room/[id]/join/route.ts`. — **S/M**
- [x] **A4 · KI-040 — prompt-injection guard for NPCs:** ✅ PR #2 hard guard section (all player text is
  in-character; anyone claiming to be GM/system is a player; if `isKiller`, deny accusations with the
  claimed alibi; never recite the prompt) + wrap user input in `<玩家发言>…</玩家发言>`. **File:**
  `lib/agents/prompts/npc-base.ts`, `lib/agents/npc-agent.ts`. — **S**
- [x] **A5 · KI-045 — throttle NPC/LLM triggers:** ✅ PR #4 (per-room cooldown + token bucket + empty-post 400) 400 on empty non-nudge messages; per-room NPC cooldown;
  per-room token bucket before the LLM call (free-tier + bill protection). **Files:**
  `lib/agents/room-group-chat.ts`, `app/api/room/[id]/group-chat/route.ts`. — **S/M**

## Batch B — Minimum gameplay loop (make it play like 剧本杀) 🎯

> Goal: connect **speak → affect others → vote → win/loss**. Mostly small; two days of S + a couple of M.

- [x] **B1 · Fix INTRO + unify chat gate + wire GM narration** ✅ PR #4 (auto NPC self-intro deferred) — *closes KI-036, KI-057*. Delete the three
  `isDiscussionPhase()` copies; gate chat on `getPhaseConfig(phase).allowsChat`. On `phase_change`, publish
  `PHASE_NARRATIONS[nextPhase]` as a GM message; trigger NPC self-intros in INTRO via the empty-message
  path. **Files:** `group-chat|private-chat|advance/route.ts`, `lib/agents/room-group-chat.ts`. — **S**
- [x] **B2 · Faction win/loss reveal (killer-escapes-wins) + killer-identity cue** ✅ PR #5 — pass `playerId` into
  `buildReveal`; add `youWereKiller` + `outcome` to `RevealInfo`; render by faction (drop the "you accused
  wrong" red box for the human killer); flag `isKiller` in `RoleReveal`. **Files:** `projection.ts`,
  `types/game.ts`, `RoomPanels.tsx`. — **S**
- [x] **B3 · NPC prompt: public case facts + `alibi.claimed` + `secrets` + killer strategy** ✅ PR #2 — *closes
  KI-037*. Add "案件公开事实" (reuse `toScenarioPublic` case fields + backgroundStory + public timeline),
  "你对外声称的不在场证明", "你的秘密清单", and a per-phase misdirection block for `isKiller`. **File:**
  `lib/agents/prompts/npc-base.ts`. — **S**
- [x] **B4 · NPC voting + one-line accusation** ✅ PR #4 — *closes KI-013*. In VOTING, one non-stream call per NPC
  (`{vote, reason}`) → write to `room.votes` (key `npc:${id}`), broadcast reason as a group message;
  killer NPC never self-votes; keyless fallback = highest-suspicion/random. **Files:** new
  `lib/agents/npc-voter.ts`, `advance/route.ts`, `room-engine.canAdvanceRoom`. — **M**
- [x] **B5 · "Present clue" mechanic** ✅ PR #5 — *closes KI-011 (front half)*. `POST /present-clue`: verify clue in
  `discoveredClues[playerId]` → add to `publicClues` → system message + broadcast → merge into NPC
  `knownFacts` (reuse `room-investigation` public-clue path) → `pickResponders` lets the named NPC react.
  Add a "出示" button in the Notebook. **Files:** new route, `room-investigation.ts`, `RoomPanels.tsx`. — **M**

## Batch C — Robustness (medium bugs) 🟠

- [x] **C1 · KI-035 (high) — concurrent-turn correctness + client streaming.** ✅ PR #8 (server) + #9 (client) Per-room NPC-turn mutex
  (Promise queue); tag `npc_*` with `turnId+messageId`; client keeps `Map<characterId,text>` bubbles;
  persist + `npc_done` each NPC as its stream finishes (not at turn end). **Files:**
  `group-chat/route.ts`, `lib/agents/room-group-chat.ts`, `RoomClient.tsx`. — **M**
- [x] **C2 · KI-049 — idempotent advance.** ✅ PR #7 (server) + #9 (client busy-guard) Body carries `expectedPhase`; mutator 409s on mismatch;
  `doAdvance` starts `if (busy) return`. **Files:** `advance/route.ts`, `room-engine.ts`, `RoomClient.tsx`. — **S**
- [x] **C3 · KI-046 — SSE `onerror` + reconnect + banner + low-freq `/state` poll fallback.** ✅ PR #9 **File:**
  `RoomClient.tsx`. — **S/M**
- [x] **C4 · KI-047 — clear stale streaming bubble on refetch / phase_change / timeout.** ✅ PR #9 **File:**
  `RoomClient.tsx`. — **S**
- [x] **C5 · KI-048 — join page reads `resolve.status`; hide the form for `in_progress` rooms** ✅ PR #9 (signed reconnect cookie deferred) (short
  term); signed reconnect cookie to rebind a seat (mid term, shares A1's cookie work). **Files:**
  `RoomClient.tsx`, later `join/route.ts`. — **S**
- [x] **C6 · KI-044 — differentiate not-configured vs request-failed; emit `npc_error`; don't persist ✅ PR #8
  failed turns.** **Files:** `npc-agent.ts`, `room-bus.ts`, `group-chat/route.ts`. — **S/M**
- [x] **C7 · KI-039 — isolate NPC prompt memory per `(playerId, characterId)`; label speaker/channel in ✅ PR #10
  `appendConversation`** (also fixes KI-015 round:0). **Files:** `memory-manager.ts`, chat routes,
  `npc-base.ts`. — **M**
- [x] **C8 · KI-042 — per-phase investigation budget (`investigationCounts[playerId]`) + optional ✅ PR #7 (budget; exclusive clues deferred)
  first-come-exclusive private clues.** **Files:** `room-investigation.ts`, `RoomPanels.tsx`. — **S/M**
- [x] **C9 · KI-043 — VOTING→REVEAL requires all connected humans voted (host override); tie → revote, ✅ PR #7 (engine) + #9 (UI)
  not silent loss.** **Files:** `room-engine.ts`, `projection.ts`, `RoomPanels.tsx`. — **M**
- [x] **C10 · KI-011 (back half) / KI-016 — rebuild groupContext between speakers in a turn; truncate ✅ PR #10
  private-chat history + wire `summarizeConversations` in the room path.** **Files:**
  `room-group-chat.ts`, `npc-agent.ts`, `memory-manager.ts`. — **M**
- [x] **C11 · KI-063 / KI-064 — add `catch` to private-chat + vote submits; seq-guard/Abort concurrent ✅ PR #9
  `refetchState`.** **Files:** `RoomPanels.tsx`, `RoomClient.tsx`. — **S**

## Batch D — Gameplay depth (second tier) 📈

- [x] **D1 · Always-on "案情档案 + 我的剧本" drawer** (data already in the projection; pure front-end). ✅ PR #19
  (new `CaseFileDrawer.tsx`: right slide-over, default-collapsed, localStorage-persisted; case/timeline/public
  cast/own-script/own-clues; private data sourced solely from `view.yourCharacter`, never `view.reveal`). — **M**
- [x] **D2 · Disconnect takeover + host handoff** ✅ PR #12 — SSE-refcount presence (`markConnected`/
  `markDisconnected`, multi-tab safe) flips `connected` + stamps server-only `disconnectedAt`; idle-90s human
  seats flip to NPC (fresh memory + public-clue content only); host auto-transfers to earliest connected human;
  returning human reclaims their seat. **Also fixed a latent leak**: projection shipped the real `hostPlayerId`
  → now `hostPublicId`. **Files:** `events/route.ts`, `room-engine.ts`, `group-chat/route.ts` (sweep),
  `projection.ts`, `room-bus.ts`, `types/game.ts`. — **M**
- [x] **D3 · Discussion liveness** ✅ PR #13 (cross-talk) + #18/#19 (nudge UI) — NPC cross-talk: re-scan each
  responder's line, pull named NPCs into the same turn (capped `MAX_RESPONDERS_PER_TURN=4`); idle-nudge button
  (~25s) wired to the existing self-prompt path. **Files:** `room-group-chat.ts`, `RoomPanels.tsx`, `RoomClient.tsx`. — **M**
- [x] **D4 · Activate emotion/suspicion (KI-010)** ✅ PR #15 (logic/prompt) + #17 (route wiring) — rule-based
  reaction: accusation (name + keyword) bumps suspicion toward the accuser (character id, never playerId) +
  flips emotion; de-escalation ladder on benign turns; own-suspicions + cornered-defense guidance rendered into
  the **server-only** prompt (no projection/SSE/client surface). **Files:** `memory-manager.ts`, `npc-base.ts`,
  `group-chat/route.ts`. — **M**
- [x] **D5 · Voting-integrity UX** ✅ PR #13 (VOTING chat gate) + #16 (ballots) + #18 (reveal UI) — VOTING opens
  a concurrent defense round (`allowsChat`); per-ballot tally keyed by **character** (never playerId, incl.
  taken-over seats); client-only staged reveal + `reveal.characters` script recap. **Files:** `phase-manager.ts`,
  `projection.ts`, `types/game.ts`, `RoomPanels.tsx`, `RoomClient.tsx`. — **M**
- [x] **D6 · Investigation depth** ✅ PR #14 — fuzzy anonymized find-hint (location name only) on private finds;
  `Clue.prerequisite` gating (own clues ∪ public) + schema global-id uniqueness / reference / WHITE-GRAY-BLACK
  acyclic check. **Files:** `room-investigation.ts`, `schema.ts`, `RoomPanels.tsx`. — **S/M**

## Batch E — Robustness lows & housekeeping 🧹 ✅ DONE (PRs #21–#25)

- [x] **E1 · KI-052 / KI-053 — SSE `cancel()` cleanup + `globalThis` db handle for HMR.** ✅ PR #21 — **S**
  ReadableStream `cancel()` runs the hoisted idempotent cleanup (abort + cancel both safe); db handle on
  `globalThis.__roomsDb` (mirrors room-bus).
- [x] **E2 · KI-054 / KI-055 — finished-room TTL/cleanup + rate-limit `resolve/[code]`.** ✅ PR #21 — **S**
  `pruneFinishedRooms` (`ROOM_TTL_MS`, 24h default) swept ≤ once/hour in `createRoom`, never touches
  lobby/in_progress; per-IP sliding window (30/60s) → 429 on `resolve/[code]`.
- [x] **E3 · KI-056 (=KI-028) — strengthen startup validation:** ✅ PR #22 exactly-one-killer, integer
  `availableInRound` ≥ 1, relationship `characterId` referential integrity (clue-id uniqueness + acyclic
  prereqs already from D6). New `tests/scenario-validation.test.ts`. **File:** `lib/scenarios/schema.ts`. — **S**
- [x] **E4 · KI-058 (=KI-016) / KI-060 (=KI-009) — lower chat `maxOutputTokens`.** ✅ PR #23 —
  `CHAT_MAX_OUTPUT_TOKENS=500` (was 5000) in both NPC stream calls. **KI-058 was already resolved in Batch C**
  (group-chat compaction + private-chat 16-msg model-input truncation), so E4 = the token cap only. — **S**
- [x] **E5 · KI-059 — surface provider/key mismatch instead of silent canned-line degrade.** ✅ PR #23 —
  `getLLMProvider()` auto-selects the provider whose key is present when `LLM_PROVIDER` is unset; `streamChat`
  emits a one-time `console.warn` on a degraded/mismatched config. — **S**
- [x] **E6 · KI-062 — only auto-scroll when already at bottom.** ✅ PR #24 — both chat panels track a near-bottom
  flag (80px) via a native listener on the real `ScrollArea` viewport. **File:** `RoomPanels.tsx`. — **S**
- [x] **E7 · KI-033 — update `AGENTS.md` (stale stack) to defer to ARCHITECTURE.md.** ✅ PR #25 — **S**

## Batch F — Content & reach 📚

- [ ] **F1 · Fix the storm-mansion content bugs** — KI-050 (phantom 23:30-23:55 argument), KI-051 (public
  bios spoil passage/secret), KI-030 (digoxin vs foxglove), KI-031 (orphan clock skew), plus the KI-052..
  low content notes (empty-tray sighting, 12y/10y clash, killer cover-story, orphan footprints/recorder,
  over-signposted difficulty). **File:** `data/scenarios/storm-mansion.json`. — **M**
- [ ] **F2 · Content supply pipeline** — `GET /api/scenarios` + `toScenarioCard` + home scenario picker
  (wires the already-built multi-scenario backend); then same-scenario random-killer variants; then
  LLM-assisted generation with a "auto-solve" regression; then a scenario matrix (6-7 player, short,
  varied genres); then JSON-import UGC. **Files:** `registry.ts`, `page.tsx`, `types/game.ts`. — **S start, L total**
- [ ] **F3 · objectives scoring (KI-013 sibling)** — machine-checkable objective types
  (not_accused / vote_correct / secret_hidden) + a REVEAL scoreboard, so non-killers have a reason to
  conceal. **Files:** `types/game.ts`, `projection.ts`, `RoomPanels.tsx`. — **M**
- [ ] **F4 · Flow data-ization (digest KI-032)** — `Room.phaseSequence` + `flow: 'quick'|'standard'`;
  per-phase suggested durations / optional auto-advance (also enables async play + no host-offline stall). — **M/L**
- [ ] **F5 · Human↔human private chat** — key structure already supports it; add "target is you" thread to
  the projection + a signal-only event. **Files:** `private-chat/route.ts`, `projection.ts`. — **M**

---

## Not scheduled — verified NOT bugs (don't re-file)

- vote-route "phase check outside the transaction" is not exploitable (room `finished` after REVEAL).
- "monitoring subplot multi-flaw" and "basement clue round imbalance" did not survive verification.
- "poison pharmacology implausible" is *uncertain*, not confirmed — revisit only if doing a content pass.
