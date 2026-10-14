"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEPARTMENT_NAME_RE, OFFICE_NAME_RE, type OrgItem } from "@/lib/org/constants";

type Kind = "offices" | "departments";

const COPY: Record<Kind, { title: string; singular: string; blurb: string; hint: string; example: string }> = {
  offices: {
    title: "Offices",
    singular: "Office",
    blurb:
      "Offices every app on the launcher shares: people, the app access grid, links, memos and other apps' office settings.",
    hint: "Letters and digits only, 2–30 characters. Can't be changed later.",
    example: "e.g. Tampa",
  },
  departments: {
    title: "Departments",
    singular: "Department",
    blurb: "Departments every app on the launcher shares: people, time data scopes and memos.",
    hint: "Uppercase letters, digits and spaces, 2–30 characters. Can't be changed later.",
    example: "e.g. CUSTOMER CARE",
  },
};

interface FormState {
  name: string;
  display_name: string;
  sort_order: string;
}

const EMPTY: FormState = { name: "", display_name: "", sort_order: "" };

/** Admin list for launcher_offices / launcher_departments (migration 051). */
export function OrgListShell({
  kind,
  initial,
  people,
  missing,
}: {
  kind: Kind;
  initial: OrgItem[];
  /** Active people per name. */
  people: Record<string, number>;
  /** The table doesn't exist yet (migration 051 not applied). */
  missing: boolean;
}) {
  const copy = COPY[kind];
  const router = useRouter();
  const [items, setItems] = useState<OrgItem[]>(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OrgItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameValid = (kind === "offices" ? OFFICE_NAME_RE : DEPARTMENT_NAME_RE).test(form.name.trim());

  const refresh = async () => {
    const res = await fetch(`/api/${kind}`);
    if (res.ok) setItems(await res.json());
    router.refresh();
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    setOpen(true);
  };

  const openEdit = (item: OrgItem) => {
    setEditing(item);
    setForm({ name: item.name, display_name: item.display_name, sort_order: String(item.sort_order) });
    setError(null);
    setOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const sortOrder = form.sort_order.trim() === "" ? undefined : Number(form.sort_order);
    const res = editing
      ? await fetch(`/api/${kind}/${encodeURIComponent(editing.name)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ display_name: form.display_name.trim(), sort_order: sortOrder }),
        })
      : await fetch(`/api/${kind}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            display_name: form.display_name.trim() || form.name.trim(),
            sort_order: sortOrder,
          }),
        });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Failed to save");
      return;
    }
    setOpen(false);
    refresh();
  };

  const remove = async (item: OrgItem) => {
    if (!confirm(`Delete ${copy.singular.toLowerCase()} "${item.display_name}"? Every app stops offering it.`)) return;
    const res = await fetch(`/api/${kind}/${encodeURIComponent(item.name)}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(typeof body.error === "string" ? body.error : "Failed to delete");
      return;
    }
    refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{copy.title}</h1>
          <p className="text-muted-foreground">{copy.blurb}</p>
        </div>
        <Button onClick={openNew} disabled={missing}>
          <Plus className="mr-2 h-4 w-4" />
          Add {copy.singular}
        </Button>
      </div>

      {missing && (
        <p className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-200">
          The {kind} table doesn&apos;t exist yet. Apply database migration 051 to manage {kind} here;
          until then every app uses the built-in list.
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${copy.singular}` : `Add ${copy.singular}`}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name (stored value)</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={(e) =>
                  setForm({
                    ...form,
                    name: kind === "departments" ? e.target.value.toUpperCase() : e.target.value,
                  })
                }
                placeholder={copy.example}
                disabled={!!editing}
                required
              />
              <p className="text-xs text-muted-foreground">{copy.hint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-display">Display name</Label>
              <Input
                id="org-display"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder={form.name || copy.example}
                required={!!editing}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-order">Sort order</Label>
              <Input
                id="org-order"
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                placeholder="After the others"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={saving || (editing ? !form.display_name.trim() : !nameValid)}
              >
                {saving ? "Saving..." : editing ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Display name</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>People</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const count = people[item.name] || 0;
            return (
              <TableRow key={item.name}>
                <TableCell className="font-mono text-sm">{item.name}</TableCell>
                <TableCell className="font-medium">{item.display_name}</TableCell>
                <TableCell className="text-muted-foreground">{item.sort_order}</TableCell>
                <TableCell>
                  <Badge variant="outline">{count}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={missing}
                      title="Edit display name and order"
                      onClick={() => openEdit(item)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={missing || count > 0}
                      title={count > 0 ? `${count} people are in it` : "Delete (only when nothing uses it)"}
                      onClick={() => remove(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                No {kind} yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
