// Provider-agnostic LLM shim. One entry point (`generateText`) that dispatches
// to whichever provider the AI_PROVIDER env selects. Each provider talks REST
// so we don't need to keep vendor SDKs in package.json — a new provider is a
// new file in ./providers/ and a new case in getProvider().
//
// Config is env-driven and read at request time so the operator can swap
// providers without redeploying:
//
//   AI_PROVIDER  = 'gemini' | 'anthropic' | 'openai'   (default 'gemini')
//   AI_MODEL     = model name override                  (per-provider default)
//   GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY
//
// The abstraction is intentionally thin: system prompt + user prompt in,
// text out. Streaming can be added later without changing the call sites.

import { generateWithGemini } from "./providers/gemini";
import { generateWithAnthropic } from "./providers/anthropic";
import { generateWithOpenAI } from "./providers/openai";

export interface GenerateOptions {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  // Override the provider chosen by env — useful for A/B or per-feature routing.
  provider?: SupportedProvider;
  model?: string;
}

export interface GenerateResult {
  text: string;
  provider: SupportedProvider;
  model: string;
}

export type SupportedProvider = "gemini" | "anthropic" | "openai";

export class AIProviderError extends Error {
  status?: number;
  provider: SupportedProvider;
  constructor(provider: SupportedProvider, message: string, status?: number) {
    super(message);
    this.name = "AIProviderError";
    this.provider = provider;
    this.status = status;
  }
}

export async function generateText(opts: GenerateOptions): Promise<GenerateResult> {
  const provider = opts.provider ?? getDefaultProvider();
  switch (provider) {
    case "gemini":
      return generateWithGemini(opts);
    case "anthropic":
      return generateWithAnthropic(opts);
    case "openai":
      return generateWithOpenAI(opts);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported AI provider: ${_exhaustive as string}`);
    }
  }
}

function getDefaultProvider(): SupportedProvider {
  const raw = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  if (raw === "anthropic" || raw === "openai" || raw === "gemini") return raw;
  return "gemini";
}

// Which provider is currently active (for logging + audit fields on the row).
export function getActiveProvider(): SupportedProvider {
  return getDefaultProvider();
}
