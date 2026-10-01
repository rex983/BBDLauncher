"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  OFFBOARDING_CATEGORIES,
  type ChecklistItem,
  type OffboardingCategory,
  type PersonRef,
} from "@/lib/offboarding/types";
import { ChecklistItemFields } from "./OffboardingCaseShell";

const UNASSIGNED = "__none";

export function ChecklistTemplateShell({
  initialItems,
  offboarders,
}: {
  initialItems: ChecklistItem[];
  offboarders: PersonRef[];
}) {
  const [items, setItems] = useState(initialItems);
  const [editing, setEditing] = useState<ChecklistItem | "new" | null>(null);
  const nameOf = (id: string | null) => {
    const p = offboarders.find((o) => o.id === id);
    return p ? p.name || p.email : null;
  };

  const reload = async () => {
    const res = await fetch("/api/offboarding/checklist", { cache: "no-store" });
    if (res.ok) setItems(await res.json());
  };

  const toggleActive = async (item: ChecklistItem) => {
    const res = await fetch(`/api/offboarding/checklist/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !item.is_active }),
    });
    if (!res.ok) alert("Failed to update");
    reload();
  };

  const remove = async (item: ChecklistItem) => {
    if (!confirm(`Delete "${item.title}" from the template? Existing cases keep their copy.`)) return;
    const res = await fetch(`/api/offboarding/checklist/${item.id}`, { method: "DELETE" });
    if (!res.ok) alert("Failed to delete");
    reload();
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">
            <Link href="/offboarding" className="hover:underline">← Offboarding</Link>
          </div>
          <h1 className="text-2xl font-bold">Offboarding checklist</h1>
          <p className="text-muted-foreground">
            Every new case starts from this list. A task to deactivate their launcher account, a
            task to back up their launcher records, and one task per launcher app they can open
            are added automatically. Changes here don&rsquo;t affect cases already open.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="mr-2 h-4 w-4" />
          Add item
        </Button>
      </div>

      {OFFBOARDING_CATEGORIES.map((cat) => {
        const rows = items.filter((i) => i.category === cat.value);
        return (
          <Card key={cat.value}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{cat.label}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {rows.length === 0 && (
                <p className="px-6 py-4 text-sm text-muted-foreground">No items.</p>
              )}
              {rows.map((item) => (
                <div
                  key={item.id}
                  className={cn("flex items-start gap-4 px-6 py-3", !item.is_active && "opacity-50")}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.title}</span>
                      <Badge variant="outline" className="text-[10px]">{item.system}</Badge>
                      {item.requires_note && (
                        <Badge variant="secondary" className="text-[10px]">note required</Badge>
                      )}
                      {nameOf(item.default_assignee) && (
                        <span className="text-xs text-muted-foreground">→ {nameOf(item.default_assignee)}</span>
                      )}
                    </div>
                    {item.instructions && (
                      <p className="mt-1 text-sm text-muted-foreground">{item.instructions}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(item)}>
                      {item.is_active ? "Disable" : "Enable"}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditing(item)} title="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(item)} title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {editing && (
        <ItemDialog
          key={editing === "new" ? "new" : editing.id}
          item={editing === "new" ? null : editing}
          nextOrder={Math.max(0, ...items.map((i) => i.display_order)) + 10}
          offboarders={offboarders}
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

function ItemDialog({
  item,
  nextOrder,
  offboarders,
  onClose,
  onSaved,
}: {
  item: ChecklistItem | null;
  nextOrder: number;
  offboarders: PersonRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [system, setSystem] = useState(item?.system ?? "");
  const [category, setCategory] = useState<OffboardingCategory>(item?.category ?? "access");
  const [instructions, setInstructions] = useState(item?.instructions ?? "");
  const [requiresNote, setRequiresNote] = useState(item?.requires_note ?? false);
  const [assignee, setAssignee] = useState(item?.default_assignee ?? UNASSIGNED);
  const [order, setOrder] = useState(String(item?.display_order ?? nextOrder));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(item ? `/api/offboarding/checklist/${item.id}` : "/api/offboarding/checklist", {
      method: item ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        system,
        category,
        instructions: instructions || null,
        requires_note: requiresNote,
        default_assignee: assignee === UNASSIGNED ? null : assignee,
        display_order: Number.parseInt(order, 10) || 0,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Failed to save");
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit checklist item" : "Add checklist item"}</DialogTitle>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Default owner</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {offboarders.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name || p.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci-order">Order</Label>
              <Input
                id="ci-order"
                type="number"
                min={0}
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !title.trim() || !system.trim()}>
              {saving ? "Saving…" : item ? "Update" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
