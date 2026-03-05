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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LinkForm } from "@/components/features/admin/link-form";
import type { ImportantLink } from "@/types/link";
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";

export default function AdminLinksPage() {
  const [links, setLinks] = useState<ImportantLink[]>([]);
  const [editingLink, setEditingLink] = useState<ImportantLink | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchLinks = async () => {
    const res = await fetch("/api/links");
    if (res.ok) setLinks(await res.json());
  };

  useEffect(() => {
    fetchLinks();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this link?")) return;
    await fetch(`/api/links/${id}`, { method: "DELETE" });
    fetchLinks();
  };

  const handleSaved = () => {
    setDialogOpen(false);
    setEditingLink(null);
    fetchLinks();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manage Links</h1>
          <p className="text-muted-foreground">
            Configure important links shown on the dashboard
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditingLink(null);
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Link
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingLink ? "Edit Link" : "New Link"}
              </DialogTitle>
            </DialogHeader>
            <LinkForm link={editingLink} onSaved={handleSaved} />
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Order</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((link) => (
            <TableRow key={link.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {link.icon_url && (
                    <img
                      src={link.icon_url}
                      alt=""
                      className="h-4 w-4 rounded object-contain"
                    />
                  )}
                  {link.name}
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                {link.description}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-primary"
                >
                  {link.url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </TableCell>
              <TableCell>{link.display_order}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditingLink(link);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(link.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {links.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center py-8 text-muted-foreground"
              >
                No links configured yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
