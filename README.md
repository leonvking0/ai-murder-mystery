# AI Murder Mystery (剧本杀) — multiplayer

Web-based, multiplayer AI murder-mystery game. A host opens a **room**, friends join with a code, and
each human is randomly assigned one of the cast — the remaining characters are played by AI. Discuss,
privately interrogate the AI suspects, investigate locations, then vote for the killer. One-player
rooms work too (you play one character, AI plays the rest).

> Working on the code? Start with [`CLAUDE.md`](./CLAUDE.md) and [`docs/agent/`](./docs/agent) — the
> agent harness (architecture, decisions, known issues, working memory).

## Tech stack

- Next.js (App Router) + TypeScript, Tailwind + shadcn/ui
- Vercel AI SDK (`ai`) → Google Gemini (default) or Anthropic Claude
- SQLite (`better-sqlite3`) for room persistence
- Realtime via in-process pub/sub + Server-Sent Events (native `EventSource`)

## Environment

Copy `.env.local.example` → `.env.local` and set your key:

```bash
LLM_PROVIDER=google                 # google (default) | anthropic
GOOGLE_GENERATIVE_AI_API_KEY=...    # https://aistudio.google.com/apikey (free tier, no card)
GOOGLE_MODEL=gemini-2.5-flash       # or gemini-2.5-flash-lite for busier rooms
# ANTHROPIC_API_KEY=...             # optional; ANTHROPIC_MODEL=claude-sonnet-4-6
DATABASE_PATH=./data/game.db        # SQLite file
```

> Gemini free tier is ~10 RPM / 250 requests/day. A busy multi-player room can hit that quickly —
> use `gemini-2.5-flash-lite` (higher free RPM) or an Anthropic key for heavy play.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

## Deploy (self-hosted / VPS, Docker Compose)

```bash
cp .env.local.example .env.local   # add your API key
docker compose up -d --build       # serves on :3000; SQLite persists in the game-data volume
```

## How to play

1. Open the app → **create a room** (enter a nickname) or **join** with a 5-char code.
2. Share the room code / invite link with friends; they join the lobby.
3. Host clicks **Start** → characters are randomly assigned (AI fills the rest).
4. **Reading**: read your character's secret script (only you can see it).
5. **Discussion**: talk in the public group chat (as your character); privately message AI suspects.
6. **Investigation**: search locations for clues (public clues are shared; private ones are yours).
7. **Voting**: everyone accuses a suspect; majority decides.
8. **Reveal**: the truth, the killer, who played whom, and the vote tally.

The host advances phases. Rounds: Discussion → Investigation, twice, then Final Discussion → Vote →
Reveal.

## Scripts

```bash
npm run dev | build | start
npm run lint
npm run typecheck    # tsc --noEmit
npm test             # info-isolation + store + bus regression (node --experimental-strip-types)
```

## Scenario

Ships with 《暴风雪山庄》 (`data/scenarios/storm-mansion.json`): 5 characters, 5 locations,
round-gated clues. Scenarios are validated at startup.

## Design notes

- **Information isolation** is enforced server-side: each client only ever receives public data + its
  own character's secrets; the solution is sent only at the reveal. See
  `lib/scenarios/projection.ts` and `tests/info-isolation.test.ts`.
- API surface is under `app/api/room/*`. Full map: `docs/agent/ARCHITECTURE.md`.
