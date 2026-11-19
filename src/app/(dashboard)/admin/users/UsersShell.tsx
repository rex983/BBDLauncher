"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { MoreHorizontal, Pencil, Plus, Search, Trash2, UserCheck, UserRound, UserX, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortHeader } from "@/components/ui/sort-header";
import { useSortableRows } from "@/lib/hooks/use-sortable-rows";
import { cn } from "@/lib/utils";
import { orgLabel, type OrgItem } from "@/lib/org/constants";
import { fmtDateUS } from "@/components/shared/format";
import { UserFormDialog, type LauncherRole } from "@/components/features/admin/user-form-dialog";
import { useUserActions } from "@/components/features/admin/user-actions";
import { PersonAvatar } from "@/components/features/people/person-avatar";
import { usePersonPeek } from "@/components/features/people/person-peek";
import type { UserProfile, UserRole } from "@/types/auth";

// Roles, offices and departments come from the server render (launcher_roles /
// launcher_offices / launcher_departments), so managers never need the
// admin-only /api/roles.

type Status = "active" | "inactive";
type SortKey = "name" | "office" | "department" | "role" | "created";
const ALL = "__all__";
const NONE = "__none__";

const SORTERS: Record<SortKey, (u: UserProfile) => string | Date | null> = {
  name: (u) => (u.name || u.email).toLowerCase(),
  office: (u) => u.office,
  department: (u) => u.department,
  role: (u) => u.role,
  created: (u) => new Date(u.created_at),
};

