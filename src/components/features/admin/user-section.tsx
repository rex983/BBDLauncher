"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";

interface UserSectionProps {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  emptyMessage: string;
  children: React.ReactNode;
  isEmpty: boolean;
}

export function UserSection({
  title,
  count,
  collapsed,
  onToggle,
  emptyMessage,
  children,
  isEmpty,
}: UserSectionProps) {
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <span>{title}</span>
        <Badge variant="outline" className="ml-1">{count}</Badge>
      </button>
      {!collapsed && (
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
            {children}
            {isEmpty && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
