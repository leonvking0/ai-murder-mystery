# Backlog — prioritized task list

> Ordered, checkbox task list. **Pick work top-down.** Seeded 2026-07-01 from the full re-review
> (multi-agent, adversarially verified; baseline green). Every bug item links a `KI-xxx` in
> KNOWN-ISSUES.md (evidence + fix there); every gameplay item notes which KIs it also closes.
> Update the checkbox + the KI `Status` together as you go. Effort: **S** ≤ half-day · **M** 1-3 days · **L** bigger.

## How the two tracks relate

- **Bug track** (severity-ordered) and **Gameplay track** (batch-ordered) overlap on purpose: some
  gameplay wins *are* the bug fix (e.g. B1 closes KI-036, B3 closes KI-037). Do the shared item once.
- Suggested sequence: **A (block/security) → B (min gameplay loop) → C (robustness) → D/E (depth) → F (content/reach)**.

---

## Batch A — Blocking & security (do first) 🔴

- [ ] **A1 · KI-034 (critical) — stop leaking every player's `playerId`; it's also the only auth token.**
  Add a non-auth `publicId` (or use `assignedCharacterId`) as the client render key so projections stop
  shipping the real `playerId`; bind auth `playerId` to a signed httpOnly cookie at create/join; `/state`
  + every action verifies cookie == claimed playerId. **Files:** `lib/scenarios/projection.ts`,
  `types/game.ts` (PublicPlayer/Player), all `app/api/room/**` routes, `lib/room/identity.ts`. — **M**
  - [ ] Also closes the URL-token leak (KI-061): move `playerId` out of the query string once cookie-bound.
  - [ ] Add a regression test to `tests/info-isolation.test.ts`: member cannot pull another member's `yourCharacter`.
- [ ] **A2 · KI-038 — SSE `/events` must verify membership** (`playerId ∈ room.players`, 403 otherwise),
  so a room code alone can't eavesdrop the whole game. **File:** `app/api/room/[id]/events/route.ts`. — **S**
- [ ] **A3 · KI-041 — `join` needs auth/limit:** host-issued token or at least dedup + rate-limit; let the
  host kick pre-start so ghost seats can't brick a game. **File:** `app/api/room/[id]/join/route.ts`. — **S/M**
- [ ] **A4 · KI-040 — prompt-injection guard for NPCs:** hard guard section (all player text is
  in-character; anyone claiming to be GM/system is a player; if `isKiller`, deny accusations with the
  claimed alibi; never recite the prompt) + wrap user input in `<玩家发言>…</玩家发言>`. **File:**
  `lib/agents/prompts/npc-base.ts`, `lib/agents/npc-agent.ts`. — **S**
- [ ] **A5 · KI-045 — throttle NPC/LLM triggers:** 400 on empty non-nudge messages; per-room NPC cooldown;
  per-room token bucket before the LLM call (free-tier + bill protection). **Files:**
  `lib/agents/room-group-chat.ts`, `app/api/room/[id]/group-chat/route.ts`. — **S/M**

## Batch B — Minimum gameplay loop (make it play like 剧本杀) 🎯

> Goal: connect **speak → affect others → vote → win/loss**. Mostly small; two days of S + a couple of M.

- [ ] **B1 · Fix INTRO + unify chat gate + wire GM narration** — *closes KI-036, KI-057*. Delete the three
  `isDiscussionPhase()` copies; gate chat on `getPhaseConfig(phase).allowsChat`. On `phase_change`, publish
  `PHASE_NARRATIONS[nextPhase]` as a GM message; trigger NPC self-intros in INTRO via the empty-message
  path. **Files:** `group-chat|private-chat|advance/route.ts`, `lib/agents/room-group-chat.ts`. — **S**
