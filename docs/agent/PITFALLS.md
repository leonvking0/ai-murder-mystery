# Pitfalls (踩过的坑)

> Long-term memory of things that surprised us / cost time. Append when something bites you.
> Each: symptom → cause → what to do.

## Environment / tooling

### `node_modules` is not present on a fresh checkout
- **Symptom:** `./node_modules/.bin/tsc` → "No such file or directory"; nothing runs.
- **Cause:** Deps aren't committed/cached. Fresh clone has no `node_modules`.
- **Do:** `npm install` first (node 22.x, npm 10.x). Takes a bit; run it early / in the background.

### `npx tsc` and `npx eslint` pull the WRONG package
- **Symptom:** `npx tsc` prints "This is not the tsc command you are looking for"; `npx eslint`
  installs `eslint@10` and dies with `ERR_MODULE_NOT_FOUND`.
- **Cause:** `tsc` isn't a package named `tsc` (it's `typescript`); `npx eslint` fetches a newer global
  eslint that doesn't match the project's flat config.
- **Do:** Use the local binaries after `npm install`: `./node_modules/.bin/tsc --noEmit`,
  `./node_modules/.bin/eslint .`, `./node_modules/.bin/next build`. Or `npm run lint` / `npm run build`.

### There is no `typecheck` npm script
- **Symptom:** `npm run typecheck` fails (script doesn't exist).
- **Do:** `./node_modules/.bin/tsc --noEmit`. `next build` also runs TypeScript as part of the build.
  Consider adding a `typecheck` script (see KNOWN-ISSUES).

### Baseline is green
- As of 2026-06-30, `tsc --noEmit`, `eslint .`, and `next build` all pass with **zero** errors/warnings.
  If you see new errors, they're yours — don't assume pre-existing breakage.

## Framework specifics

### Next.js 16 route params are async
- Route handlers receive `context.params` as a **`Promise`** (`await context.params`). Page components
  too (`await params`). Don't destructure synchronously.

### The home page is statically prerendered — and it bundles the scenario
- **Symptom (security):** `app/page.tsx` does `import scenario from '@/data/scenarios/storm-mansion.json'`
  and `/` builds as `○ (Static)`. The **entire** scenario — including `case.truth`, every
  `privateScript`, `isKiller`, `alibi.truth`, `secrets`, private timeline — ends up in the client JS
  bundle and in `/api/.../state` + `/api/.../create` responses.
- **Cause:** Server never strips GM-only fields before sending to the browser.
- **Do:** Never assume prompt-level isolation protects the answer. Solution data must stay server-side;
  send the client only public fields (+ a dedicated reveal endpoint). See KNOWN-ISSUES (top priority).

## Runtime behavior

### Sessions disappear after a server restart / on serverless
- **Symptom:** Valid `sessionId` suddenly returns 404 "Session not found".
- **Cause:** Sessions live in a module-level `Map` (see DECISIONS). Any new process = empty store.
- **Do:** Don't rely on session persistence in dev across restarts. For deploy, add a real store.

### NPCs only know *public* clues
- The investigation flow adds **public** clues to every NPC's `knownFacts`; private clues the player
  finds go only to the player's notebook. NPCs can't reference them unless the player says them aloud.
  This is by design today, but surprising when "the NPC ignores my evidence".

### `maxOutputTokens: 5000` despite "1-3 sentence" prompts
- Commit `59ed493` bumped this to "prevent hallucination". It doesn't prevent hallucination; it just
  raises the cost/latency ceiling. NPC replies are meant to be short. Don't cargo-cult this number.

## Model ids
- LLM model ids live in `lib/agents/llm-provider.ts` and drift from the README. Always confirm a
  current Claude model id via the `claude-api` skill before changing — do not trust ids in old code
  or memory. (README says `claude-sonnet-4-5` / `gemini-2.0-flash`; code says `claude-sonnet-4-5` /
  `gemini-3-flash-preview`.)
