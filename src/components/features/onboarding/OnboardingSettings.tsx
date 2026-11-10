"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PeoplePicker } from "@/components/features/admin/people-picker";
import type { TemplateTask } from "@/lib/onboarding/types";

async function readError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : fallback;
}

// Admin: the default checklist every new hire starts with. "Add task" puts
// a task on the end; open requests keep the list they were opened with.
export function ChecklistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [tasks, setTasks] = useState<TemplateTask[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetch("/api/onboarding/template", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setTasks)
      .catch(() => setError("Couldn't load the checklist"));
  }, [open]);

  const send = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    setBusy(false);
    if (!res.ok) {
      setError(await readError(res, "Couldn't save"));
      return false;
    }
    setTasks(await res.json());
    return true;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (await send("/api/onboarding/template", { method: "POST", body: JSON.stringify({ title }) })) setTitle("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Default checklist</DialogTitle>
          <DialogDescription>Every new hire starts with these tasks. Requests already open aren&apos;t changed.</DialogDescription>
        </DialogHeader>

        <form onSubmit={add} className="flex gap-2">
          <Input
            autoFocus
            placeholder="New task, e.g. Order business cards"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          <Button type="submit" disabled={busy || !title.trim()}>
            <Plus className="mr-1 h-4 w-4" />
            Add task
          </Button>
        </form>

        {tasks === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {tasks.map((t, i) => (
              <li key={t.id} className="flex items-center gap-1 py-1 pl-3 pr-1">
                <span className="flex-1 truncate">{t.title}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={busy || i === 0}
                  onClick={() => send(`/api/onboarding/template/${t.id}`, { method: "PATCH", body: JSON.stringify({ move: "up" }) })}
                  aria-label={`Move ${t.title} up`}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={busy || i === tasks.length - 1}
                  onClick={() => send(`/api/onboarding/template/${t.id}`, { method: "PATCH", body: JSON.stringify({ move: "down" }) })}
                  aria-label={`Move ${t.title} down`}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={busy}
                  onClick={() => send(`/api/onboarding/template/${t.id}`, { method: "DELETE" })}
                  aria-label={`Remove ${t.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

// Admin: who gets tagged in Slack (and a bell) when a manager submits a new hire.
export function TaggingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setIds(null);
    fetch("/api/onboarding/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => setIds(b.tag_profile_ids))
      .catch(() => setError("Couldn't load who's tagged"));
  }, [open]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/onboarding/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_profile_ids: ids ?? [] }),
    });
    setSaving(false);
    if (!res.ok) return setError(await readError(res, "Couldn't save"));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Who gets tagged</DialogTitle>
          <DialogDescription>
            When a manager submits a new hire, these people are tagged in Slack and get a bell notification.
            Nobody picked: every admin gets the bell and Slack is skipped.
          </DialogDescription>
        </DialogHeader>
        {ids === null ? (
          <p className="text-sm text-muted-foreground">{error ? "" : "Loading…"}</p>
        ) : (
          <PeoplePicker value={ids} onChange={setIds} />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || ids === null}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
