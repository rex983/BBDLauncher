"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Check, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TEMPLATE_AUTO_LABEL,
  type ChecklistItem,
  type OffboardingSection,
} from "@/lib/offboarding/types";
import { EMPTY_DRAFT, ItemFields, type ItemDraft } from "./ItemFields";

// Drag ids are prefixed so sections and items can share one DndContext.
const sid = (id: string) => `s:${id}`;
const iid = (id: string) => `i:${id}`;
const raw = (dragId: string | number) => String(dragId).slice(2);
const isSection = (dragId: string | number) => String(dragId).startsWith("s:");

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

// Sections only collide with sections. Items prefer the item under the
// pointer, then the section under it (so empty sections accept drops).
const collision: CollisionDetection = (args) => {
  if (isSection(args.active.id)) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => isSection(c.id)),
    });
  }
  const items = args.droppableContainers.filter((c) => !isSection(c.id));
  const overItem = pointerWithin({ ...args, droppableContainers: items });
  if (overItem.length) return overItem;
  const overSection = pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => isSection(c.id)),
  });
  if (overSection.length) return overSection;
  return closestCenter({ ...args, droppableContainers: items });
};

export function ChecklistTemplateShell({
  initialSections,
  initialItems,
}: {
  initialSections: OffboardingSection[];
  initialItems: ChecklistItem[];
}) {
  const [sections, setSections] = useState(initialSections);
  // Flat list; an item's position within its section is its order here.
  const [items, setItems] = useState(initialItems);
  const [editing, setEditing] = useState<{ item: ChecklistItem | null; sectionId: string } | null>(null);
  const [newSection, setNewSection] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reload = async () => {
    const res = await fetch("/api/offboarding/checklist", { cache: "no-store" });
    if (!res.ok) return;
    const t = await res.json();
    setSections(t.sections);
    setItems(t.items);
  };

  const mutate = async (fn: () => Promise<string | null>) => {
    const err = await fn();
    if (err) alert(err);
    await reload();
  };

  const saveOrder = async (nextSections: OffboardingSection[], nextItems: ChecklistItem[]) => {
    const err = await send("/api/offboarding/checklist/reorder", "PUT", {
      sections: nextSections.map((s) => s.id),
      items: nextItems.map((i) => ({ id: i.id, section_id: i.section_id })),
    });
    if (err) {
      alert(err);
      reload();
    }
  };

  // Moving an item into another section happens while dragging, so the
  // list opens up under the pointer.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || isSection(active.id)) return;
    const itemId = raw(active.id);
    const target = isSection(over.id) ? raw(over.id) : items.find((i) => i.id === raw(over.id))?.section_id;
    const current = items.find((i) => i.id === itemId);
    if (!target || !current || current.section_id === target) return;
    setItems((prev) => {
      const moving = { ...current, section_id: target };
      const rest = prev.filter((i) => i.id !== itemId);
      const at = isSection(over.id) ? -1 : rest.findIndex((i) => i.id === raw(over.id));
      if (at < 0) return [...rest, moving];
      return [...rest.slice(0, at), moving, ...rest.slice(at)];
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (isSection(active.id)) {
      if (!over || active.id === over.id) return;
      const from = sections.findIndex((s) => s.id === raw(active.id));
      const to = sections.findIndex((s) => s.id === raw(over.id));
      if (from < 0 || to < 0) return;
      const next = arrayMove(sections, from, to);
      setSections(next);
      saveOrder(next, items);
      return;
    }
    let next = items;
    if (over && !isSection(over.id) && active.id !== over.id) {
      const from = items.findIndex((i) => i.id === raw(active.id));
      const to = items.findIndex((i) => i.id === raw(over.id));
      if (from >= 0 && to >= 0) next = arrayMove(items, from, to);
    }
    setItems(next);
    // Always save — onDragOver may already have changed the section.
    saveOrder(sections, next);
  };

  const addSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSection.trim()) return;
    await mutate(() => send("/api/offboarding/sections", "POST", { name: newSection.trim() }));
    setNewSection("");
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <div className="text-sm text-muted-foreground">
          <Link href="/offboarding" className="hover:underline">← Offboarding</Link>
        </div>
        <h1 className="text-2xl font-bold">Offboarding checklist</h1>
        <p className="text-muted-foreground">
          Every new case starts from this list. Drag sections and tasks to reorder them, or drag a
          task into another section. Changes don&rsquo;t affect cases already open.
        </p>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <SortableContext items={sections.map((s) => sid(s.id))} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                items={items.filter((i) => i.section_id === section.id)}
                onRename={(name) =>
                  mutate(() => send(`/api/offboarding/sections/${section.id}`, "PATCH", { name }))
                }
                onDelete={() => {
                  const n = items.filter((i) => i.section_id === section.id).length;
                  if (!confirm(`Delete "${section.name}"${n ? ` and its ${n} task${n === 1 ? "" : "s"}` : ""}? Open cases keep their copy.`)) return;
                  mutate(() => send(`/api/offboarding/sections/${section.id}`, "DELETE"));
                }}
                onAdd={() => setEditing({ item: null, sectionId: section.id })}
                onEdit={(item) => setEditing({ item, sectionId: item.section_id })}
                onToggle={(item) =>
                  mutate(() => send(`/api/offboarding/checklist/${item.id}`, "PUT", { is_active: !item.is_active }))
                }
                onRemove={(item) => {
                  if (!confirm(`Delete "${item.title}"? Open cases keep their copy.`)) return;
                  mutate(() => send(`/api/offboarding/checklist/${item.id}`, "DELETE"));
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <form onSubmit={addSection} className="flex max-w-md gap-2">
        <Input
          placeholder="New section, e.g. Manufacturer portals"
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!newSection.trim()}>
          <Plus className="mr-2 h-4 w-4" />
          Add section
        </Button>
      </form>

      {editing && (
        <ItemDialog
          key={editing.item?.id ?? `new-${editing.sectionId}`}
          item={editing.item}
          sectionId={editing.sectionId}
          sections={sections}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function SectionCard({
  section,
  items,
  onRename,
  onDelete,
  onAdd,
  onEdit,
  onToggle,
  onRemove,
}: {
  section: OffboardingSection;
  items: ChecklistItem[];
  onRename: (name: string) => void;
  onDelete: () => void;
  onAdd: () => void;
  onEdit: (item: ChecklistItem) => void;
  onToggle: (item: ChecklistItem) => void;
  onRemove: (item: ChecklistItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sid(section.id),
  });
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section.name);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-lg border bg-card", isDragging && "z-10 shadow-lg ring-2 ring-primary/30")}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <button
          {...attributes}
          {...listeners}
          type="button"
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Drag section"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        {renaming ? (
          <form
            className="flex flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== section.name) onRename(name.trim());
              setRenaming(false);
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" autoFocus />
            <Button type="submit" size="icon" variant="ghost" title="Save">
              <Check className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title="Cancel"
              onClick={() => {
                setName(section.name);
                setRenaming(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <>
            <span className="flex-1 font-semibold">{section.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
            <Button size="icon" variant="ghost" onClick={() => setRenaming(true)} title="Rename section">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete} title="Delete section">
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <SortableContext items={items.map((i) => iid(i.id))} strategy={verticalListSortingStrategy}>
        <div className="min-h-[3rem] divide-y">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onEdit={() => onEdit(item)}
              onToggle={() => onToggle(item)}
              onRemove={() => onRemove(item)}
            />
          ))}
          {items.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No tasks — drag one here or add one.</p>
          )}
        </div>
      </SortableContext>

      <div className="border-t px-4 py-2">
        <Button size="sm" variant="ghost" onClick={onAdd}>
          <Plus className="mr-1 h-4 w-4" />
          Add task
        </Button>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onEdit,
  onToggle,
  onRemove,
}: {
  item: ChecklistItem;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: iid(item.id),
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-3 bg-card px-4 py-3",
        !item.is_active && "opacity-50",
        isDragging && "relative z-10 shadow-md ring-2 ring-primary/30",
      )}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        className="mt-0.5 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Drag task"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.title}</span>
          {item.system && <Badge variant="outline" className="text-[10px]">{item.system}</Badge>}
          {item.auto_action && (
            <Badge variant="secondary" className="text-[10px]">{TEMPLATE_AUTO_LABEL[item.auto_action]}</Badge>
          )}
          {item.requires_note && <Badge variant="secondary" className="text-[10px]">note required</Badge>}
        </div>
        {item.instructions && <p className="mt-1 text-sm text-muted-foreground">{item.instructions}</p>}
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {item.is_active ? "Disable" : "Enable"}
        </Button>
        <Button size="icon" variant="ghost" onClick={onEdit} title="Edit">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onRemove} title="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ItemDialog({
  item,
  sectionId,
  sections,
  onClose,
  onSaved,
}: {
  item: ChecklistItem | null;
  sectionId: string;
  sections: OffboardingSection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(
    item
      ? {
          title: item.title,
          system: item.system ?? "",
          instructions: item.instructions ?? "",
          requiresNote: item.requires_note,
        }
      : EMPTY_DRAFT,
  );
  const [section, setSection] = useState(sectionId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const err = await send(
      item ? `/api/offboarding/checklist/${item.id}` : "/api/offboarding/checklist",
      item ? "PUT" : "POST",
      {
        section_id: section,
        title: draft.title,
        system: draft.system || null,
        instructions: draft.instructions || null,
        requires_note: draft.requiresNote,
      },
    );
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit task" : "Add task"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <ItemFields draft={draft} onChange={setDraft} />
          <div className="space-y-2">
            <Label>Section</Label>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {item?.auto_action && (
            <p className="text-xs text-muted-foreground">
              Built-in step — the launcher runs it itself. You can reword it, move it or delete it.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !draft.title.trim()}>
              {saving ? "Saving…" : item ? "Update" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
