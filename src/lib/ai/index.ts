// Provider-agnostic LLM shim. One entry point (`generateText`) that dispatches
// to whichever provider is currently active. Each provider talks REST so we
// don't need to keep vendor SDKs in package.json — a new provider is a new
// file in ./providers/ and a new case in the switch below.
//
// Active provider + model resolution (highest priority first):
//   1. per-call `opts.provider` / `opts.model` overrides
//   2. `ai_config` DB row (managed at /admin/ai)
//   3. AI_PROVIDER / AI_MODEL env vars
//   4. hardcoded defaults ('gemini', per-provider default model)
//
// API KEYS always live in env (GEMINI_API_KEY / ANTHROPIC_API_KEY /
// OPENAI_API_KEY). We never store secrets in the DB — the config row only
// picks WHICH provider to use, not how to authenticate to it.

import { createAdminClient } from "@/lib/supabase/admin";
import { generateWithGemini } from "./providers/gemini";
import { generateWithAnthropic } from "./providers/anthropic";
import { generateWithOpenAI } from "./providers/openai";

export interface GenerateOptions {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  // Override the DB/env-selected provider for a single call. Useful for the
  // admin "test connection" endpoint — never touches the persisted config.
  provider?: SupportedProvider;
  model?: string;
}

export interface GenerateResult {
  text: string;
  provider: SupportedProvider;
  model: string;
}

export type SupportedProvider = "gemini" | "anthropic" | "openai";

export const SUPPORTED_PROVIDERS: SupportedProvider[] = [
  "gemini",
  "anthropic",
  "openai",
];

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

export interface AiConfig {
  provider: SupportedProvider;
  model: string | null;
}

export async function generateText(opts: GenerateOptions): Promise<GenerateResult> {
  const active = opts.provider ? { provider: opts.provider, model: opts.model ?? null } : await getAiConfig();
  const dispatchOpts: GenerateOptions = {
    ...opts,
    model: opts.model ?? active.model ?? undefined,
  };
  switch (active.provider) {
    case "gemini":
      return generateWithGemini(dispatchOpts);
    case "anthropic":
      return generateWithAnthropic(dispatchOpts);
    case "openai":
      return generateWithOpenAI(dispatchOpts);
    default: {
      const _exhaustive: never = active.provider;
      throw new Error(`Unsupported AI provider: ${_exhaustive as string}`);
    }
  }
}

// Read the persisted active config, falling back to env then defaults. DB
// read failures fall back to env silently — a provider swap shouldn't be
// the only thing standing between the manager and a generated report.
export async function getAiConfig(): Promise<AiConfig> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("ai_config")
      .select("provider, model")
      .eq("id", 1)
      .single<{ provider: string; model: string | null }>();
    if (data && isSupportedProvider(data.provider)) {
      return { provider: data.provider, model: data.model };
    }
  } catch {
    // Fall through to env — DB may be unreachable during migrations.
  }
  return getEnvConfig();
}

function getEnvConfig(): AiConfig {
  const rawProvider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const provider = isSupportedProvider(rawProvider) ? rawProvider : "gemini";
  const model = process.env.AI_MODEL || null;
  return { provider, model };
}

function isSupportedProvider(value: string): value is SupportedProvider {
  return value === "gemini" || value === "anthropic" || value === "openai";
}

// Which provider is currently active. Kept async so the caller can await
// alongside other config lookups — matches getAiConfig()'s I/O profile.
export async function getActiveProvider(): Promise<SupportedProvider> {
  return (await getAiConfig()).provider;
}

// Cheap probe for the admin settings UI — reports which providers have an
// API key configured in env. The DB config can still point at a provider
// without a key; the UI uses this to warn.
export function getProviderAvailability(): Record<SupportedProvider, boolean> {
  return {
    gemini: !!process.env.GEMINI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
  };
}
