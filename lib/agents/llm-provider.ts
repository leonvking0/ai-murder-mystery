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

function parseProvider(rawProvider: string | undefined): LLMProvider {
  if (rawProvider === 'google') {
    return 'google';
  }

  if (rawProvider === 'anthropic') {
    return 'anthropic';
  }

  return DEFAULT_PROVIDER;
}

export function getLLMProvider(): LLMProvider {
  return parseProvider(process.env.LLM_PROVIDER?.toLowerCase());
}

export function isLLMConfigured(provider = getLLMProvider()): boolean {
  if (provider === 'google') {
    return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  }

  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function resolveModel(provider: LLMProvider) {
  if (provider === 'google') {
    return google(GOOGLE_MODEL);
  }

  return anthropic(ANTHROPIC_MODEL);
}

export function streamChat(params: StreamChatParams): AsyncIterable<string> {
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
