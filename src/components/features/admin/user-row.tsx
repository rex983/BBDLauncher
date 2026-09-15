"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Trash2, UserCheck, UserX } from "lucide-react";
import type { UserProfile, UserRole } from "@/types/auth";
import type { LauncherRole } from "./user-form-dialog";

interface UserRowProps {
  user: UserProfile;
  currentProfileId: string | null | undefined;
  viewerIsAdmin: boolean;
  roles: LauncherRole[];
  onRoleChange: (userId: string, role: UserRole) => void;
  onEdit: (user: UserProfile) => void;
  onToggleActive: (user: UserProfile) => void;
  onDelete: (user: UserProfile) => void;
}

export function UserRow({
  user,
  currentProfileId,
  viewerIsAdmin,
  roles,
  onRoleChange,
  onEdit,
  onToggleActive,
  onDelete,
}: UserRowProps) {
  const isSelf = user.id === currentProfileId;
  const targetIsAdmin = user.role === "admin";
  const lockedByRole = !viewerIsAdmin && targetIsAdmin;
  const editDisabled = lockedByRole;
  const deleteDisabled = isSelf || lockedByRole;
  const toggleActiveDisabled = isSelf || lockedByRole;
  const inactive = user.is_active === false;

  const deleteTitle = isSelf
    ? "You cannot remove yourself"
    : lockedByRole
      ? "Only admins can remove an admin account"
      : "Remove user";
  const toggleActiveTitle = isSelf
    ? "You cannot deactivate yourself"
    : lockedByRole
      ? "Only admins can change an admin's status"
      : inactive
        ? "Reactivate user"
        : "Deactivate user";

  const assignableRoles = viewerIsAdmin
    ? roles
    : roles.filter((r) => r.name !== "admin");

  return (
    <TableRow className={inactive ? "opacity-60" : undefined}>
      <TableCell className="font-medium">
        <span className="flex items-center gap-2">
          {user.name || "—"}
          {inactive && <Badge variant="destructive">Inactive</Badge>}
        </span>
      </TableCell>
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
          onValueChange={(v) => onRoleChange(user.id, v as UserRole)}
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
            onClick={() => onEdit(user)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={toggleActiveDisabled}
            title={toggleActiveTitle}
            onClick={() => onToggleActive(user)}
          >
            {inactive ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={deleteDisabled}
            title={deleteTitle}
            onClick={() => onDelete(user)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
