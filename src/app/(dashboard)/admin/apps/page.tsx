"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AppForm } from "@/components/features/admin/app-form";
import type { AppWithAccess } from "@/types/app";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Search, X } from "lucide-react";

type SortKey = "name" | "url" | "sso_type" | "status" | "offices" | "roles";
type SortDir = "asc" | "desc";

export default function AdminAppsPage() {
  const [apps, setApps] = useState<AppWithAccess[]>([]);
  const [editingApp, setEditingApp] = useState<AppWithAccess | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filteredApps = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => {
      const haystack = [
        a.name,
        a.url,
        a.description,
        a.sso_type,
        a.status,
        ...(a.offices || []),
        ...(a.roles || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  })();

  const sortedApps = (() => {
    if (!sortKey) return filteredApps;
    const dir = sortDir === "asc" ? 1 : -1;
    const value = (a: AppWithAccess): string => {
      if (sortKey === "roles") return (a.roles || []).slice().sort().join(",");
      if (sortKey === "offices") return (a.offices || []).slice().sort().join(",");
      const v = a[sortKey];
      return v == null ? "" : String(v);
    };
    return [...filteredApps].sort((a, b) =>
      value(a).localeCompare(value(b), undefined, { sensitivity: "base" }) * dir
    );
  })();

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? (
      <ArrowUpDown className="h-3 w-3 opacity-40" />
    ) : sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );

  const fetchApps = async () => {
    const res = await fetch("/api/apps");
    if (res.ok) setApps(await res.json());
  };

  useEffect(() => {
    fetchApps();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this app?")) return;
    await fetch(`/api/apps/${id}`, { method: "DELETE" });
    fetchApps();
  };

  const handleSaved = () => {
    setDialogOpen(false);
    setEditingApp(null);
    fetchApps();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manage Applications</h1>
          <p className="text-muted-foreground">
            Configure applications and SSO settings
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingApp(null);
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add App
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingApp ? "Edit Application" : "New Application"}
              </DialogTitle>
            </DialogHeader>
            <AppForm app={editingApp} onSaved={handleSaved} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          placeholder="Search apps by name, URL, role, office..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 pr-8"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              onClick={() => toggleSort("name")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">Name <SortIcon k="name" /></div>
            </TableHead>
            <TableHead
              onClick={() => toggleSort("url")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">URL <SortIcon k="url" /></div>
            </TableHead>
            <TableHead
              onClick={() => toggleSort("sso_type")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">SSO Type <SortIcon k="sso_type" /></div>
            </TableHead>
            <TableHead
              onClick={() => toggleSort("status")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">Status <SortIcon k="status" /></div>
            </TableHead>
            <TableHead
              onClick={() => toggleSort("offices")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">Offices <SortIcon k="offices" /></div>
            </TableHead>
            <TableHead
              onClick={() => toggleSort("roles")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">Roles <SortIcon k="roles" /></div>
            </TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedApps.map((app) => (
            <TableRow key={app.id}>
              <TableCell className="font-medium">{app.name}</TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                {app.url}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{app.sso_type}</Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    app.status === "active"
                      ? "default"
                      : app.status === "maintenance"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {app.status}
                </Badge>
              </TableCell>
              <TableCell>
                {app.offices && app.offices.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {app.offices.map((o) => (
                      <Badge key={o} variant="outline">
                        {o}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Everyone</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {app.roles?.map((r) => (
                    <Badge key={r} variant="secondary" className="text-xs">
                      {r}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditingApp(app);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(app.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {sortedApps.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                No applications configured yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
