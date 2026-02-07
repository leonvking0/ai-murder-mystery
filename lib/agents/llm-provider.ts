import { streamText, type ModelMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

export type LLMProvider = 'anthropic' | 'google';

const DEFAULT_PROVIDER: LLMProvider = 'anthropic';
const ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const GOOGLE_MODEL = 'gemini-2.0-flash';

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

  return 'anthropic';
}

export function getLLMProvider(): LLMProvider {
  return parseProvider(process.env.LLM_PROVIDER?.toLowerCase() ?? DEFAULT_PROVIDER);
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
