"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { QuoteForm } from "@/components/features/admin/quote-form";
import type { MotivationalQuote, QuoteSource } from "@/types/quote";
import { Plus, Pencil, Trash2, Sparkles, CheckCircle2 } from "lucide-react";

const SOURCE_LABEL: Record<QuoteSource, string> = {
  manual: "Manual",
  ai_cron: "AI (weekly)",
  ai_manual: "AI (on-demand)",
  seed: "Seed",
};

const SOURCE_VARIANT: Record<QuoteSource, "default" | "secondary" | "outline"> = {
  manual: "outline",
  ai_cron: "secondary",
  ai_manual: "secondary",
  seed: "outline",
};

export default function AdminQuotesPage() {
  const [quotes, setQuotes] = useState<MotivationalQuote[]>([]);
  const [editing, setEditing] = useState<MotivationalQuote | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/quotes");
    if (res.ok) setQuotes(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleActivate(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/quotes/${id}/activate`, { method: "POST" });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || "Failed to activate");
    }
    await load();
    setBusyId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this quote? This cannot be undone.")) return;
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/quotes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || "Failed to delete");
    }
    await load();
    setBusyId(null);
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const res = await fetch("/api/quotes/refresh", { method: "POST" });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || "Failed to generate");
    }
    await load();
    setGenerating(false);
  }

  const handleSaved = () => {
    setDialogOpen(false);
    setEditing(null);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Motivational Quotes</h1>
          <p className="text-muted-foreground">
            Shown on every user&apos;s dashboard. Auto-refreshes every Monday
            at 8 AM Eastern; you can also refresh or edit manually.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleGenerate}
            disabled={generating}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {generating ? "Generating..." : "Generate with AI"}
          </Button>
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setEditing(null);
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Quote
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Edit Quote" : "New Quote"}
                </DialogTitle>
              </DialogHeader>
              <QuoteForm quote={editing} onSaved={handleSaved} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">Active</TableHead>
            <TableHead>Quote</TableHead>
            <TableHead className="w-[180px]">Author</TableHead>
            <TableHead className="w-[130px]">Source</TableHead>
            <TableHead className="w-[160px]">Activated</TableHead>
            <TableHead className="w-[140px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotes.map((q) => (
            <TableRow key={q.id} className={q.is_active ? "bg-muted/30" : ""}>
              <TableCell>
                {q.is_active ? (
                  <Badge className="gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Live
                  </Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === q.id}
                    onClick={() => handleActivate(q.id)}
                  >
                    Activate
                  </Button>
                )}
              </TableCell>
              <TableCell className="max-w-[500px]">
                <span className="italic">&ldquo;{q.quote}&rdquo;</span>
              </TableCell>
              <TableCell>{q.author}</TableCell>
              <TableCell>
                <Badge variant={SOURCE_VARIANT[q.source]}>
                  {SOURCE_LABEL[q.source]}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {q.activated_at
                  ? new Date(q.activated_at).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditing(q);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busyId === q.id || q.is_active}
                    onClick={() => handleDelete(q.id)}
                    title={q.is_active ? "Activate another quote first" : "Delete"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {quotes.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-8 text-center text-muted-foreground"
              >
                No quotes yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
