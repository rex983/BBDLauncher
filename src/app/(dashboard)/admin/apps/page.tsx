"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Plus, Pencil, Trash2 } from "lucide-react";

export default function AdminAppsPage() {
  const [apps, setApps] = useState<AppWithAccess[]>([]);
  const [editingApp, setEditingApp] = useState<AppWithAccess | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>SSO Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {apps.map((app) => (
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
          {apps.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                No applications configured yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
