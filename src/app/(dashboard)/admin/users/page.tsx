"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { UserFormDialog, type LauncherRole } from "@/components/features/admin/user-form-dialog";
import { UserRow } from "@/components/features/admin/user-row";
import { UserSection } from "@/components/features/admin/user-section";
import type { UserProfile, UserRole as UserRoleType } from "@/types/auth";

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const currentProfileId = session?.user?.profileId;
  const viewerIsAdmin = session?.user?.role === "admin";

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<LauncherRole[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [inactiveCollapsed, setInactiveCollapsed] = useState(true);
  const [activeCollapsed, setActiveCollapsed] = useState(false);

  const fetchUsers = async () => {
    // Admins always fetch the full list so both sections are populated.
    // Managers get active-only from the API.
    const url = viewerIsAdmin ? "/api/users?includeInactive=1" : "/api/users";
    const res = await fetch(url);
    if (res.ok) setUsers(await res.json());
  };

  const fetchRoles = async () => {
    const res = await fetch("/api/roles");
    if (res.ok) setRoles(await res.json());
  };

  useEffect(() => {
    fetchUsers();
    fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerIsAdmin]);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (user: UserProfile) => {
    setEditing(user);
    setDialogOpen(true);
  };

  const handleRoleChange = async (userId: string, role: UserRoleType) => {
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

  const handleToggleActive = async (user: UserProfile) => {
    const next = !user.is_active;
    const verb = next ? "Reactivate" : "Deactivate";
    const consequence = next
      ? "They'll be able to sign in again."
      : "They'll be signed out and lose access across all apps.";
    if (!confirm(`${verb} ${user.email}? ${consequence}`)) return;
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(typeof body.error === "string" ? body.error : `Failed to ${verb.toLowerCase()} user`);
      return;
    }
    fetchUsers();
  };

  const activeUsers = users.filter((u) => u.is_active !== false);
  const inactiveUsers = users.filter((u) => u.is_active === false);

  const rowFor = (user: UserProfile) => (
    <UserRow
      key={user.id}
      user={user}
      currentProfileId={currentProfileId}
      viewerIsAdmin={viewerIsAdmin}
      roles={roles}
      onRoleChange={handleRoleChange}
      onEdit={openEdit}
      onToggleActive={handleToggleActive}
      onDelete={handleDelete}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-muted-foreground">
            Invite users, edit names, change roles, and remove accounts.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      <UserFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        roles={roles}
        viewerIsAdmin={viewerIsAdmin}
        onSaved={fetchUsers}
      />

      <UserSection
        title="Active"
        count={activeUsers.length}
        collapsed={activeCollapsed}
        onToggle={() => setActiveCollapsed((v) => !v)}
        emptyMessage="No active users."
        isEmpty={activeUsers.length === 0}
      >
        {activeUsers.map(rowFor)}
      </UserSection>

      {viewerIsAdmin && (
        <UserSection
          title="Inactive"
          count={inactiveUsers.length}
          collapsed={inactiveCollapsed}
          onToggle={() => setInactiveCollapsed((v) => !v)}
          emptyMessage="No inactive users."
          isEmpty={inactiveUsers.length === 0}
        >
          {inactiveUsers.map(rowFor)}
        </UserSection>
      )}
    </div>
  );
}
