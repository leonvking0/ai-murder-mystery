# AI Murder Mystery (剧本杀)

Web-based single-player murder mystery game where one player interacts with AI-controlled NPCs and a GM-driven phase engine.

## Tech Stack

- Next.js App Router + TypeScript
- Tailwind CSS + shadcn/ui
- Vercel AI SDK (`ai`) with multi-provider support:
  - Anthropic via `@ai-sdk/anthropic` (`claude-sonnet-4-5`)
  - Google via `@ai-sdk/google` (`gemini-2.0-flash`)
- Zustand client store
- In-memory session store (current), SQLite dependency available in project
- SSE streaming for chat responses

## Environment Variables

Copy `.env.local.example` to `.env.local`:

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key
```

Provider switching:
- `LLM_PROVIDER=anthropic` uses Claude (`claude-sonnet-4-5`)
- `LLM_PROVIDER=google` uses Gemini (`gemini-2.0-flash`)

If the selected provider key is missing, NPC/GM responses fall back to built-in safe placeholder lines so the game remains playable.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Game Flow (10 Phases)

1. `LOBBY`
2. `READING`
3. `INTRO`
4. `DISCUSSION_1`
5. `INVESTIGATION_1`
6. `DISCUSSION_2`
7. `INVESTIGATION_2`
8. `FINAL_DISCUSSION`
9. `VOTING`
10. `REVEAL`

Current session starts at `READING`.

## Core Gameplay Rules

- `READING` phase: chat is disabled.
- Only `INVESTIGATION_1` and `INVESTIGATION_2` allow investigation.
- `VOTING` phase accepts one player vote (`/api/game/[id]/vote`).
- After vote submission, client auto-advances to `REVEAL`.
- `REVEAL` shows correctness and full case truth.

## API Endpoints

- `POST /api/game/create` - create new session
- `GET /api/game/[id]/state` - get session + scenario
- `POST /api/game/chat` - private chat SSE stream
- `POST /api/game/[id]/group-chat` - group chat SSE stream
- `POST /api/game/[id]/investigate` - investigate a location
- `POST /api/game/[id]/vote` - submit final accusation
- `POST /api/game/[id]/advance` - advance to next phase

## Sprint 7/8 Features Included

- Voting API and voting UI panel
- Reveal panel with dramatic staged sequence
- Auto transition from `VOTING` to `REVEAL` after vote
- Unified async loading/error states across key panels
- Route-level `try/catch` error handling added for all game API routes
- Header now shows scenario title + description
- Responsive panel layout with dark theme-compatible styling

## Validation Performed

- `npm run lint`
- `npx tsc --noEmit`
- Phase engine flow checks (10-phase order, phase capabilities, voting gate on advance)

Note: Full localhost HTTP E2E could not be run in this sandbox because binding to local ports is restricted (`EPERM`).
