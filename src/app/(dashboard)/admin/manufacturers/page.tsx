"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { ManufacturerConfig } from "@/types/manufacturer";

type FormState = {
  name: string;
  sku: string;
  sign_now_template_id: string;
  active: boolean;
};

const emptyForm: FormState = {
  name: "",
  sku: "",
  sign_now_template_id: "",
  active: true,
};

/** "18%", "3 tiers", or "—" — read-only; deposits come from Strapi. */
function depositSummary(m: Pick<ManufacturerConfig, "deposit_percent" | "deposit_tiers">): string {
  if (m.deposit_tiers && m.deposit_tiers.length > 0) return `${m.deposit_tiers.length} tier${m.deposit_tiers.length === 1 ? "" : "s"}`;
  return m.deposit_percent != null ? `${m.deposit_percent}%` : "—";
}

export default function AdminManufacturersPage() {
  const [items, setItems] = useState<ManufacturerConfig[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ManufacturerConfig | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = async () => {
    const res = await fetch("/api/manufacturers");
    if (res.ok) setItems(await res.json());
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (m: ManufacturerConfig) => {
    setEditing(m);
    setForm({
      name: m.name,
      sku: m.sku ?? "",
      sign_now_template_id: m.sign_now_template_id ?? "",
      active: m.active,
    });
    setError(null);
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      sign_now_template_id: form.sign_now_template_id.trim(),
      active: form.active,
    };

    const res = await fetch(editing ? `/api/manufacturers/${editing.id}` : "/api/manufacturers", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Failed to save");
      return;
    }

    setDialogOpen(false);
    fetchItems();
  };

  const handleDelete = async (m: ManufacturerConfig) => {
    if (!confirm(`Delete ${m.name}? This cannot be undone.`)) return;
    const res = await fetch(`/api/manufacturers/${m.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to delete");
      return;
    }
    fetchItems();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manufacturers</h1>
          <p className="text-muted-foreground">
            Manage installer/manufacturer configs and SignNow templates. Deposits are managed in Strapi.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" />
              Add Manufacturer
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editing ? "Edit Manufacturer" : "Add Manufacturer"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="m-name">Name</Label>
                  <Input
                    id="m-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="m-sku">SKU</Label>
                  <Input
                    id="m-sku"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="m-template">SignNow Template ID</Label>
                <Input
                  id="m-template"
                  value={form.sign_now_template_id}
                  onChange={(e) =>
                    setForm({ ...form, sign_now_template_id: e.target.value })
                  }
                />
              </div>

              <div className="space-y-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2">
                <p className="text-sm font-medium">
                  Deposit{editing ? `: ${depositSummary(editing)}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Deposits are managed in Strapi — edit them there. They sync here automatically
                  through the Manufacturer Hub and can&apos;t be changed in the launcher.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="m-active"
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                <Label htmlFor="m-active">Active</Label>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end">
                <Button type="submit" disabled={saving || !form.name.trim()}>
                  {saving ? "Saving..." : editing ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Deposit</TableHead>
            <TableHead>SignNow Template</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">{m.name}</TableCell>
              <TableCell>{m.sku || "—"}</TableCell>
              <TableCell>
                {depositSummary(m)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {m.sign_now_template_id || "—"}
              </TableCell>
              <TableCell>
                <Badge variant={m.active ? "default" : "secondary"}>
                  {m.active ? "active" : "inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(m)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                No manufacturers yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
