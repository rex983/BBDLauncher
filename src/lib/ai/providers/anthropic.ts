// Anthropic Claude via the Messages API. Wired for future use — flips on the
// moment ANTHROPIC_API_KEY is present and AI_PROVIDER=anthropic (or the caller
// passes provider: "anthropic" explicitly).

import type { GenerateOptions, GenerateResult } from "..";
import { AIProviderError } from "..";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const API_VERSION = "2023-06-01";

interface AnthropicContentBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  error?: { message?: string; type?: string };
  stop_reason?: string;
}

export async function generateWithAnthropic(opts: GenerateOptions): Promise<GenerateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AIProviderError("anthropic", "ANTHROPIC_API_KEY is not configured");
  }
  const model = opts.model || process.env.AI_MODEL || DEFAULT_MODEL;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify({
      model,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 2048,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AIProviderError(
      "anthropic",
      `Anthropic API error (${res.status}): ${errText.slice(0, 500)}`,
      res.status,
    );
  }

  const data = (await res.json()) as AnthropicResponse;
  if (data.error) {
    throw new AIProviderError("anthropic", data.error.message || "Anthropic returned an error");
  }
  const text = data.content?.filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
  if (!text) {
    throw new AIProviderError("anthropic", "Empty response from Anthropic");
  }

  return { text, provider: "anthropic", model };
}
