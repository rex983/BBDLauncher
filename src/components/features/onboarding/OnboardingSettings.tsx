"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PeoplePicker } from "@/components/features/admin/people-picker";
import type { TemplateTask } from "@/lib/onboarding/types";

async function readError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : fallback;
}

// Admin: the default checklist. "Add task" puts a task on the end; every
// change also updates open requests (syncOpenRequests).
export function ChecklistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [tasks, setTasks] = useState<TemplateTask[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The item whose default people are being picked.
  const [picking, setPicking] = useState<TemplateTask | null>(null);

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
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Default checklist</DialogTitle>
          <DialogDescription>
            Every new hire gets these tasks, including requests already open. Removing a task keeps it on requests
            where it&apos;s already ticked. Assign who does each task: it applies to every new hire whose task
            isn&apos;t done yet. They&apos;re told when the manager presses Notify on Slack on the new hire.
          </DialogDescription>
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
              <li key={t.id} className="py-1 pl-3 pr-1">
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    disabled={busy}
                    onClick={() => setPicking(picking?.id === t.id ? null : t)}
                  >
                    <UserPlus className="mr-1 h-3.5 w-3.5" />
                    {t.assignees.length ? "Change" : "Assign"}
                  </Button>
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
                </div>
                {t.assignees.length > 0 && picking?.id !== t.id && (
                  <div className="flex flex-wrap gap-1 pb-1">
                    {t.assignees.map((a) => (
                      <Badge key={a.id} variant="secondary">
                        {a.name}
                      </Badge>
                    ))}
                  </div>
                )}
                {picking?.id === t.id && (
                  <div className="space-y-2 py-2 pr-2">
                    <PeoplePicker
                      value={picking.assignee_ids}
                      onChange={(ids) => setPicking({ ...picking, assignee_ids: ids })}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPicking(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await send(`/api/onboarding/template/${picking.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ assignee_ids: picking.assignee_ids }),
                          });
                          if (ok) setPicking(null);
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                )}
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
            When a manager submits a new hire, these people are tagged in Slack and get a bell notification
            to create the profiles. Later steps are tagged from each checklist item instead.
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