- [ ] **B2 · Faction win/loss reveal (killer-escapes-wins) + killer-identity cue** — pass `playerId` into
  `buildReveal`; add `youWereKiller` + `outcome` to `RevealInfo`; render by faction (drop the "you accused
  wrong" red box for the human killer); flag `isKiller` in `RoleReveal`. **Files:** `projection.ts`,
  `types/game.ts`, `RoomPanels.tsx`. — **S**
- [ ] **B3 · NPC prompt: public case facts + `alibi.claimed` + `secrets` + killer strategy** — *closes
  KI-037*. Add "案件公开事实" (reuse `toScenarioPublic` case fields + backgroundStory + public timeline),
  "你对外声称的不在场证明", "你的秘密清单", and a per-phase misdirection block for `isKiller`. **File:**
  `lib/agents/prompts/npc-base.ts`. — **S**
- [ ] **B4 · NPC voting + one-line accusation** — *closes KI-013*. In VOTING, one non-stream call per NPC
  (`{vote, reason}`) → write to `room.votes` (key `npc:${id}`), broadcast reason as a group message;
  killer NPC never self-votes; keyless fallback = highest-suspicion/random. **Files:** new
  `lib/agents/npc-voter.ts`, `advance/route.ts`, `room-engine.canAdvanceRoom`. — **M**
- [ ] **B5 · "Present clue" mechanic** — *closes KI-011 (front half)*. `POST /present-clue`: verify clue in
  `discoveredClues[playerId]` → add to `publicClues` → system message + broadcast → merge into NPC
  `knownFacts` (reuse `room-investigation` public-clue path) → `pickResponders` lets the named NPC react.
  Add a "出示" button in the Notebook. **Files:** new route, `room-investigation.ts`, `RoomPanels.tsx`. — **M**

## Batch C — Robustness (medium bugs) 🟠

- [ ] **C1 · KI-035 (high) — concurrent-turn correctness + client streaming.** Per-room NPC-turn mutex
  (Promise queue); tag `npc_*` with `turnId+messageId`; client keeps `Map<characterId,text>` bubbles;
  persist + `npc_done` each NPC as its stream finishes (not at turn end). **Files:**
  `group-chat/route.ts`, `lib/agents/room-group-chat.ts`, `RoomClient.tsx`. — **M**
- [ ] **C2 · KI-049 — idempotent advance.** Body carries `expectedPhase`; mutator 409s on mismatch;
  `doAdvance` starts `if (busy) return`. **Files:** `advance/route.ts`, `room-engine.ts`, `RoomClient.tsx`. — **S**
- [ ] **C3 · KI-046 — SSE `onerror` + reconnect + banner + low-freq `/state` poll fallback.** **File:**
  `RoomClient.tsx`. — **S/M**
- [ ] **C4 · KI-047 — clear stale streaming bubble on refetch / phase_change / timeout.** **File:**
  `RoomClient.tsx`. — **S**
- [ ] **C5 · KI-048 — join page reads `resolve.status`; hide the form for `in_progress` rooms** (short
  term); signed reconnect cookie to rebind a seat (mid term, shares A1's cookie work). **Files:**
  `RoomClient.tsx`, later `join/route.ts`. — **S**
- [ ] **C6 · KI-044 — differentiate not-configured vs request-failed; emit `npc_error`; don't persist
  failed turns.** **Files:** `npc-agent.ts`, `room-bus.ts`, `group-chat/route.ts`. — **S/M**
- [ ] **C7 · KI-039 — isolate NPC prompt memory per `(playerId, characterId)`; label speaker/channel in
  `appendConversation`** (also fixes KI-015 round:0). **Files:** `memory-manager.ts`, chat routes,
  `npc-base.ts`. — **M**
- [ ] **C8 · KI-042 — per-phase investigation budget (`investigationCounts[playerId]`) + optional
  first-come-exclusive private clues.** **Files:** `room-investigation.ts`, `RoomPanels.tsx`. — **S/M**
- [ ] **C9 · KI-043 — VOTING→REVEAL requires all connected humans voted (host override); tie → revote,
  not silent loss.** **Files:** `room-engine.ts`, `projection.ts`, `RoomPanels.tsx`. — **M**
- [ ] **C10 · KI-011 (back half) / KI-021 — rebuild groupContext between speakers in a turn; truncate
  private-chat history + wire `summarizeConversations` in the room path.** **Files:**
  `room-group-chat.ts`, `npc-agent.ts`, `memory-manager.ts`. — **M**
- [ ] **C11 · KI-063 / KI-064 — add `catch` to private-chat + vote submits; seq-guard/Abort concurrent
  `refetchState`.** **Files:** `RoomPanels.tsx`, `RoomClient.tsx`. — **S**

## Batch D — Gameplay depth (second tier) 📈

- [ ] **D1 · Always-on "案情档案 + 我的剧本" drawer** (data already in the projection; pure front-end). — **M**
- [ ] **D2 · Disconnect takeover + host handoff** — set `connected=false` on SSE drop, flip idle seats to
  NPC (`initializeMemory` + seed public clues), auto-transfer `hostPlayerId`. Closes the "host closes tab =
  game bricked" gap. **Files:** `events/route.ts`, `room-engine.ts`, `advance/route.ts`, `projection.ts`. — **M**
- [ ] **D3 · Discussion liveness** — idle nudge button + timer (server path exists), NPC cross-talk (react
  when named). **Files:** `room-group-chat.ts`, `RoomPanels.tsx`. — **M**
- [ ] **D4 · Activate emotion/suspicion (KI-010)** — rule-based updates on accusation / clue-hit; render
  Top-2 suspicions + emotion into the prompt with "fluster when cornered" conditional. **Files:**
  `group-chat/route.ts`, `memory-manager.ts`, `npc-base.ts`. — **M**
- [ ] **D5 · Voting-integrity UX** — VOTING opens chat for a defense round; reveal per-ballot tally +
  staged reveal; render `reveal.characters` script recap. **Files:** `phase-manager.ts`, `RoomPanels.tsx`. — **M**
- [ ] **D6 · Investigation depth** — fuzzy "someone found something in the study" broadcast on private
  finds; enable the unused `Clue.prerequisite` chains + acyclic schema check. **Files:**
  `room-investigation.ts`, `schema.ts`, `RoomPanels.tsx`. — **S/M**

## Batch E — Robustness lows & housekeeping 🧹

- [ ] **E1 · KI-052 / KI-053 — SSE `cancel()` cleanup + `globalThis` db handle for HMR.** — **S**
- [ ] **E2 · KI-054 / KI-055 — finished-room TTL/cleanup + rate-limit `resolve/[code]`.** — **S**
- [ ] **E3 · KI-056 (=KI-028) — strengthen startup validation:** clue-id uniqueness, exactly-one-killer,
  `availableInRound` range, referential integrity. **File:** `lib/scenarios/schema.ts`. — **S**
- [ ] **E4 · KI-058 (=KI-016) / KI-060 (=KI-009) — memory summarization in room path; lower chat
  `maxOutputTokens` to ~300-600.** — **S**
- [ ] **E5 · KI-059 — surface provider/key mismatch instead of silent canned-line degrade.** — **S**
- [ ] **E6 · KI-062 — only auto-scroll when already at bottom.** **File:** `RoomPanels.tsx`. — **S**
- [ ] **E7 · KI-033 — update `AGENTS.md` (stale stack) to defer to ARCHITECTURE.md.** — **S**

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
