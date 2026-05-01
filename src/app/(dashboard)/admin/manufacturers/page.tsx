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
import { Plus, Pencil, Trash2, X } from "lucide-react";
import type { ManufacturerConfig, DepositTier } from "@/types/manufacturer";

type FormState = {
  name: string;
  sku: string;
  sign_now_template_id: string;
  deposit_percent: string;
  deposit_tiers: DepositTier[];
  active: boolean;
};

const emptyForm: FormState = {
  name: "",
  sku: "",
  sign_now_template_id: "",
  deposit_percent: "",
  deposit_tiers: [],
  active: true,
};

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
      deposit_percent: m.deposit_percent != null ? String(m.deposit_percent) : "",
      deposit_tiers: m.deposit_tiers ?? [],
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
      deposit_percent: form.deposit_percent ? Number(form.deposit_percent) : null,
      deposit_tiers: form.deposit_tiers.length > 0 ? form.deposit_tiers : null,
      active: form.active,
    };

    const res = editing
      ? await fetch(`/api/manufacturers/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/manufacturers", {
          method: "POST",
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

  const addTier = () => {
    setForm({
      ...form,
      deposit_tiers: [...form.deposit_tiers, { upTo: null, percent: 30 }],
    });
  };

  const updateTier = (idx: number, field: keyof DepositTier, value: string) => {
    const next = [...form.deposit_tiers];
    if (field === "upTo") {
      next[idx] = { ...next[idx], upTo: value === "" ? null : Number(value) };
    } else {
      next[idx] = { ...next[idx], percent: Number(value) };
    }
    setForm({ ...form, deposit_tiers: next });
  };

  const removeTier = (idx: number) => {
    setForm({
      ...form,
      deposit_tiers: form.deposit_tiers.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manufacturers</h1>
          <p className="text-muted-foreground">
            Manage installer/manufacturer configs, deposit tiers, and SignNow templates.
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

              <div className="space-y-2">
                <Label htmlFor="m-deposit">Default Deposit Percent</Label>
                <Input
                  id="m-deposit"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.deposit_percent}
                  onChange={(e) =>
                    setForm({ ...form, deposit_percent: e.target.value })
                  }
                  placeholder="e.g. 30"
                />
                <p className="text-xs text-muted-foreground">
                  Used when no tier matches. Leave blank if tiers cover everything.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Deposit Tiers</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addTier}>
                    <Plus className="h-3 w-3 mr-1" /> Add Tier
                  </Button>
                </div>
                {form.deposit_tiers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No tiers. Default deposit percent applies.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {form.deposit_tiers.map((tier, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <div className="flex-1">
                          <Input
                            type="number"
                            placeholder="Up to (subtotal)"
                            value={tier.upTo ?? ""}
                            onChange={(e) => updateTier(idx, "upTo", e.target.value)}
                          />
                        </div>
                        <div className="w-24">
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="%"
                            value={tier.percent}
                            onChange={(e) => updateTier(idx, "percent", e.target.value)}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeTier(idx)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Leave &ldquo;Up to&rdquo; blank for the catch-all tier.
                    </p>
                  </div>
                )}
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
                {m.deposit_tiers && m.deposit_tiers.length > 0
                  ? `${m.deposit_tiers.length} tier${m.deposit_tiers.length === 1 ? "" : "s"}`
                  : m.deposit_percent != null
                  ? `${m.deposit_percent}%`
                  : "—"}
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
