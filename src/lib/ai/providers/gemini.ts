// Google Gemini via the REST endpoint. Uses the v1beta generateContent API
// which accepts a system instruction, a user prompt, and generationConfig for
// temperature/maxOutputTokens. Chosen over the @google/genai SDK to keep
// package.json unchanged — a curl call is a curl call.
//
// Default model is gemini-2.5-flash which stays inside the free tier and is
// plenty for HR-doc drafting. Override via AI_MODEL env or the per-call
// `model` option.

import type { GenerateOptions, GenerateResult } from "..";
import { AIProviderError } from "..";

const DEFAULT_MODEL = "gemini-flash-latest";

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

export async function generateWithGemini(opts: GenerateOptions): Promise<GenerateResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AIProviderError("gemini", "GEMINI_API_KEY is not configured");
  }
  const model = opts.model || process.env.AI_MODEL || DEFAULT_MODEL;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: {
      role: "system",
      parts: [{ text: opts.system }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: opts.prompt }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens ?? 2048,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AIProviderError(
      "gemini",
      `Gemini API error (${res.status}): ${errText.slice(0, 500)}`,
      res.status,
    );
  }

  const data = (await res.json()) as GeminiResponse;
  if (data.error) {
    throw new AIProviderError("gemini", data.error.message || "Gemini returned an error");
  }
  if (data.promptFeedback?.blockReason) {
    throw new AIProviderError(
      "gemini",
      `Prompt blocked by safety filters: ${data.promptFeedback.blockReason}`,
    );
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
  if (!text) {
    throw new AIProviderError("gemini", "Empty response from Gemini");
  }

  return { text, provider: "gemini", model };
}
