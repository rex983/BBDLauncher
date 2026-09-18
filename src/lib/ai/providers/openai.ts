// OpenAI Chat Completions. Same shape as the Anthropic/Gemini providers —
// system + user in, text out. Wired for future use.

import type { GenerateOptions, GenerateResult } from "..";
import { AIProviderError } from "..";

const DEFAULT_MODEL = "gpt-4o-mini";

interface OpenAIChoice {
  message?: { content?: string; role?: string };
  finish_reason?: string;
}
interface OpenAIResponse {
  choices?: OpenAIChoice[];
  error?: { message?: string; type?: string };
}

export async function generateWithOpenAI(opts: GenerateOptions): Promise<GenerateResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AIProviderError("openai", "OPENAI_API_KEY is not configured");
  }
  const model = opts.model || process.env.AI_MODEL || DEFAULT_MODEL;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 2048,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AIProviderError(
      "openai",
      `OpenAI API error (${res.status}): ${errText.slice(0, 500)}`,
      res.status,
    );
  }

  const data = (await res.json()) as OpenAIResponse;
  if (data.error) {
    throw new AIProviderError("openai", data.error.message || "OpenAI returned an error");
  }
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new AIProviderError("openai", "Empty response from OpenAI");
  }

  return { text, provider: "openai", model };
}
