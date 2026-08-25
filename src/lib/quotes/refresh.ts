import { createAdminClient } from "@/lib/supabase/admin";
import { generateQuote, type RecentQuote } from "@/lib/quotes/gemini";
import type { MotivationalQuote } from "@/types/quote";

// Author-normalised uniqueness so "M.L. King Jr." and "Martin Luther King Jr."
// aren't both accepted as brand-new. Also strips punctuation/case.
function normAuthor(a: string): string {
  return a
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normQuote(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

const MAX_ATTEMPTS = 5;
const RECENT_WINDOW = 25; // How many past quotes to send to Gemini as "avoid" context

// Generate a fresh AI quote, deduped against recent history, and mark it as
// the new active row. Returns the newly created quote row.
export async function refreshQuoteFromAi(opts: {
  source: "ai_cron" | "ai_manual";
  createdBy: string | null;
}): Promise<MotivationalQuote> {
  const supabase = createAdminClient();

  const { data: recentRows, error: recentErr } = await supabase
    .from("launcher_motivational_quotes")
    .select("quote, author")
    .order("created_at", { ascending: false })
    .limit(RECENT_WINDOW);

  if (recentErr) {
    throw new Error(`Failed to load recent quotes: ${recentErr.message}`);
  }

  const recent: RecentQuote[] = (recentRows || []).map((r) => ({
    quote: r.quote as string,
    author: r.author as string,
  }));
  const seenAuthors = new Set(recent.map((r) => normAuthor(r.author)));
  const seenQuotes = new Set(recent.map((r) => normQuote(r.quote)));

  let generated: { quote: string; author: string } | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const candidate = await generateQuote(recent);
      if (
        !seenAuthors.has(normAuthor(candidate.author)) &&
        !seenQuotes.has(normQuote(candidate.quote))
      ) {
        generated = candidate;
        break;
      }
      // Duplicate — feed it back in as "recent" for the next attempt too.
      recent.unshift(candidate);
      seenAuthors.add(normAuthor(candidate.author));
      seenQuotes.add(normQuote(candidate.quote));
    } catch (err) {
      lastError = err;
    }
  }

  if (!generated) {
    throw new Error(
      lastError instanceof Error
        ? `Gemini failed after ${MAX_ATTEMPTS} attempts: ${lastError.message}`
        : `Could not produce a non-duplicate quote after ${MAX_ATTEMPTS} attempts`
    );
  }

  return activateNewQuote(supabase, {
    quote: generated.quote,
    author: generated.author,
    source: opts.source,
    created_by: opts.createdBy,
  });
}

// Insert a new row, mark it active, and unset all previous active rows.
// The unique partial index on is_active means we must clear existing rows
// FIRST, then insert with is_active = TRUE.
export async function activateNewQuote(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    quote: string;
    author: string;
    source: "manual" | "ai_cron" | "ai_manual" | "seed";
    created_by: string | null;
  }
): Promise<MotivationalQuote> {
  const { error: clearErr } = await supabase
    .from("launcher_motivational_quotes")
    .update({ is_active: false })
    .eq("is_active", true);

  if (clearErr) {
    throw new Error(`Failed to clear active quote: ${clearErr.message}`);
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("launcher_motivational_quotes")
    .insert({
      quote: input.quote,
      author: input.author,
      source: input.source,
      is_active: true,
      activated_at: new Date().toISOString(),
      created_by: input.created_by,
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    throw new Error(insertErr?.message || "Failed to insert quote");
  }

  return inserted as MotivationalQuote;
}
