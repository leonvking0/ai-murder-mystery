// Offline structural solvability / reachability analysis for scenarios (F2-tail).
//
// WHY this exists, separately from `validateScenario`:
//   `validateScenario` (schema.ts) proves a scenario is well-FORMED — shapes, exactly-one-killer,
//   integer rounds, relationship referential integrity, globally-unique + acyclic clue prerequisites.
//   It does NOT prove the case is *winnable*: that every authored clue can actually be surfaced within
//   the phase walk a room will follow, that prerequisite chains are walkable in round order, and that
//   the killer is inferable from evidence. Those are SOLVABILITY properties, and they depend on the
//   FLOW (standard vs quick) — the same scenario can be solvable under one flow and strand clues under
//   another. This module is the safety gate future generated/UGC scenarios must pass, per BOTH flows.
//
// This analysis BUILDS ON a scenario that already passed `validateScenario`. It never re-implements or
// weakens those checks; a few upstream-guaranteed invariants are re-asserted DEFENSIVELY (no_killer /
// multiple_killers / dangling_relationship) so the analyzer is self-contained for generated content
// that might reach it without going through the schema validator.
//
// PURE + deterministic: no I/O, no LLM, no side-effectful imports. Safe to run anywhere.

import type { Clue, Scenario } from '@/types/game';

// Value import must be a relative `.ts` path so the strip-types test runner resolves it at runtime
// (the `@/` alias resolves only for `import type`). Mirrors room-investigation.ts / the test harness.
import { FLOWS, type FlowId } from '../game-engine/flow.ts';

export interface SolvabilityIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface SolvabilityReport {
  flowId: FlowId;
  // True iff there are NO 'error' issues. Warnings are advisory and never block solvability.
  solvable: boolean;
  issues: SolvabilityIssue[];
}

// The phases in a flow at which a player may investigate. Kept in sync with room-investigation.ts,
// which likewise filters the phase walk to exactly these two phase ids.
const INVESTIGATION_PHASES = new Set<string>(['INVESTIGATION_1', 'INVESTIGATION_2']);

/**
 * Replicates room-investigation.ts's investigation-ceiling rule, reduced to the single number that
 * matters for solvability: the MAXIMUM clue round this flow can ever expose.
 *
 * The engine rule: the LAST investigation phase in a flow exposes `max(availableInRound)` across the
 * whole scenario; earlier investigation phases expose only their ordinal. So the flow's overall reach
 * is whatever its last investigation phase exposes = max(clueMax, numberOfInvestigationPhases). This is
 * exactly why the 'quick' flow (a single, therefore LAST, investigation phase) still reaches round-2
 * clues — the F4-b guarantee we are regression-proofing here.
 *
 * Returns 0 when the flow has no investigation phase at all: nothing is reachable, so every clue is
 * stranded (reported separately as `no_investigation_phase` + `clue_unreachable_by_round`).
 *
 * NOTE (intentional): because the last-phase ceiling is bumped up to `clueMax`, a flow that HAS at
 * least one investigation phase always reaches every authored clue round. That is the desired
 * property — F4-b made quick mode never strand a higher-round clue. `clue_unreachable_by_round` is
 * therefore a defensive per-clue restatement that only bites when a flow exposes NO investigation
 * phase; we keep it so the analyzer is self-contained for arbitrary future flow presets.
 */
function maxInvestigationCeiling(scenario: Scenario, flowId: FlowId): number {
  const seq = FLOWS[flowId];
  const invPhaseCount = seq.filter(p => INVESTIGATION_PHASES.has(p)).length;
  if (invPhaseCount === 0) {
    return 0;
  }
  const clueMax = scenario.locations
    .flatMap(l => l.clues.map(c => c.availableInRound))
    .reduce((m, r) => Math.max(m, r), invPhaseCount);
  return clueMax;
}

