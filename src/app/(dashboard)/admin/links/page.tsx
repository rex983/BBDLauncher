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
import { Badge } from "@/components/ui/badge";
import { LinkForm } from "@/components/features/admin/link-form";
import type { ImportantLink } from "@/types/link";
import { Plus, Pencil, Trash2, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

type SortKey = "name" | "description" | "url" | "office" | "display_order";
type SortDir = "asc" | "desc";

export default function AdminLinksPage() {
  const [links, setLinks] = useState<ImportantLink[]>([]);
  const [editingLink, setEditingLink] = useState<ImportantLink | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedLinks = (() => {
    if (!sortKey) return links;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...links].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      const as = av == null ? "" : String(av);
      const bs = bv == null ? "" : String(bv);
      return as.localeCompare(bs, undefined, { sensitivity: "base" }) * dir;
    });
  })();

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? (
      <ArrowUpDown className="h-3 w-3 opacity-40" />
    ) : sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );

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
            <TableHead
              onClick={() => toggleSort("name")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">Name <SortIcon k="name" /></div>
            </TableHead>
            <TableHead
              onClick={() => toggleSort("description")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">Description <SortIcon k="description" /></div>
            </TableHead>
            <TableHead
              onClick={() => toggleSort("url")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">URL <SortIcon k="url" /></div>
            </TableHead>
            <TableHead
              onClick={() => toggleSort("office")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">Office <SortIcon k="office" /></div>
            </TableHead>
            <TableHead
              onClick={() => toggleSort("display_order")}
              className="cursor-pointer select-none"
            >
              <div className="flex items-center gap-1">Order <SortIcon k="display_order" /></div>
            </TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedLinks.map((link) => (
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
              <TableCell>
                {link.office ? (
                  <Badge variant="outline">{link.office}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Everyone</span>
                )}
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
          {sortedLinks.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
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