export function UsersShell({
  roles,
  offices,
  departments,
}: {
  roles: LauncherRole[];
  offices: OrgItem[];
  departments: OrgItem[];
}) {
  const { data: session, status: sessionStatus } = useSession();
  const currentProfileId = session?.user?.profileId;
  const viewerIsAdmin = session?.user?.permRole === "admin";
  const peek = usePersonPeek();

  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserProfile | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [office, setOffice] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [role, setRole] = useState(ALL);

  const fetchUsers = useCallback(async () => {
    // Admins always fetch the full list so the Inactive tab is populated.
    // Managers get active-only from the API.
    const res = await fetch(viewerIsAdmin ? "/api/users?includeInactive=1" : "/api/users").catch(() => null);
    if (res?.ok) {
      setUsers(await res.json());
      setLoadError(null);
    } else {
      setLoadError("Couldn't load users. Refresh to try again.");
    }
  }, [viewerIsAdmin]);

  // Wait for the session so admins don't fetch the active-only list first
  // and then refetch the full one once their role resolves.
  useEffect(() => {
    if (sessionStatus === "loading") return;
    fetchUsers();
  }, [sessionStatus, fetchUsers]);

  const actions = useUserActions(fetchUsers);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (user: UserProfile) => {
    setEditing(user);
    setDialogOpen(true);
  };

  const handleRoleChange = async (user: UserProfile, next: UserRole) => {
    if (next === user.role) return;
    const prev = users;
    setNotice(null);
    setUsers((list) => (list ?? []).map((u) => (u.id === user.id ? { ...u, role: next } : u)));
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setUsers(prev);
      const body = (await res?.json().catch(() => ({}))) ?? {};
      setNotice(
        `${user.name || user.email}'s role wasn't changed: ${typeof body.error === "string" ? body.error : "try again."}`,
      );
      return;
    }
    // What this viewer may do to them can change with the role.
    fetchUsers();
  };

  const all = useMemo(() => users ?? [], [users]);
  const activeCount = all.filter((u) => u.is_active !== false).length;
  const inactiveCount = all.length - activeCount;

  const inStatus = useMemo(
    () => all.filter((u) => (status === "active" ? u.is_active !== false : u.is_active === false)),
    [all, status],
  );
  const officeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of inStatus) m.set(u.office ?? NONE, (m.get(u.office ?? NONE) ?? 0) + 1);
    return m;
  }, [inStatus]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inStatus.filter((u) => {
      if (office !== ALL && (u.office ?? NONE) !== office) return false;
      if (department !== ALL && (u.department ?? NONE) !== department) return false;
      if (role !== ALL && u.role !== role) return false;
      if (!needle) return true;
      return (u.name ?? "").toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle);
    });
  }, [inStatus, q, office, department, role]);

  const { sorted, sort, toggle } = useSortableRows<UserProfile, SortKey>(filtered, SORTERS, {
    key: "name",
    direction: "asc",
  });

  const filtering = !!q.trim() || office !== ALL || department !== ALL || role !== ALL;
  const clearFilters = () => {
    setQ("");
    setOffice(ALL);
    setDepartment(ALL);
    setRole(ALL);
  };

  const assignableRoles = viewerIsAdmin ? roles : roles.filter((r) => r.name !== "admin");
  const roleLabel = (name: string) => roles.find((r) => r.name === name)?.display_name ?? name;
  const officeChips = [
    ...offices.map((o) => ({ value: o.name, label: o.display_name })),
    ...(officeCounts.has(NONE) ? [{ value: NONE, label: "No office" }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground">
            Click anyone to see their profile. Add people, change roles, and turn accounts off.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      <UserFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        roles={roles}
        offices={offices}
        departments={departments}
        viewerIsAdmin={viewerIsAdmin}
        viewerOffice={session?.user?.office ?? null}
        onSaved={fetchUsers}
      />
      {actions.dialog}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email…"
              className="pl-8"
              aria-label="Search users"
            />
          </div>
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-[170px]" aria-label="Department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  {d.display_name}
                </SelectItem>
              ))}
              <SelectItem value={NONE}>No department</SelectItem>
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-[170px]" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.name} value={r.name}>
                  {r.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4" />
              Clear
            </Button>
          )}
          {viewerIsAdmin && (
            <div className="ml-auto inline-flex rounded-md border p-0.5">
              <Chip active={status === "active"} onClick={() => setStatus("active")} flat>
                Active <Count>{activeCount}</Count>
              </Chip>
              <Chip active={status === "inactive"} onClick={() => setStatus("inactive")} flat>
                Inactive <Count>{inactiveCount}</Count>
              </Chip>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={office === ALL} onClick={() => setOffice(ALL)}>
            Everyone <Count>{inStatus.length}</Count>
          </Chip>
          {officeChips.map((o) => (
            <Chip key={o.value} active={office === o.value} onClick={() => setOffice(office === o.value ? ALL : o.value)}>
              {o.label} <Count>{officeCounts.get(o.value) ?? 0}</Count>
            </Chip>
          ))}
        </div>
      </div>

      {(notice || loadError) && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {notice || loadError}
        </p>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader columnKey="name" label="Person" sort={sort} onToggle={toggle} />
              <SortHeader columnKey="office" label="Office" sort={sort} onToggle={toggle} />
              <SortHeader columnKey="department" label="Department" sort={sort} onToggle={toggle} />
              <SortHeader columnKey="role" label="Role" sort={sort} onToggle={toggle} />
              <SortHeader columnKey="created" label="Added" sort={sort} onToggle={toggle} />
              <TableHead className="w-[88px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users === null && !loadError &&
              [0, 1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <div className="h-9 animate-pulse rounded bg-muted" />
                  </TableCell>
                </TableRow>
              ))}
            {users !== null && sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {filtering ? (
                    <>
                      No one matches.{" "}
                      <button type="button" className="underline underline-offset-4" onClick={clearFilters}>
                        Clear filters
                      </button>
                    </>
                  ) : status === "inactive" ? (
                    "No inactive users."
                  ) : (
                    "No users yet."
                  )}
                </TableCell>
              </TableRow>
            )}
            {sorted.map((user) => {
              const isSelf = user.id === currentProfileId;
              const inactive = user.is_active === false;
              // Older API responses have no can_manage: fall back to the admin lock.
              const canManage = user.can_manage ?? (viewerIsAdmin || user.role !== "admin");
              const noManageWhy = "You can only manage people below your role, in your own office";
              const canEdit = canManage || isSelf;
              const canRole = canManage && !(isSelf && !viewerIsAdmin);
              const canRetire = canManage && !isSelf;
              return (
                <TableRow
                  key={user.id}
                  className={cn("cursor-pointer", inactive && "opacity-60")}
                  onClick={() => peek.open(user.id, { name: user.name || user.email })}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <PersonAvatar profileId={user.id} name={user.name || user.email} size={36} hasPhoto={user.has_photo} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                          <span className="truncate">{user.name || user.email}</span>
                          {isSelf && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                          {user.is_it && <Badge>IT</Badge>}
                          {user.can_offboard && <Badge variant="outline">Offboarding</Badge>}
                          {inactive && <Badge variant="destructive">Inactive</Badge>}
                        </div>
                        {user.name && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.office ? orgLabel(offices, user.office) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {user.department ? (
                      orgLabel(departments, user.department)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {canRole ? (
                      <Select value={user.role} onValueChange={(v) => handleRoleChange(user, v as UserRole)}>
                        <SelectTrigger className="h-8 w-[160px]" aria-label={`Role for ${user.name || user.email}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* A role this viewer can't hand out still has to show as the current value. */}
                          {!assignableRoles.some((r) => r.name === user.role) && (
                            <SelectItem value={user.role} disabled>
                              {roleLabel(user.role)}
                            </SelectItem>
                          )}
                          {assignableRoles.map((r) => (
                            <SelectItem key={r.name} value={r.name}>
                              {r.display_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{roleLabel(user.role)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateUS(user.created_at)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!canEdit}
                        title={canEdit ? "Edit" : noManageWhy}
                        onClick={() => openEdit(user)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`More for ${user.name || user.email}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/users/${user.id}`}>
                              <UserRound />
                              Open full profile
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={!canEdit} onSelect={() => openEdit(user)}>
                            <Pencil />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={!canRetire}
                            title={isSelf ? "You can't do this to yourself" : canRetire ? undefined : noManageWhy}
                            onSelect={() => actions.askToggleActive(user)}
                          >
                            {inactive ? <UserCheck /> : <UserX />}
                            {inactive ? "Reactivate" : "Deactivate"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={!canRetire}
                            onSelect={() => actions.askRemove(user)}
                          >
                            <Trash2 />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {users !== null && sorted.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {filtering ? `${sorted.length} of ${inStatus.length}` : sorted.length} {status === "inactive" ? "inactive " : ""}
          {sorted.length === 1 && !filtering ? "person" : "people"}
        </p>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  flat,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Segment inside a bordered group, instead of a free-standing pill. */
  flat?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 text-sm transition-colors",
        flat ? "rounded-[5px]" : "rounded-full border",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="text-xs tabular-nums opacity-70">{children}</span>;
}
