"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Check,
  Download,
  HardDriveDownload,
  Plus,
  Printer,
  RotateCcw,
  ShieldOff,
  StickyNote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CASE_STATUS_LABEL,
  CASE_STATUS_VARIANT,
  EVENT_LABEL,
  OFFBOARDING_CATEGORIES,
  OFFBOARDING_REASON_LABEL,
  TASK_STATUS_LABEL,
  type CaseDetail,
  type OffboardingCategory,
  type OffboardingTask,
  type PersonRef,
  type TaskStatus,
} from "@/lib/offboarding/types";
import { fmtDay } from "./OffboardingListShell";

const UNASSIGNED = "__none";

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return typeof b.error === "string" ? b.error : "Something went wrong";
}

export function OffboardingCaseShell({
  initial,
  offboarders,
}: {
  initial: CaseDetail;
  offboarders: PersonRef[];
}) {
  const [detail, setDetail] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const c = detail.case;
  const isOpen = c.status === "open";
  const base = `/api/offboarding/cases/${c.id}`;

  const people = useMemo(() => {
    const m = new Map<string, PersonRef>();
    for (const p of [...detail.people, ...offboarders]) m.set(p.id, p);
    return m;
  }, [detail.people, offboarders]);
  const who = (id: string | null) => (id ? people.get(id)?.name || people.get(id)?.email || "Unknown" : "—");

  const reload = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }, [base]);

  // Runs a mutation, surfaces its error, then refreshes the case.
  const run = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    try {
      const err = await fn();
      if (err) alert(err);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const total = detail.tasks.length;
  const done = detail.tasks.filter((t) => t.status !== "pending").length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const tasksById = new Map(detail.tasks.map((t) => [t.id, t]));

  const setCaseStatus = (status: "open" | "completed" | "cancelled") => {
    const prompts = {
      completed: "Close this offboarding as completed?",
      cancelled: "Cancel this offboarding? (e.g. the employee is staying.) The record is kept.",
      open: "Reopen this offboarding?",
    };
    if (!confirm(prompts[status])) return;
    run("case", () => send(base, "PATCH", { status }));
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground print:hidden">
            <Link href="/offboarding" className="hover:underline">← Offboarding</Link>
          </div>
          <h1 className="text-2xl font-bold">{c.employee_name || c.employee_email}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{c.employee_email}</span>
            {c.employee_role && <Badge variant="secondary">{c.employee_role}</Badge>}
            {c.employee_office && <Badge variant="outline">{c.employee_office}</Badge>}
            {c.employee_department && <Badge variant="outline">{c.employee_department}</Badge>}
            <Badge variant={CASE_STATUS_VARIANT[c.status]}>{CASE_STATUS_LABEL[c.status]}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print record
          </Button>
          {isOpen ? (
            <>
              <Button variant="ghost" onClick={() => setCaseStatus("cancelled")} disabled={!!busy}>
                Cancel case
              </Button>
              <Button onClick={() => setCaseStatus("completed")} disabled={!!busy || done < total}>
                <Check className="mr-2 h-4 w-4" />
                Close as completed
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setCaseStatus("open")} disabled={!!busy}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reopen
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fact label="Last day" value={fmtDay(c.last_day)} />
        <Fact label="Reason" value={OFFBOARDING_REASON_LABEL[c.reason]} />
        <Fact
          label="Launcher account"
          value={detail.account === null ? "Profile deleted" : detail.account.is_active ? "Active" : "Deactivated"}
          tone={detail.account?.is_active ? "warn" : "ok"}
        />
        <Fact label="Progress" value={`${done} of ${total} · ${pct}%`} />
      </div>

      <div className="h-2 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="text-sm text-muted-foreground">
        Opened by {who(c.opened_by)} on {fmtWhen(c.created_at)}
        {c.closed_at && ` · ${c.status === "completed" ? "Closed" : "Cancelled"} by ${who(c.closed_by)} on ${fmtWhen(c.closed_at)}`}
        {c.notes && <p className="mt-2 whitespace-pre-wrap text-foreground">{c.notes}</p>}
      </div>

      {OFFBOARDING_CATEGORIES.map((cat) => {
        const tasks = detail.tasks.filter((t) => t.category === cat.value);
        if (tasks.length === 0) return null;
        return (
          <Card key={cat.value} className="break-inside-avoid">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{cat.label}</span>
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {tasks.filter((t) => t.status !== "pending").length}/{tasks.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  caseOpen={isOpen}
                  busy={busy === t.id}
                  offboarders={offboarders}
                  who={who}
                  onPatch={(body) => run(t.id, () => send(`${base}/tasks/${t.id}`, "PATCH", body))}
                  onAction={() => {
                    if (
                      t.auto_action === "deactivate_launcher" &&
                      !confirm(
                        `Deactivate ${c.employee_name || c.employee_email}'s launcher account now? They'll be signed out everywhere immediately.`,
                      )
                    ) {
                      return;
                    }
                    run(t.id, () => send(`${base}/actions`, "POST", { action: t.auto_action }));
                  }}
                />
              ))}
            </CardContent>
          </Card>
        );
      })}

      {isOpen && (
        <Button variant="outline" onClick={() => setAddOpen(true)} className="print:hidden">
          <Plus className="mr-2 h-4 w-4" />
          Add a task
        </Button>
      )}

      <Card className="break-inside-avoid">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Backups</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.exports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No launcher backups yet — run &ldquo;Back up launcher records&rdquo; above.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {detail.exports.map((f) => {
                const name = f.path.split("/").pop() as string;
                return (
                  <li key={f.path} className="flex items-center gap-2">
                    <HardDriveDownload className="h-4 w-4 text-muted-foreground" />
                    <a href={`${base}/exports/${encodeURIComponent(name)}`} className="hover:underline">
                      {name}
                    </a>
                    {f.size !== null && (
                      <span className="text-xs text-muted-foreground">
                        {(f.size / 1024).toFixed(1)} KB
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Stored privately with this case. Gmail and Drive backups are recorded in their task notes.
            Each download is logged below.
          </p>
        </CardContent>
      </Card>

      <Card className="break-inside-avoid">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Activity log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="print:hidden">From</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...detail.events].reverse().map((e) => {
                const taskTitle =
                  (e.details?.task as string | undefined) ??
                  (e.task_id ? tasksById.get(e.task_id)?.title : undefined);
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {fmtWhen(e.created_at)}
                    </TableCell>
                    <TableCell className="text-sm">{e.actor_name || who(e.actor_profile_id)}</TableCell>
                    <TableCell className="text-sm">
                      {EVENT_LABEL[e.event_type] ?? e.event_type}
                      {taskTitle && <span className="text-muted-foreground"> — {taskTitle}</span>}
                      <EventExtra type={e.event_type} details={e.details} who={who} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground print:hidden">
                      {e.actor_ip || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AddTaskDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={async (body) => {
          const err = await send(`${base}/tasks`, "POST", body);
          if (!err) await reload();
          return err;
        }}
      />
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-semibold",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "ok" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// Extra detail for log rows whose payload is worth reading inline.
function EventExtra({
  type,
  details,
  who,
}: {
  type: string;
  details: Record<string, unknown> | null;
  who: (id: string | null) => string;
}) {
  if (!details) return null;
  let text: string | null = null;
  if (type === "task_assigned") text = `to ${details.to ? who(details.to as string) : "nobody"}`;
  else if (type === "task_note" && details.note) text = `“${details.note as string}”`;
  else if (type === "launcher_deactivated" && details.clocked_out) text = "(also clocked them out)";
  else if (type === "data_exported" || type === "export_downloaded") text = (details.file as string) ?? null;
  else if (type === "case_updated" && Array.isArray(details.changes)) {
    text = (details.changes as Array<{ field: string }>).map((ch) => ch.field.replace("_", " ")).join(", ");
  }
  if (!text) return null;
  return <div className="text-xs text-muted-foreground">{text}</div>;
}

function TaskRow({
  task,
  caseOpen,
  busy,
  offboarders,
  who,
  onPatch,
  onAction,
}: {
  task: OffboardingTask;
  caseOpen: boolean;
  busy: boolean;
  offboarders: PersonRef[];
  who: (id: string | null) => string;
  onPatch: (body: { status?: TaskStatus; note?: string | null; assigned_to?: string | null }) => void;
  onAction: () => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(task.note ?? "");
  const pending = task.status === "pending";

  const openNoteEditor = () => {
    setNote(task.note ?? "");
    setEditingNote(true);
  };

  const complete = (status: TaskStatus) => {
    // Send the open draft with the status so a required note and the
    // completion land together.
    if (editingNote) {
      onPatch({ status, note: note || null });
      setEditingNote(false);
    } else if (task.requires_note && !task.note) openNoteEditor();
    else onPatch({ status });
  };

  return (
    <div className={cn("flex flex-col gap-2 px-6 py-4 md:flex-row md:items-start", !pending && "bg-muted/30")}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {!pending && <Check className="h-4 w-4 text-emerald-600" />}
          <span className={cn("font-medium", task.status === "not_applicable" && "line-through text-muted-foreground")}>
            {task.title}
          </span>
          <Badge variant="outline" className="text-[10px]">{task.system}</Badge>
          {task.requires_note && pending && (
            <Badge variant="secondary" className="text-[10px]">note required</Badge>
          )}
        </div>
        {task.instructions && (
          <p className="mt-1 text-sm text-muted-foreground">{task.instructions}</p>
        )}
        {!pending && (
          <p className="mt-1 text-xs text-muted-foreground">
            {TASK_STATUS_LABEL[task.status]} by {who(task.completed_by)}
            {task.completed_at && ` · ${fmtWhen(task.completed_at)}`}
          </p>
        )}
        {editingNote ? (
          <div className="mt-2 space-y-2 print:hidden">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={task.requires_note ? "Where was it saved / what changed?" : "Note"}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onPatch({ note: note || null });
                  setEditingNote(false);
                }}
                disabled={busy}
              >
                Save note
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingNote(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          task.note && (
            <p className="mt-1 whitespace-pre-wrap rounded bg-muted px-2 py-1 text-sm">{task.note}</p>
          )
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end print:hidden">
        <Select
          value={task.assigned_to ?? UNASSIGNED}
          onValueChange={(v) => onPatch({ assigned_to: v === UNASSIGNED ? null : v })}
          disabled={!caseOpen || busy}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {offboarders.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name || p.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {caseOpen && !editingNote && (
          <Button size="sm" variant="ghost" onClick={openNoteEditor} title="Add or edit note">
            <StickyNote className="h-4 w-4" />
          </Button>
        )}
        {caseOpen && pending && task.auto_action && (
          <Button size="sm" onClick={onAction} disabled={busy}>
            {task.auto_action === "deactivate_launcher" ? (
              <><ShieldOff className="mr-1 h-4 w-4" />Deactivate now</>
            ) : (
              <><Download className="mr-1 h-4 w-4" />Back up now</>
            )}
          </Button>
        )}
        {caseOpen && pending && !task.auto_action && (
          <Button size="sm" onClick={() => complete("done")} disabled={busy}>
            <Check className="mr-1 h-4 w-4" />Done
          </Button>
        )}
        {caseOpen && pending && (
          <Button size="sm" variant="outline" onClick={() => complete("not_applicable")} disabled={busy}>
            N/A
          </Button>
        )}
        {caseOpen && !pending && (
          <>
            {task.auto_action === "export_launcher_data" && (
              <Button size="sm" variant="outline" onClick={onAction} disabled={busy} title="Take another backup">
                <Download className="h-4 w-4" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onPatch({ status: "pending" })} disabled={busy}>
              <RotateCcw className="mr-1 h-4 w-4" />Undo
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function AddTaskDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (body: {
    title: string;
    system: string;
    category: OffboardingCategory;
    instructions: string | null;
    requires_note: boolean;
  }) => Promise<string | null>;
}) {
  const [title, setTitle] = useState("");
  const [system, setSystem] = useState("");
  const [category, setCategory] = useState<OffboardingCategory>("access");
  const [instructions, setInstructions] = useState("");
  const [requiresNote, setRequiresNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const err = await onAdd({ title, system, category, instructions: instructions || null, requires_note: requiresNote });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setTitle("");
    setSystem("");
    setInstructions("");
    setRequiresNote(false);
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a task to this case</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <ChecklistItemFields
            title={title}
            setTitle={setTitle}
            system={system}
            setSystem={setSystem}
            category={category}
            setCategory={setCategory}
            instructions={instructions}
            setInstructions={setInstructions}
            requiresNote={requiresNote}
            setRequiresNote={setRequiresNote}
          />
          <p className="text-xs text-muted-foreground">
            Only this case gets the task. To add it for everyone, edit the checklist template.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !title.trim() || !system.trim()}>
              {saving ? "Adding…" : "Add task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Shared by the add-task dialog and the checklist template editor.
export function ChecklistItemFields(props: {
  title: string;
  setTitle: (v: string) => void;
  system: string;
  setSystem: (v: string) => void;
  category: OffboardingCategory;
  setCategory: (v: OffboardingCategory) => void;
  instructions: string;
  setInstructions: (v: string) => void;
  requiresNote: boolean;
  setRequiresNote: (v: boolean) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="ci-title">Task</Label>
        <Input
          id="ci-title"
          value={props.title}
          onChange={(e) => props.setTitle(e.target.value)}
          placeholder="e.g. Remove from manufacturer portal"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="ci-system">System / place</Label>
          <Input
            id="ci-system"
            value={props.system}
            onChange={(e) => props.setSystem(e.target.value)}
            placeholder="e.g. Eagle portal"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Select value={props.category} onValueChange={(v) => props.setCategory(v as OffboardingCategory)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OFFBOARDING_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ci-instructions">Instructions</Label>
        <Textarea
          id="ci-instructions"
          rows={3}
          value={props.instructions}
          onChange={(e) => props.setInstructions(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.requiresNote}
          onChange={(e) => props.setRequiresNote(e.target.checked)}
        />
        Require a note to close (e.g. where a backup was saved)
      </label>
    </>
  );
}
