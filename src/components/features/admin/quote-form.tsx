"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MotivationalQuote } from "@/types/quote";

interface Props {
  quote?: MotivationalQuote | null;
  onSaved: () => void;
}

export function QuoteForm({ quote, onSaved }: Props) {
  const [text, setText] = useState(quote?.quote ?? "");
  const [author, setAuthor] = useState(quote?.author ?? "");
  const [activate, setActivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = quote ? `/api/quotes/${quote.id}` : "/api/quotes";
    const method = quote ? "PATCH" : "POST";
    const body = quote
      ? { quote: text, author }
      : { quote: text, author, activate };

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(
        typeof b.error === "string" ? b.error : "Failed to save"
      );
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="quote">Quote</Label>
        <Textarea
          id="quote"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          maxLength={400}
          rows={4}
          placeholder="The way to get started is to quit talking and begin doing."
        />
        <p className="text-xs text-muted-foreground">
          {text.length}/400 characters
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="author">Author</Label>
        <Input
          id="author"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          required
          maxLength={120}
          placeholder="Walt Disney"
        />
      </div>
      {!quote && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activate}
            onChange={(e) => setActivate(e.target.checked)}
          />
          Set as active quote now
        </label>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={saving || !text.trim() || !author.trim()}>
          {saving ? "Saving..." : quote ? "Save changes" : "Add quote"}
        </Button>
      </div>
    </form>
  );
}
