# Agent harness — how to use this

This folder is the **shared brain** for AI agents working on this repo. It exists so each new agent
can onboard fast and so knowledge compounds instead of being rediscovered every session.

## Onboarding checklist (do this first)

1. Read `/CLAUDE.md` (root) — the map and the hard rules.
2. Read `ARCHITECTURE.md` — how the system is *actually* wired (and what's dead code).
3. Skim `KNOWN-ISSUES.md` — the live bug/issue register; pick work from here.
4. Skim `PITFALLS.md` — avoid re-stepping on known landmines.
5. Read `WORKING-MEMORY.md` — what the last session was doing and what's next.
6. `npm install`, then `npm run build` to confirm a green baseline before changing anything.

## The files

- **ARCHITECTURE.md** — long-term. System map, data flow, wired-vs-dead code. Update when you change
  how things connect.
- **DECISIONS.md** — long-term. *Why* the code is the way it is (ADR-style). Append when you make or
  discover an architectural decision. Mark "Discovered" items "Revisit" if they look unintentional.
- **PITFALLS.md** — long-term. Gotchas that cost time. Append the moment something surprises you.
- **KNOWN-ISSUES.md** — medium-term. Bug/issue register with `severity`, `status`, file refs. The
  to-do list. Update `status` as you work (open → in-progress → fixed/wontfix).
- **WORKING-MEMORY.md** — short-term. Current session state, in-flight work, immediate next steps,
  handoff notes. Rewrite freely; this is scratch, not history.

## Working agreement

- **Write things down.** A fact you had to dig for is a fact the next agent will have to dig for.
- **Right file for the fact:** durable "how/why" → ARCHITECTURE/DECISIONS; "this bit me" → PITFALLS;
  "this is broken" → KNOWN-ISSUES; "where I am right now" → WORKING-MEMORY.
- **Keep the baseline green.** Run `npm run build` before declaring done. There are no tests yet, so
  the build + manual play are the safety net.
- **Don't silently change architecture.** Add a DECISIONS.md entry.
- **Respect information isolation** (see CLAUDE.md hard rules) — it's the point of the game.

## Provenance

The initial harness + the first full review (KNOWN-ISSUES seed) were produced 2026-06-30 by a
multi-agent review pass (8 finder dimensions → adversarial verification → synthesis). See
WORKING-MEMORY.md for the run reference.
