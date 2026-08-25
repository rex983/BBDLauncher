// Gemini quote-generation helper.
//
// Calls Google's Generative Language API (Gemini 2.5 Flash) to produce a
// single professional motivational quote by a real, famous person.
// Callers pass the last N author+quote pairs so the model can avoid
// duplicating what's already in the rotation.

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

export interface GeneratedQuote {
  quote: string;
  author: string;
}

export interface RecentQuote {
  quote: string;
  author: string;
}

export class GeminiQuoteError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "GeminiQuoteError";
  }
}

function buildPrompt(recent: RecentQuote[]): string {
  const avoidBlock =
    recent.length === 0
      ? "(No previous quotes to avoid — this is the first one.)"
      : recent
          .map((r, i) => `${i + 1}. "${r.quote}" — ${r.author}`)
          .join("\n");

  return [
    "You are curating a weekly motivational quote for a professional business dashboard.",
    "Audience: sales representatives and customer-service staff at a building-sales company.",
    "",
    "Requirements:",
    "- The quote must be from a REAL, FAMOUS person (historical or modern). No anonymous, no fictional characters, no made-up attributions.",
    "- Theme: success, perseverance, work ethic, teamwork, or personal growth.",
    "- Tone: uplifting and professional. Nothing political, religious, controversial, crude, edgy, or provocative. Nothing about war, violence, death, race, sexuality, or partisan politics.",
    "- Length: one or two sentences, under 220 characters.",
    "- Do NOT invent quotes. If you are not confident the attribution is accurate, pick a different one you ARE confident about.",
    "- Do NOT repeat any of the recent quotes or authors listed below.",
    "",
    "Recent quotes to AVOID (do not repeat these authors or these quotes):",
    avoidBlock,
    "",
    'Respond with ONLY a raw JSON object, no markdown fences, exactly this shape: {"quote": "...", "author": "..."}',
  ].join("\n");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip common ```json ... ``` fences the model might add despite the prompt.
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(fenceStripped);
  } catch {
    const match = fenceStripped.match(/\{[\s\S]*\}/);
    if (!match) throw new GeminiQuoteError("Model response did not contain JSON");
    return JSON.parse(match[0]);
  }
}

export async function generateQuote(
  recent: RecentQuote[]
): Promise<GeneratedQuote> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiQuoteError("GEMINI_API_KEY is not configured");
  }

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(recent) }] }],
      generationConfig: {
        temperature: 0.9,
        responseMimeType: "application/json",
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GeminiQuoteError(
      `Gemini API error ${res.status}: ${body.slice(0, 300)}`,
      res.status
    );
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiQuoteError("Gemini returned no text");
  }

  const parsed = extractJson(text) as { quote?: unknown; author?: unknown };
  const quote = typeof parsed.quote === "string" ? parsed.quote.trim() : "";
  const author = typeof parsed.author === "string" ? parsed.author.trim() : "";

  if (!quote || !author) {
    throw new GeminiQuoteError("Gemini response missing quote or author");
  }
  if (quote.length > 400) {
    throw new GeminiQuoteError("Generated quote exceeds length limit");
  }

  return { quote, author };
}
