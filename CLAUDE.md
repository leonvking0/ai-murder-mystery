# CLAUDE.md — AI Murder Mystery (剧本杀)

> Entry point for AI coding agents. Read this first, then `docs/agent/`.
> This file is auto-loaded by Claude Code each session. Keep it short; put detail in `docs/agent/`.

## What this is

A web-based, single-player AI murder-mystery game (剧本杀). One human player chats with 5
AI-controlled NPCs and works through a 10-phase flow to identify the killer. NPCs are driven by
the Vercel AI SDK (`ai`) against Anthropic Claude or Google Gemini.

## Agent harness — read these before working

The durable knowledge for this repo lives in **`docs/agent/`**. Treat it as your shared brain.

| File | What it holds | When to read / update |
|------|---------------|-----------------------|
| `docs/agent/README.md` | How the harness works + onboarding checklist | First time in the repo |
| `docs/agent/ARCHITECTURE.md` | System map: data flow, **wired vs dead code** | Before touching engine/agents/routes |
| `docs/agent/DECISIONS.md` | Decision log (ADR-style) — *why* things are the way they are | Before changing an architectural choice; append when you make one |
| `docs/agent/PITFALLS.md` | Gotchas that already bit us (env, framework, runtime) | Before debugging; append when something surprises you |
| `docs/agent/KNOWN-ISSUES.md` | Live bug/issue register with severity + status | Pick work from here; update status as you fix |
| `docs/agent/BACKLOG.md` | Prioritized, batched task list (bugs + gameplay) linking KI ids | Pick the next task top-down; check items off as you land them |
| `docs/agent/WORKING-MEMORY.md` | Short-term: current state, in-flight work, next steps, session handoff | Start & end of every session |

**Rule:** when you learn something non-obvious, write it down in the right file. Long-term facts →
ARCHITECTURE/DECISIONS/PITFALLS. Current-session state → WORKING-MEMORY. Bugs → KNOWN-ISSUES.

## Commands

```bash
npm install          # deps are NOT committed; install first (node 22, npm 10)
npm run dev          # next dev (localhost:3000)
npm run build        # next build (also the real typecheck — see PITFALLS)
npm run lint         # eslint (flat config; run via local binary, see PITFALLS)
./node_modules/.bin/tsc --noEmit   # type check (no npm script for this yet)
```

There are **no automated tests** yet. Validate changes with `npm run build` + manual play.

## Hard rules (do not violate)

1. **Information isolation is the whole game.** An NPC's prompt may contain only *its own* private
   script + public info + its own memory — never another NPC's secrets. Equally important: the
   *player* must not be able to read the solution (`case.truth`, `isKiller`, other characters'
   `privateScript`/`alibi.truth`/`secrets`). See KNOWN-ISSUES — this is currently **violated** at
   the transport/bundle layer.
2. **Don't deviate from the stack** without a DECISIONS.md entry: Next.js App Router + TS, Tailwind +
   shadcn/ui, Vercel AI SDK, Zustand.
3. **When you use a Claude model, use a current model id** and confirm it via the `claude-api` skill —
   do not copy stale ids from memory or old code.

## Conventions

- Components: PascalCase (`ChatPanel.tsx`). Libs/utils: camelCase. API routes: kebab-case folders.
- Types: PascalCase interfaces in `types/game.ts` (single source of truth for shared types).
- Path alias `@/*` → repo root.
