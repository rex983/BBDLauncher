"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, GripVertical } from "lucide-react";
import type { LauncherSection } from "@/types/app";

function SortableRow({
  section,
  onEdit,
  onDelete,
}: {
  section: LauncherSection;
  onEdit: (s: LauncherSection) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 border rounded-md px-3 py-2 bg-background ${
        isDragging ? "shadow-lg ring-2 ring-primary/30 opacity-90" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 font-medium">{section.name}</span>
      <Button variant="ghost" size="icon" onClick={() => onEdit(section)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onDelete(section.id)}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function AdminSectionsPage() {
  const [sections, setSections] = useState<LauncherSection[]>([]);
  const [editing, setEditing] = useState<LauncherSection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const fetchSections = async () => {
    const res = await fetch("/api/sections");
    if (res.ok) setSections(await res.json());
  };

  useEffect(() => {
    fetchSections();
  }, []);

  const openNew = () => {
    setEditing(null);
    setName("");
    setDialogOpen(true);
  };

  const openEdit = (section: LauncherSection) => {
    setEditing(section);
    setName(section.name);
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const res = editing
      ? await fetch(`/api/sections/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        })
      : await fetch("/api/sections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
    setSaving(false);
    if (res.ok) {
      setDialogOpen(false);
      fetchSections();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this section? Apps in it will move to Unsorted.")) return;
    await fetch(`/api/sections/${id}`, { method: "DELETE" });
    fetchSections();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const previous = sections;
    const oldIndex = sections.findIndex((s) => s.id === active.id);
    const newIndex = sections.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(sections, oldIndex, newIndex);
    setSections(reordered);
    try {
      const res = await fetch("/api/sections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orders: reordered.map((s, idx) => ({ id: s.id, display_order: idx })),
        }),
      });
      if (!res.ok) throw new Error(`reorder ${res.status}`);
    } catch {
      setSections(previous);
      alert("Couldn't save the new order — reverted.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manage Sections</h1>
          <p className="text-muted-foreground">
            Organize apps into groups. Drag to reorder.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" />
              New Section
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editing ? "Rename Section" : "New Section"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="section-name">Name</Label>
                <Input
                  id="section-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : editing ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {sections.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          No sections yet. Create one to start organizing apps.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sections.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {sections.map((section) => (
                <SortableRow
                  key={section.id}
                  section={section}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