// Flatten every clue across every location into an id → clue map. Global id uniqueness is guaranteed
// upstream (validateScenario's D6 graph check), so a later entry never clobbers a meaningful earlier one.
function indexClues(scenario: Scenario): Map<string, Clue> {
  const byId = new Map<string, Clue>();
  for (const loc of scenario.locations) {
    for (const clue of loc.clues) {
      byId.set(clue.id, clue);
    }
  }
  return byId;
}

/**
 * Analyze one scenario under one flow. Every failed check appends an issue; `solvable` is true iff no
 * 'error' issue was raised. See each block for WHY the check matters.
 */
export function analyzeSolvability(scenario: Scenario, flowId: FlowId): SolvabilityReport {
  const issues: SolvabilityIssue[] = [];

  const seq = FLOWS[flowId];
  const invPhaseCount = seq.filter(p => INVESTIGATION_PHASES.has(p)).length;
  const ceiling = maxInvestigationCeiling(scenario, flowId);
  const clueById = indexClues(scenario);
  const allClues = [...clueById.values()];

  const characterIds = new Set(scenario.characters.map(c => c.id));
  // The victim is normally a free-text name (not a character id), but be robust: exclude any character
  // whose id or name matches case.victim from "under-authored character" coverage checks.
  const victimRef = scenario.case?.victim ?? '';

  // --- error: no_investigation_phase --------------------------------------------------------------
  // If a flow has zero investigation phases, no clue can EVER be found — the case is trivially
  // unsolvable regardless of how well the clues are authored.
  if (invPhaseCount === 0) {
    issues.push({
      severity: 'error',
      code: 'no_investigation_phase',
      message: `Flow "${flowId}" has no investigation phase, so no clue can ever be discovered.`,
    });
  }

  // --- error: clue_unreachable_by_round -----------------------------------------------------------
  // Every clue's authored round must fall within the flow's maximum investigation ceiling, else the
  // clue is stranded in a round this flow never reaches. With ≥1 investigation phase the ceiling is
  // bumped to clueMax (see maxInvestigationCeiling), so this only bites when investigation is absent —
  // but we still report per-clue so the failure is diagnosable, not just "no investigation phase".
  for (const clue of allClues) {
    if (clue.availableInRound > ceiling) {
      issues.push({
        severity: 'error',
        code: 'clue_unreachable_by_round',
        message:
          `Clue "${clue.id}" is authored for round ${clue.availableInRound}, but flow "${flowId}" ` +
          `only reaches round ${ceiling}; it can never be discovered.`,
      });
    }
  }

  // --- error: prerequisite_unreachable ------------------------------------------------------------
  // A gated clue only unlocks once its prerequisite clue is already known. For the chain to be
  // WALKABLE within a flow the prerequisite must (a) exist and (b) become available no LATER than the
  // clue that depends on it — you cannot be required to already hold a clue that only unlocks in a
  // later round. (Acyclicity is validated upstream; here we enforce round-monotonicity of the edges.)
  for (const clue of allClues) {
    if (clue.prerequisite === undefined) {
      continue;
    }
    const prereq = clueById.get(clue.prerequisite);
    if (!prereq) {
      // Defensive: upstream guarantees prereq existence, but keep the analyzer self-contained.
      issues.push({
        severity: 'error',
        code: 'prerequisite_unreachable',
        message: `Clue "${clue.id}" requires prerequisite "${clue.prerequisite}", which does not exist.`,
      });
      continue;
    }
    if (prereq.availableInRound > clue.availableInRound) {
      issues.push({
        severity: 'error',
        code: 'prerequisite_unreachable',
        message:
          `Clue "${clue.id}" (round ${clue.availableInRound}) requires prerequisite "${prereq.id}" ` +
          `which only unlocks in round ${prereq.availableInRound}; the chain is not walkable.`,
      });
    }
  }

  // --- error: no_killer / multiple_killers --------------------------------------------------------
  // Exactly one killer must be well-defined, else the reveal is undefined (0) or ambiguous (>1).
  // Upstream (validateScenario) already enforces this; re-assert defensively so generated content that
  // bypassed the schema validator still can't be declared "solvable".
  const killers = scenario.characters.filter(c => c.isKiller);
  if (killers.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no_killer',
      message: 'No character is flagged isKiller; the case has no solution.',
    });
  } else if (killers.length > 1) {
    issues.push({
      severity: 'error',
      code: 'multiple_killers',
      message: `${killers.length} characters are flagged isKiller; the killer is ambiguous.`,
    });
  }

  // --- warning: killer_no_incriminating_clue ------------------------------------------------------
  // Heuristic (WARNING, not error): if NO clue's GM-only `significance` text mentions the killer's id
  // or name, there may be no evidentiary path pointing at them — the case could be unsolvable by
  // deduction. `significance` is freeform authoring text, so a miss here is a soft signal (a killer can
  // be implicated indirectly), which is why this is advisory rather than blocking.
  if (killers.length === 1) {
    const killer = killers[0];
    const mentionsKiller = allClues.some(
      c => c.significance.includes(killer.id) || c.significance.includes(killer.name),
    );
    if (!mentionsKiller) {
      issues.push({
        severity: 'warning',
        code: 'killer_no_incriminating_clue',
        message:
          `No clue significance mentions the killer "${killer.name}" (${killer.id}); the killer may ` +
          `not be inferable from evidence.`,
      });
    }
  }

  // --- warning: character_no_clue_coverage --------------------------------------------------------
  // A non-victim character that appears in NO clue significance AND NO timeline event is effectively
  // isolated from the case — almost certainly under-authored (they contribute nothing to investigate or
  // reason about). WARNING: an intentionally peripheral character is legal, just suspicious.
  const timelineCharacterIds = new Set(
    scenario.timeline.flatMap(ev => ev.involvedCharacters),
  );
  for (const char of scenario.characters) {
    if (char.id === victimRef || char.name === victimRef) {
      continue; // the victim is not expected to drive investigation
    }
    const inClue = allClues.some(
      c => c.significance.includes(char.id) || c.significance.includes(char.name),
    );
    const inTimeline = timelineCharacterIds.has(char.id);
    if (!inClue && !inTimeline) {
      issues.push({
        severity: 'warning',
        code: 'character_no_clue_coverage',
        message:
          `Character "${char.name}" (${char.id}) appears in no clue significance and no timeline ` +
          `event; they may be under-authored.`,
      });
    }
  }

  // --- error: dangling_relationship ---------------------------------------------------------------
  // Every relationships[].characterId must reference a real character. Upstream-validated, re-asserted
  // defensively: a dangling relationship means a character reasons about someone who does not exist.
  for (const char of scenario.characters) {
    for (const rel of char.relationships) {
      if (!characterIds.has(rel.characterId)) {
        issues.push({
          severity: 'error',
          code: 'dangling_relationship',
          message:
            `Character "${char.id}" has a relationship to unknown character id "${rel.characterId}".`,
        });
      }
    }
  }

  // --- error: dangling_timeline_character ---------------------------------------------------------
  // Every timeline[].involvedCharacters[] must reference a real character. This is NOT validated
  // upstream (validateScenario only shape-checks the timeline array), so it is a genuine ADDITIONAL
  // check: a timeline event pinned on a non-existent character corrupts the shared factual record the
  // whole deduction rests on.
  for (let i = 0; i < scenario.timeline.length; i++) {
    for (const cid of scenario.timeline[i].involvedCharacters) {
      if (!characterIds.has(cid)) {
        issues.push({
          severity: 'error',
          code: 'dangling_timeline_character',
          message: `Timeline event ${i} involves unknown character id "${cid}".`,
        });
      }
    }
  }

  const solvable = !issues.some(issue => issue.severity === 'error');
  return { flowId, solvable, issues };
}

/**
 * Analyze a scenario under EVERY flow the engine ships (standard + quick). A scenario is only safe to
 * ship/generate if it is solvable under all flows a room can pick — a clue stranded only under quick is
 * still a shipping bug.
 */
export function analyzeAllFlows(scenario: Scenario): SolvabilityReport[] {
  return (Object.keys(FLOWS) as FlowId[]).map(flowId => analyzeSolvability(scenario, flowId));
}
