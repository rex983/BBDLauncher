"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface LauncherRole {
  name: string;
  display_name: string;
  description: string | null;
  is_admin: boolean;
}

interface Counts {
  users: Record<string, number>;
  apps: Record<string, number>;
}

type FormState = {
  name: string;
  display_name: string;
  description: string;
};

const emptyForm: FormState = { name: "", display_name: "", description: "" };

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<LauncherRole[]>([]);
  const [counts, setCounts] = useState<Counts>({ users: {}, apps: {} });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LauncherRole | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    const [rolesRes, usersRes, appsRes] = await Promise.all([
      fetch("/api/roles"),
      fetch("/api/users"),
      fetch("/api/apps"),
    ]);
    if (rolesRes.ok) setRoles(await rolesRes.json());

    const userCounts: Record<string, number> = {};
    if (usersRes.ok) {
      const users = await usersRes.json();
      for (const u of users) userCounts[u.role] = (userCounts[u.role] || 0) + 1;
    }
    const appCounts: Record<string, number> = {};
    if (appsRes.ok) {
      const apps = await appsRes.json();
      for (const a of apps) {
        for (const r of a.roles || []) appCounts[r] = (appCounts[r] || 0) + 1;
      }
    }
    setCounts({ users: userCounts, apps: appCounts });
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (role: LauncherRole) => {
    setEditing(role);
    setForm({
      name: role.name,
      display_name: role.display_name,
      description: role.description ?? "",
    });
    setError(null);
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const res = editing
      ? await fetch(`/api/roles/${editing.name}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: form.display_name.trim(),
            description: form.description.trim() || null,
          }),
        })
      : await fetch("/api/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim().toLowerCase(),
            display_name: form.display_name.trim(),
            description: form.description.trim() || null,
          }),
        });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Failed to save");
      return;
    }

    setDialogOpen(false);
    fetchAll();
  };

  const handleDelete = async (role: LauncherRole) => {
    if (!confirm(`Delete role "${role.display_name}"? Apps assigned to this role will lose that access tag.`))
      return;
    const res = await fetch(`/api/roles/${role.name}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to delete");
      return;
    }
    fetchAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles</h1>
          <p className="text-muted-foreground">
            Custom roles tag which apps users see. Admin and manager retain
            their hardcoded launcher permissions; new roles are app-access
            labels only.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" />
              Add Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Role" : "Add Role"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="role-name">Name (identifier)</Label>
                <Input
                  id="role-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. office_manager"
                  disabled={!!editing}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, digits, underscores. Cannot be changed after
                  creation.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role-display">Display name</Label>
                <Input
                  id="role-display"
                  value={form.display_name}
                  onChange={(e) =>
                    setForm({ ...form, display_name: e.target.value })
                  }
                  placeholder="Office Manager"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role-desc">Description</Label>
                <Textarea
                  id="role-desc"
                  rows={2}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    saving ||
                    !form.display_name.trim() ||
                    (!editing && !form.name.trim())
                  }
                >
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
            <TableHead>Display Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead>Users</TableHead>
            <TableHead>Apps</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => {
            const isReserved = role.name === "admin";
            const userCount = counts.users[role.name] || 0;
            const canDelete = !isReserved && userCount === 0;
            const deleteTitle = isReserved
              ? "The admin role can't be deleted"
              : userCount > 0
                ? `${userCount} user(s) still have this role`
                : "Delete role";
            return (
              <TableRow key={role.name}>
                <TableCell className="font-mono text-sm">{role.name}</TableCell>
                <TableCell className="font-medium">{role.display_name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {role.description || "—"}
                </TableCell>
                <TableCell>
                  {role.is_admin ? (
                    <Badge>admin</Badge>
                  ) : role.name === "manager" ? (
                    <Badge variant="secondary">manager</Badge>
                  ) : (
                    <Badge variant="outline">app-access</Badge>
                  )}
                </TableCell>
                <TableCell>{userCount}</TableCell>
                <TableCell>{counts.apps[role.name] || 0}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(role)}
                      title="Edit display name and description"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!canDelete}
                      title={deleteTitle}
                      onClick={() => handleDelete(role)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {roles.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                No roles yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
