"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  GripVertical,
  HardDriveDownload,
  Loader,
  ListRestart,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  ShieldOff,
  StickyNote,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CASE_STATUS_LABEL,
  CASE_STATUS_VARIANT,
  EVENT_LABEL,
  OFFBOARDING_REASON_LABEL,
  TASK_STATUS_LABEL,
  isOpenTask,
  type CaseDetail,
  type OffboardingTask,
  type PersonRef,
  type TaskStatus,
} from "@/lib/offboarding/types";
import { fmtDay } from "./OffboardingListShell";
import { EMPTY_DRAFT, ItemFields, type ItemDraft } from "./ItemFields";
import { iid, isSection, moveAcrossSections, raw, sectionsAndTasksCollision, sid } from "./dnd";

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

export function OffboardingCaseShell({ initial, isAdmin }: { initial: CaseDetail; isAdmin: boolean }) {
  const [detail, setDetail] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  // Section the "Add task" dialog is adding to.
  const [addTo, setAddTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<OffboardingTask | null>(null);
  const c = detail.case;
  const isOpen = c.status === "open";
  const base = `/api/offboarding/cases/${c.id}`;

  const people = useMemo(() => {
    const m = new Map<string, PersonRef>();
    for (const p of detail.people) m.set(p.id, p);
    return m;
  }, [detail.people]);
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
  const done = detail.tasks.filter((t) => !isOpenTask(t.status)).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const tasksById = new Map(detail.tasks.map((t) => [t.id, t]));
  const sections = detail.sections;
  const [newSection, setNewSection] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Saves a drag; the server mirrors it to the checklist.
  const saveLayout = (nextSections: string[], nextTasks: OffboardingTask[]) =>
    run("layout", () =>
      send(`${base}/layout`, "PUT", {
        sections: nextSections,
        tasks: nextTasks.map((t) => ({ id: t.id, section: t.section })),
      }),
    );

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || isSection(active.id)) return;
    const next = moveAcrossSections(
      detail.tasks,
      active.id,
      over.id,
      (t) => t.section,
      (t, section) => ({ ...t, section }),
    );
    if (next) setDetail((d) => ({ ...d, tasks: next }));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (isSection(active.id)) {
      if (!over || active.id === over.id) return;
      const from = sections.indexOf(raw(active.id));
      const to = sections.indexOf(raw(over.id));
      if (from < 0 || to < 0) return;
      const next = arrayMove(sections, from, to);
      setDetail((d) => ({ ...d, sections: next }));
      saveLayout(next, detail.tasks);
      return;
    }
    let next = detail.tasks;
    if (over && !isSection(over.id) && active.id !== over.id) {
      const from = next.findIndex((t) => t.id === raw(active.id));
      const to = next.findIndex((t) => t.id === raw(over.id));
      if (from >= 0 && to >= 0) next = arrayMove(next, from, to);
    }
    setDetail((d) => ({ ...d, tasks: next }));
    // Always save — onDragOver may already have changed the section.
    saveLayout(sections, next);
  };

  const removeSection = (name: string) => {
    if (
      !confirm(
        `Remove the "${name}" section? Its unfinished tasks are removed from this case, and the section is removed from the checklist so future offboardings don't get it. Finished tasks stay on this case.`,
      )
    ) {
      return;
    }
    run("layout", () => send(`${base}/sections`, "DELETE", { name }));
  };

  const addSection = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSection.trim();
    if (!name) return;
    if (sections.includes(name)) {
      alert("There's already a section with that name.");
      return;
    }
    setNewSection("");
    run("layout", () => send("/api/offboarding/sections", "POST", { name }));
  };

  const setCaseStatus = (status: "open" | "completed" | "cancelled") => {
    const prompts = {
      completed: "Close this offboarding as completed?",
      cancelled: "Cancel this offboarding? (e.g. the employee is staying.) The record is kept.",
      open: "Reopen this offboarding?",
    };
    if (!confirm(prompts[status])) return;
    run("case", () => send(base, "PATCH", { status }));
  };

  const matchChecklist = () => {
    if (
      !confirm(
        "Make this case match the checklist? Sections, order and wording are updated, missing checklist tasks are added, and pending tasks the checklist doesn't have are removed. Finished tasks are kept.",
      )
    ) {
      return;
    }
    run("case", () => send(`${base}/sync`, "POST"));
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
          {isAdmin && isOpen && (
            <Button variant="outline" onClick={matchChecklist} disabled={!!busy}>
              <ListRestart className="mr-2 h-4 w-4" />
              Match checklist
            </Button>
          )}
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

      <DndContext
        sensors={sensors}
        collisionDetection={sectionsAndTasksCollision}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={sections.map(sid)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {sections.map((section) => {
              const tasks = detail.tasks.filter((t) => t.section === section);
              return (
                <CaseSection
                  key={section}
                  name={section}
                  tasks={tasks}
                  editable={isOpen}
                  onRemove={() => removeSection(section)}
                  onAdd={() => setAddTo(section)}
                >
                  {tasks.map((t) => (
                    <SortableTask key={t.id} id={t.id} editable={isOpen}>
                      <TaskRow
                        task={t}
                        caseOpen={isOpen}
                        busy={busy === t.id}
                        who={who}
                        onPatch={(body) => run(t.id, () => send(`${base}/tasks/${t.id}`, "PATCH", body))}
                        onEdit={isAdmin ? () => setEditing(t) : undefined}
                        onDelete={() => {
                          if (!confirm(`Remove "${t.title}" from this case? The log keeps a record of it.`)) return;
                          // Per-app tasks aren't on the checklist; everything else can go from both.
                          const fromChecklist =
                            !t.app_id &&
                            confirm(`Also remove "${t.title}" from the checklist, so future offboardings don't get it?`);
                          run(t.id, () =>
                            send(`${base}/tasks/${t.id}${fromChecklist ? "?from_checklist=1" : ""}`, "DELETE"),
                          );
                        }}
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
                    </SortableTask>
                  ))}
                </CaseSection>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {isOpen && (
        <form onSubmit={addSection} className="flex max-w-md gap-2 print:hidden">
          <Input
            placeholder="New section, e.g. Manufacturer portals"
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!newSection.trim() || !!busy}>
            <Plus className="mr-1 h-4 w-4" />
            Add section
          </Button>
        </form>
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
        section={addTo}
        onClose={() => setAddTo(null)}
        onAdd={async (body) => {
          const err = await send(`${base}/tasks`, "POST", body);
          if (!err) await reload();
          return err;
        }}
      />

      {editing && (
        <EditTaskDialog
          key={editing.id}
          task={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const err = await send(`${base}/tasks/${editing.id}`, "PATCH", body);
            if (!err) await reload();
            return err;
          }}
        />
      )}
    </div>
  );
}

// A section on the case page: drag by its grip, remove it, add tasks to it.
function CaseSection({
  name,
  tasks,
  editable,
  onRemove,
  onAdd,
  children,
}: {
  name: string;
  tasks: OffboardingTask[];
  editable: boolean;
  onRemove: () => void;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sid(name),
    disabled: !editable,
  });
  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "break-inside-avoid gap-0 py-0",
        isDragging && "relative z-10 shadow-lg ring-2 ring-primary/30",
        tasks.length === 0 && "print:hidden",
      )}
    >
      <CardHeader className="border-b px-4 py-2.5">
        <CardTitle className="flex items-center gap-2 text-sm">
          {editable && (
            <button
              {...attributes}
              {...listeners}
              type="button"
              className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing print:hidden"
              aria-label="Drag section"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <span className="flex-1">{name}</span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {tasks.filter((t) => !isOpenTask(t.status)).length}/{tasks.length}
          </span>
          {editable && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 print:hidden"
              onClick={onRemove}
              title="Remove section"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <SortableContext items={tasks.map((t) => iid(t.id))} strategy={verticalListSortingStrategy}>
        <CardContent className="min-h-[2.25rem] divide-y p-0">
          {children}
          {tasks.length === 0 && (
            <p className="px-4 py-2 text-sm text-muted-foreground">No tasks — drag one here or add one.</p>
          )}
        </CardContent>
      </SortableContext>
      {editable && (
        <div className="border-t px-2 py-1 print:hidden">
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={onAdd}>
            <Plus className="mr-1 h-4 w-4" />
            Add task
          </Button>
        </div>
      )}
    </Card>
  );
}

// A task row with a drag grip on the left.
function SortableTask({ id, editable, children }: { id: string; editable: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: iid(id),
    disabled: !editable,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-start bg-card", isDragging && "relative z-10 shadow-md ring-2 ring-primary/30")}
    >
      {editable && (
        <button
          {...attributes}
          {...listeners}
          type="button"
          className="mt-2 cursor-grab pl-2 text-muted-foreground hover:text-foreground active:cursor-grabbing print:hidden"
          aria-label="Drag task"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
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
  // task_assigned only appears on cases from before assignments were removed.
  if (type === "task_assigned") text = `to ${details.to ? who(details.to as string) : "nobody"}`;
  else if (type === "task_note" && details.note) text = `“${details.note as string}”`;
  else if (type === "launcher_deactivated" && details.clocked_out) text = "(also clocked them out)";
  else if (type === "data_exported" || type === "export_downloaded") text = (details.file as string) ?? null;
  else if (type === "task_edited" && Array.isArray(details.changes)) {
    text = `${(details.changes as string[]).join(", ").replace("_", " ")}${details.to_checklist ? " · also on the checklist" : ""}`;
  } else if (type === "task_deleted" && details.from_checklist) text = "also removed from the checklist";
  else if (type === "task_added" && details.added_to_checklist) text = "also added to the checklist";
  else if (type === "task_moved") text = `${details.from as string} → ${details.to as string}`;
  else if (type === "section_removed") {
    const removed = Array.isArray(details.removed) ? details.removed.length : 0;
    text = `${details.section as string}${removed ? ` · ${removed} task${removed === 1 ? "" : "s"} removed` : ""}`;
  } else if (type === "case_synced") {
    const removed = Array.isArray(details.removed) ? details.removed.length : 0;
    text = `${details.added ?? 0} added, ${removed} removed`;
  } else if (type === "case_updated" && Array.isArray(details.changes)) {
    text = (details.changes as Array<{ field: string }>).map((ch) => ch.field.replace("_", " ")).join(", ");
  }
  if (!text) return null;
  return <div className="text-xs text-muted-foreground">{text}</div>;
}

function TaskRow({
  task,
  caseOpen,
  busy,
  who,
  onPatch,
  onEdit,
  onDelete,
  onAction,
}: {
  task: OffboardingTask;
  caseOpen: boolean;
  busy: boolean;
  who: (id: string | null) => string;
  onPatch: (body: { status?: TaskStatus; note?: string | null }) => void;
  /** Admins only. */
  onEdit?: () => void;
  onDelete: () => void;
  onAction: () => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(task.note ?? "");
  // "open" = still to do (pending or in progress).
  const pending = isOpenTask(task.status);
  const started = task.status === "in_progress";

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

  const doneBy = started
    ? `Started by ${who(task.started_by)}${task.started_at ? ` · ${fmtWhen(task.started_at)}` : ""}`
    : pending
      ? null
      : `${TASK_STATUS_LABEL[task.status]} by ${who(task.completed_by)}${task.completed_at ? ` · ${fmtWhen(task.completed_at)}` : ""}`;

  // One line per task on screen; instructions, who did it and notes show on
  // hover and in the printed record.
  return (
    <div className={cn("px-4 py-1.5", !pending && "bg-muted/30", started && "bg-amber-50 dark:bg-amber-950/30")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span title={doneBy ?? undefined} className="flex w-4 shrink-0 justify-center">
          {!pending && <Check className="h-4 w-4 text-emerald-600" />}
          {started && <Loader className="h-4 w-4 text-amber-600" />}
        </span>
        <span
          title={task.instructions ?? undefined}
          className={cn(
            "min-w-0 flex-1 text-sm",
            !pending && "text-muted-foreground",
            task.status === "not_applicable" && "line-through",
          )}
        >
          {task.title}
          {started && (
            <span className="ml-2 text-[10px] font-medium uppercase text-amber-600">in progress</span>
          )}
          {task.requires_note && pending && !task.note && (
            <span className="ml-2 text-[10px] font-medium uppercase text-amber-600">note required</span>
          )}
        </span>
        <div className="flex items-center gap-1 print:hidden">
        {caseOpen && onEdit && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} title="Edit wording">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        {caseOpen && !editingNote && (
          <Button
            size="icon"
            variant="ghost"
            className={cn("h-7 w-7", task.note && "text-primary")}
            onClick={openNoteEditor}
            title={task.note ? `Note: ${task.note}` : "Add a note"}
          >
            <StickyNote className="h-3.5 w-3.5" />
          </Button>
        )}
        {caseOpen && pending && task.auto_action && (
          <Button size="sm" className="h-7 px-2 text-xs" onClick={onAction} disabled={busy}>
            {task.auto_action === "deactivate_launcher" ? (
              <><ShieldOff className="mr-1 h-3.5 w-3.5" />Deactivate now</>
            ) : (
              <><Download className="mr-1 h-3.5 w-3.5" />Back up now</>
            )}
          </Button>
        )}
        {caseOpen && task.status === "pending" && !task.auto_action && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onPatch({ status: "in_progress" })} disabled={busy}>
            <Loader className="mr-1 h-3.5 w-3.5" />In progress
          </Button>
        )}
        {caseOpen && pending && !task.auto_action && (
          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => complete("done")} disabled={busy}>
            <Check className="mr-1 h-3.5 w-3.5" />Done
          </Button>
        )}
        {caseOpen && pending && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => complete("not_applicable")} disabled={busy}>
            N/A
          </Button>
        )}
        {caseOpen && started && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onPatch({ status: "pending" })} disabled={busy} title="Back to not started">
            <RotateCcw className="mr-1 h-3.5 w-3.5" />Undo
          </Button>
        )}
        {caseOpen && !pending && (
          <>
            {task.auto_action === "export_launcher_data" && (
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onAction} disabled={busy} title="Take another backup">
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onPatch({ status: "pending" })} disabled={busy}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />Undo
            </Button>
          </>
        )}
        {caseOpen && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDelete} disabled={busy} title="Remove from this case">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
        </div>
      </div>

      {editingNote && (
        <div className="mt-1.5 space-y-2 pl-6 print:hidden">
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
              className="h-7 text-xs"
              onClick={() => {
                onPatch({ note: note || null });
                setEditingNote(false);
              }}
              disabled={busy}
            >
              Save note
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingNote(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Printed record keeps the full detail. */}
      <div className="hidden pl-6 text-xs text-muted-foreground print:block">
        {task.system && <div>{task.system}</div>}
        {task.instructions && <div>{task.instructions}</div>}
        {doneBy && <div>{doneBy}</div>}
        {task.note && <div className="text-foreground">Note: {task.note}</div>}
      </div>
    </div>
  );
}

function AddTaskDialog({
  section,
  onClose,
  onAdd,
}: {
  section: string | null;
  onClose: () => void;
  onAdd: (body: {
    section: string;
    title: string;
    system: string | null;
    instructions: string | null;
    requires_note: boolean;
    add_to_checklist: boolean;
  }) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [toChecklist, setToChecklist] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setDraft(EMPTY_DRAFT);
    setToChecklist(true);
    setError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!section) return;
    setSaving(true);
    const err = await onAdd({
      section,
      title: draft.title,
      system: draft.system || null,
      instructions: draft.instructions || null,
      requires_note: draft.requiresNote,
      add_to_checklist: toChecklist,
    });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    close();
  };

  return (
    <Dialog open={section !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a task to {section}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <ItemFields draft={draft} onChange={setDraft} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={toChecklist} onChange={(e) => setToChecklist(e.target.checked)} />
            Also add to the checklist, so every offboarding gets it
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !draft.title.trim()}>
              {saving ? "Adding…" : "Add task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Admin: reword a task. By default the change also goes to the checklist so
// future offboardings read the same.
function EditTaskDialog({
  task,
  onClose,
  onSave,
}: {
  task: OffboardingTask;
  onClose: () => void;
  onSave: (body: {
    title: string;
    system: string | null;
    instructions: string | null;
    requires_note: boolean;
    apply_to_checklist: boolean;
  }) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<ItemDraft>({
    title: task.title,
    system: task.system ?? "",
    instructions: task.instructions ?? "",
    requiresNote: task.requires_note,
  });
  // Per-app tasks are generated, not checklist items.
  const linkable = !task.app_id;
  const [toChecklist, setToChecklist] = useState(linkable);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const err = await onSave({
      title: draft.title,
      system: draft.system || null,
      instructions: draft.instructions || null,
      requires_note: draft.requiresNote,
      apply_to_checklist: linkable && toChecklist,
    });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <ItemFields draft={draft} onChange={setDraft} />
          {linkable && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={toChecklist} onChange={(e) => setToChecklist(e.target.checked)} />
              Also update the checklist, so every offboarding reads the same
            </label>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !draft.title.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
