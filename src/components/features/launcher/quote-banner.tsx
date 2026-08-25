"use client";

import { useState } from "react";
import { RefreshCw, Quote as QuoteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MotivationalQuote } from "@/types/quote";

interface Props {
  initial: MotivationalQuote | null;
  canRefresh: boolean;
}

export function QuoteBanner({ initial, canRefresh }: Props) {
  const [quote, setQuote] = useState<MotivationalQuote | null>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/quotes/refresh", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const next = (await res.json()) as MotivationalQuote;
      setQuote(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  if (!quote) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <div className="flex items-start gap-3">
        <QuoteIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <p className="text-sm italic leading-snug">
            &ldquo;{quote.quote}&rdquo;
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            — {quote.author}
          </p>
          {error && (
            <p className="mt-1 text-xs text-destructive">{error}</p>
          )}
        </div>
        {canRefresh && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Generate a new quote"
            aria-label="Refresh motivational quote"
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
            />
          </Button>
        )}
      </div>
    </div>
  );
}
