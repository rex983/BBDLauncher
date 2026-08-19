"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Department, Office, UserProfile, UserRole } from "@/types/auth";

interface LauncherRole {
  name: string;
  display_name: string;
}

const allOffices: Office[] = ["Harbor", "Marion", "BST", "RnD"];
const allDepartments: Department[] = ["SALES TEAM", "BST", "RnD"];

type FormState = {
  email: string;
  name: string;
  role: UserRole;
  office: Office | "";
  department: Department | "";
  is_it: boolean;
};

const emptyForm: FormState = {
  email: "",
  name: "",
  role: "sales_rep",
  office: "",
  department: "",
  is_it: false,
};

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const currentProfileId = session?.user?.profileId;
  const viewerIsAdmin = session?.user?.role === "admin";

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<LauncherRole[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignableRoles = viewerIsAdmin
    ? roles
    : roles.filter((r) => r.name !== "admin");

  const fetchUsers = async () => {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
  };

  const fetchRoles = async () => {
    const res = await fetch("/api/roles");
    if (res.ok) setRoles(await res.json());
  };

  useEffect(() => {
    fetchUsers();
    fetchRoles();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (user: UserProfile) => {
    setEditing(user);
    setForm({
      email: user.email,
      name: user.name ?? "",
      role: user.role,
      office: user.office ?? "",
      department: user.department ?? "",
      is_it: user.is_it ?? false,
    });
    setError(null);
    setDialogOpen(true);
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    const prev = users;
    setUsers((list) => list.map((u) => (u.id === userId ? { ...u, role } : u)));
    const res = await fetch(`/api/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      setUsers(prev);
      const body = await res.json().catch(() => ({}));
      alert(typeof body.error === "string" ? body.error : "Failed to change role");
    }
  };

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

    setDialogOpen(false);
    fetchUsers();
  };

  const handleDelete = async (user: UserProfile) => {
    if (!confirm(`Remove ${user.email}? They will lose access immediately.`)) return;
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Failed to delete user");
      return;
    }
    fetchUsers();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-muted-foreground">
            Invite users, edit names, change roles, and remove accounts.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          </DialogTrigger>
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
                    {allOffices.map((o) => (
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
                    {allDepartments.map((d) => (
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

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
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
            <TableHead>Email</TableHead>
            <TableHead>Office</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Added</TableHead>
            <TableHead>Change Role</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const isSelf = user.id === currentProfileId;
            const targetIsAdmin = user.role === "admin";
            const lockedByRole = !viewerIsAdmin && targetIsAdmin;
            const editDisabled = lockedByRole;
            const deleteDisabled = isSelf || lockedByRole;
            const deleteTitle = isSelf
              ? "You cannot remove yourself"
              : lockedByRole
                ? "Only admins can remove an admin account"
                : "Remove user";
            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name || "—"}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  {user.office ? (
                    <Badge variant="outline">{user.office}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {user.department ? (
                    <Badge variant="outline">{user.department}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary">{user.role}</Badge>
                    {user.is_it && <Badge>IT</Badge>}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(user.created_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </TableCell>
                <TableCell>
                  <Select
                    value={user.role}
                    onValueChange={(v) => handleRoleChange(user.id, v as UserRole)}
                    disabled={lockedByRole}
                  >
                    <SelectTrigger className="w-[150px]">
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
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={editDisabled}
                      title={editDisabled ? "Only admins can edit an admin account" : "Edit user"}
                      onClick={() => openEdit(user)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={deleteDisabled}
                      title={deleteTitle}
                      onClick={() => handleDelete(user)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {users.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                No users yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
