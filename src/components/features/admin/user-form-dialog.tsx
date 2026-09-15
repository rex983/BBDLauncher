"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Department, Office, UserProfile, UserRole } from "@/types/auth";

export interface LauncherRole {
  name: string;
  display_name: string;
}

const ALL_OFFICES: Office[] = ["Harbor", "Marion", "BST", "RnD"];
const ALL_DEPARTMENTS: Department[] = ["SALES TEAM", "BST", "RnD"];

interface FormState {
  email: string;
  name: string;
  role: UserRole;
  office: Office | "";
  department: Department | "";
  is_it: boolean;
}

const EMPTY_FORM: FormState = {
  email: "",
  name: "",
  role: "sales_rep",
  office: "",
  department: "",
  is_it: false,
};

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: UserProfile | null;
  roles: LauncherRole[];
  viewerIsAdmin: boolean;
  onSaved: () => void;
}

export function UserFormDialog({
  open,
  onOpenChange,
  editing,
  roles,
  viewerIsAdmin,
  onSaved,
}: UserFormDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setForm({
        email: editing.email,
        name: editing.name ?? "",
        role: editing.role,
        office: editing.office ?? "",
        department: editing.department ?? "",
        is_it: editing.is_it ?? false,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editing]);

  const assignableRoles = viewerIsAdmin
    ? roles
    : roles.filter((r) => r.name !== "admin");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const itChanged = editing ? form.is_it !== (editing.is_it ?? false) : form.is_it;

    const res = editing
      ? await fetch(`/api/users/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim() || null,
            role: form.role,
            office: form.office || null,
            department: form.department || null,
            ...(viewerIsAdmin && itChanged ? { is_it: form.is_it } : {}),
          }),
        })
      : await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: form.email.trim(),
            name: form.name.trim() || undefined,
            role: form.role,
            office: form.office || null,
            department: form.department || null,
            ...(viewerIsAdmin && form.is_it ? { is_it: true } : {}),
          }),
        });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Failed to save user");
      return;
    }

    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit User" : "Add User"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              disabled={!!editing}
              required
            />
            {!editing && (
              <p className="text-xs text-muted-foreground">
                User signs in with Google — no password needed.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-name">Name</Label>
            <Input
              id="user-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm({ ...form, role: v as UserRole })}
              disabled={!viewerIsAdmin && editing?.role === "admin"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {r.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!viewerIsAdmin && (
              <p className="text-xs text-muted-foreground">
                Only admins can grant or change the admin role.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Office</Label>
            <Select
              value={form.office || "__none__"}
              onValueChange={(v) =>
                setForm({ ...form, office: v === "__none__" ? "" : (v as Office) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No office" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No office</SelectItem>
                {ALL_OFFICES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Department</Label>
            <Select
              value={form.department || "__none__"}
              onValueChange={(v) =>
                setForm({ ...form, department: v === "__none__" ? "" : (v as Department) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No department</SelectItem>
                {ALL_DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2 font-normal">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input disabled:opacity-50"
                checked={form.is_it}
                disabled={!viewerIsAdmin}
                onChange={(e) => setForm({ ...form, is_it: e.target.checked })}
              />
              <span>IT — can handle BBD Help Desk tickets</span>
            </Label>
            {!viewerIsAdmin && (
              <p className="text-xs text-muted-foreground">
                Only admins can grant the IT capability.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : editing ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
