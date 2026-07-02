import { streamText, type ModelMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

export type LLMProvider = 'anthropic' | 'google';

// Default provider is Google Gemini (free tier: ~10 RPM / 250 RPD / 250K TPM, no card).
// For higher-volume play (multiple players → many NPC calls per turn) set
// GOOGLE_MODEL=gemini-2.5-flash-lite (higher free RPM, cheaper/faster).
const DEFAULT_PROVIDER: LLMProvider = 'google';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const GOOGLE_MODEL = process.env.GOOGLE_MODEL ?? 'gemini-2.5-flash';

interface StreamChatParams {
  system: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

function otherProvider(provider: LLMProvider): LLMProvider {
  return provider === 'google' ? 'anthropic' : 'google';
}

// Returns the provider named EXPLICITLY by LLM_PROVIDER, or null when it is unset/blank/unrecognized
// (in which case getLLMProvider auto-selects based on which key is present).
function parseExplicitProvider(rawProvider: string | undefined): LLMProvider | null {
  if (rawProvider === 'google') {
    return 'google';
  }

  if (rawProvider === 'anthropic') {
    return 'anthropic';
  }

  return null;
}

// Whether the API key for a given provider is present in the environment.
function hasKey(provider: LLMProvider): boolean {
  if (provider === 'google') {
    return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  }

  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getLLMProvider(): LLMProvider {
  const explicit = parseExplicitProvider(process.env.LLM_PROVIDER?.toLowerCase());
  if (explicit) {
    // Honor an explicit LLM_PROVIDER verbatim (even if its key is missing — the misconfig is
    // surfaced by the diagnostic rather than silently overridden).
    return explicit;
  }

  // LLM_PROVIDER unset/blank/unrecognized: auto-select the provider whose key is present, preferring
  // the default. This prevents the common footgun where only ANTHROPIC_API_KEY is set (no
  // LLM_PROVIDER) yet the default google provider is chosen with no google key → all NPCs go mute.
  if (hasKey(DEFAULT_PROVIDER)) {
    return DEFAULT_PROVIDER;
  }

  const fallback = otherProvider(DEFAULT_PROVIDER);
  if (hasKey(fallback)) {
    return fallback;
  }

  return DEFAULT_PROVIDER;
}

export function isLLMConfigured(provider = getLLMProvider()): boolean {
  return hasKey(provider);
}

// Emit a single loud diagnostic (at most once per process) when the effective LLM configuration is
// degraded, so a silent all-NPCs-mute condition shows up in server logs. Does not throw and does not
// change the canned offline-line fallback — it only makes the misconfig visible.
function warnIfLLMConfigDegraded(): void {
  const g = globalThis as unknown as { __llmConfigWarned?: boolean };
  if (g.__llmConfigWarned) {
    return;
  }

  const googleKey = hasKey('google');
  const anthropicKey = hasKey('anthropic');

  // (a) Neither provider has a key → every NPC turn falls back to the canned offline line.
  if (!googleKey && !anthropicKey) {
    g.__llmConfigWarned = true;
    console.warn(
      '[llm-provider] No LLM API key found — all NPCs will reply with the canned offline line. ' +
        'Set GOOGLE_GENERATIVE_AI_API_KEY (default provider) or ANTHROPIC_API_KEY, and optionally ' +
        'LLM_PROVIDER=google|anthropic to choose between them.',
    );
    return;
  }

  // (b) An explicitly-selected provider lacks its key while the OTHER provider has one → the
  // selection silently mutes all NPCs even though a usable key is available.
  const explicit = parseExplicitProvider(process.env.LLM_PROVIDER?.toLowerCase());
  if (explicit && !hasKey(explicit) && hasKey(otherProvider(explicit))) {
    const other = otherProvider(explicit);
    g.__llmConfigWarned = true;
    console.warn(
      `[llm-provider] LLM_PROVIDER=${explicit} is selected but its API key is missing, while ` +
        `${other} has a key configured — all NPCs will use the canned offline line. Either set the ` +
        `${explicit} key, or set LLM_PROVIDER=${other} (or unset it to auto-select ${other}).`,
    );
  }
}

function resolveModel(provider: LLMProvider) {
  if (provider === 'google') {
    return google(GOOGLE_MODEL);
  }

  return anthropic(ANTHROPIC_MODEL);
}

export function streamChat(params: StreamChatParams): AsyncIterable<string> {
  warnIfLLMConfigDegraded();
  const provider = getLLMProvider();

  const result = streamText({
    model: resolveModel(provider),
    system: params.system,
    messages: params.messages,
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
  });

  return result.textStream;
}
