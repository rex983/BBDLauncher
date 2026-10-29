"use client";

import { useState } from "react";
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
import { BUILTIN_ROLES, MANAGER_TIER_ROLES, isActsAsTarget } from "@/lib/auth/permissions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CachedRole } from "@/lib/launcher/cache";

type LauncherRole = CachedRole;

export interface RoleCounts {
  users: Record<string, number>;
  apps: Record<string, number>;
}

type FormState = {
  name: string;
  display_name: string;
  description: string;
  /** NONE = least privilege. */
  acts_as: string;
  /** Create only; NONE = start with no app access. */
  copy_access_from: string;
  /** Launcher shows only the time clock + granted apps (migration 062). */
  apps_only: boolean;
};

const NONE = "__none__";

// Same rule as /api/roles: profiles.role and the access grid key on it.
const ROLE_NAME_RE = /^[a-z][a-z0-9_]{1,30}$/;

/** "Sales Support" -> "sales_support". */
function roleIdFrom(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 31);
}
const emptyForm: FormState = {
  name: "",
  display_name: "",
  description: "",
  acts_as: NONE,
  copy_access_from: NONE,
  apps_only: false,
};

export function RolesShell({ initial, counts }: { initial: LauncherRole[]; counts: RoleCounts }) {
  const [roles, setRoles] = useState<LauncherRole[]>(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LauncherRole | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The identifier follows the display name until someone edits it by hand.
  const [nameEdited, setNameEdited] = useState(false);
  const nameInvalid = !editing && !!form.name.trim() && !ROLE_NAME_RE.test(form.name.trim());

  // Counts come from the server render. A role mutation only adds a role
  // (zero users/apps), renames one or deletes one, so refetching the role
  // list alone keeps the table right.
  const fetchAll = async () => {
    const res = await fetch("/api/roles");
    if (res.ok) setRoles(await res.json());
  };

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setNameEdited(false);
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (role: LauncherRole) => {
    setEditing(role);
    setForm({
      name: role.name,
      display_name: role.display_name,
      description: role.description ?? "",
      acts_as: role.acts_as ?? NONE,
      copy_access_from: NONE,
      apps_only: role.apps_only,
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
            // Only when changed, so edits work before migration 062 adds the column.
            ...(form.apps_only !== editing.apps_only ? { apps_only: form.apps_only } : {}),
            // Built-in roles keep their own permissions.
            ...(BUILTIN_ROLES.has(editing.name)
              ? {}
              : { acts_as: form.acts_as === NONE ? null : form.acts_as }),
          }),
        })
      : await fetch("/api/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim().toLowerCase(),
            display_name: form.display_name.trim(),
            description: form.description.trim() || null,
            acts_as: form.acts_as === NONE ? null : form.acts_as,
            copy_access_from: form.copy_access_from === NONE ? null : form.copy_access_from,
            apps_only: form.apps_only,
          }),
        });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Failed to save");
      return;
    }

    const saved = await res.json().catch(() => ({}));
    if (typeof saved.warning === "string") alert(saved.warning);
    setDialogOpen(false);
    fetchAll();
  };

  const actsAsOptions = roles.filter((r) => isActsAsTarget(r.name));
  const labelOf = (name: string | null) =>
    (name && roles.find((r) => r.name === name)?.display_name) || name;
  const editingBuiltin = !!editing && BUILTIN_ROLES.has(editing.name);

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
            Roles decide which apps people see (the access grid on each app) and,
            in every app, what they may do. A new role has the least privilege
            unless you give it &ldquo;Permissions like&rdquo; a built-in role.
            Changes reach every app within a minute.
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
                  onChange={(e) => {
                    setNameEdited(true);
                    setForm({ ...form, name: e.target.value });
                  }}
                  placeholder="e.g. office_manager"
                  disabled={!!editing}
                  required
                />
                <p className={nameInvalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                  {nameInvalid
                    ? "Use lowercase letters, digits and underscores, starting with a letter (e.g. sales_support)."
                    : "Lowercase letters, digits, underscores. Filled in from the display name. Cannot be changed after creation."}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role-display">Display name</Label>
                <Input
                  id="role-display"
                  value={form.display_name}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      display_name: e.target.value,
                      ...(!editing && !nameEdited ? { name: roleIdFrom(e.target.value) } : {}),
                    })
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

              <div className="space-y-2">
                <Label>Permissions like</Label>
                {editingBuiltin ? (
                  <p className="text-sm text-muted-foreground">
                    Built-in role: it keeps its own permissions.
                  </p>
                ) : (
                  <>
                    <Select
                      value={form.acts_as}
                      onValueChange={(v) => setForm({ ...form, acts_as: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No one (least privilege)</SelectItem>
                        {actsAsOptions.map((r) => (
                          <SelectItem key={r.name} value={r.name}>
                            {r.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      What people with this role may do inside the launcher and every
                      app. Never grants admin.
                    </p>
                  </>
                )}
              </div>

              {editing?.name !== "admin" && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      id="role-apps-only"
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={form.apps_only}
                      onChange={(e) => setForm({ ...form, apps_only: e.target.checked })}
                    />
                    <Label htmlFor="role-apps-only">Apps only</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The launcher shows only the time clock and the apps you give this
                    role. No links, memos, time off or profile. Good for trainees.
                  </p>
                </div>
              )}

              {!editing && (
                <div className="space-y-2">
                  <Label>Copy app access from</Label>
                  <Select
                    value={form.copy_access_from}
                    onValueChange={(v) => setForm({ ...form, copy_access_from: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Nothing (no apps yet)</SelectItem>
                      {roles.map((r) => (
                        <SelectItem key={r.name} value={r.name}>
                          {r.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Starts the role with the same apps, office by office. Adjust each
                    app&apos;s access grid afterwards.
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    saving ||
                    !form.display_name.trim() ||
                    (!editing && !form.name.trim()) ||
                    nameInvalid
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
                  ) : MANAGER_TIER_ROLES.has(role.name) ? (
                    <Badge variant="secondary">manager tier</Badge>
                  ) : role.acts_as ? (
                    <Badge variant="secondary">like {labelOf(role.acts_as)}</Badge>
                  ) : BUILTIN_ROLES.has(role.name) ? (
                    <Badge variant="outline">built-in</Badge>
                  ) : (
                    <Badge variant="outline">least privilege</Badge>
                  )}
                  {role.apps_only && (
                    <Badge variant="secondary" className="ml-1">apps only</Badge>
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
                      title="Edit display name, description and permissions"
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
