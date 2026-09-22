"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { AttachmentPreview } from "@/components/shared/AttachmentPreview";
import { MEMO_EVENT_LABEL } from "@/lib/memos/audit";
import {
  formatMemoNumber,
  MEMO_ACK_MODE_LABEL,
  MEMO_CATEGORY_LABEL,
  MEMO_PRIORITY_LABEL,
  MEMO_STATUS_LABEL,
  type MemoPriority,
} from "@/lib/memos/types";
import { Archive, CheckCircle2, Eye, Pencil, Save, Send, Trash2, X } from "lucide-react";
import type { ManagerMemoPageData } from "./page";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const PRIORITY_VARIANT: Record<
  MemoPriority,
  "default" | "secondary" | "outline" | "destructive"
> = {
  informational: "outline",
  important: "default",
  mandatory: "destructive",
};

export function ManagerMemoView({
  data,
  viewerProfileId,
  viewerIsAdmin,
}: {
  data: ManagerMemoPageData;
  viewerProfileId: string | null;
  viewerIsAdmin: boolean;
}) {
  const router = useRouter();
  const [memo, setMemo] = useState(data);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(data.title);
  const [editBody, setEditBody] = useState(data.body);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const canEdit =
    memo.status !== "archived" &&
    (viewerIsAdmin || memo.author?.id === viewerProfileId);
  const canPublish = memo.status === "draft" && canEdit;
  const canArchive = memo.status !== "archived" && canEdit;

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/management/memos/${memo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, body: editBody }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Save failed");
      return;
    }
    setEditing(false);
    setMemo({ ...memo, title: editTitle, body: editBody });
    router.refresh();
  };

  const publish = async () => {
    if (memo.audience_scope === "custom") {
      setError("Custom-audience memos can only be published at creation time.");
      return;
    }
    setPublishing(true);
    setError(null);
    const res = await fetch(`/api/management/memos/${memo.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setPublishing(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Publish failed");
      return;
    }
    router.refresh();
  };

  const archive = async () => {
    if (!confirm("Archive this memo? Recipients will no longer see it.")) return;
    const res = await fetch(`/api/management/memos/${memo.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Archive failed");
      return;
    }
    router.push("/management/memos");
  };

  // Admin-only HARD delete. Removes the row, recipient roster, audit
  // log, and attachment files. Server enforces admin.
  const purge = async () => {
    const numberLabel = formatMemoNumber(memo.number);
    const answer = window.prompt(
      `PERMANENT DELETE. Type "${numberLabel}" to confirm. This scrubs the memo, its recipient roster, every audit event, and all attachment files. Cannot be undone.`,
    );
    if (!answer || answer.trim() !== numberLabel) return;
    const res = await fetch(`/api/management/memos/${memo.id}/purge`, {
      method: "POST",
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Delete failed");
      return;
    }
    router.push("/management/memos");
  };

  const audienceLabel =
    memo.audience_scope === "company"
      ? "Whole company"
      : memo.audience_scope === "office"
        ? `Office · ${memo.audience_office}`
        : memo.audience_scope === "department"
          ? `Department · ${memo.audience_department}${memo.audience_office ? ` @ ${memo.audience_office}` : ""}`
          : "Custom list";

  return (
    <>
      <div className="flex items-baseline gap-3">
        {memo.number != null && (
          <span className="font-mono text-sm text-muted-foreground">
            {formatMemoNumber(memo.number)}
          </span>
        )}
        <h1 className="text-3xl font-bold tracking-tight">{memo.title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={PRIORITY_VARIANT[memo.priority]}>
          {MEMO_PRIORITY_LABEL[memo.priority]}
        </Badge>
        <Badge variant="outline">{MEMO_CATEGORY_LABEL[memo.category]}</Badge>
        <Badge variant="secondary">{MEMO_STATUS_LABEL[memo.status]}</Badge>
        <span className="text-xs text-muted-foreground">{audienceLabel}</span>
      </div>

      <Card>
        <CardContent className="space-y-6 py-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b pb-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Author</p>
              <p className="font-medium">
                {memo.author?.name || memo.author?.email || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Published</p>
              <p>{fmtDate(memo.published_at)}</p>
            </div>
            {memo.effective_date && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Effective</p>
                <p>
                  {new Date(memo.effective_date + "T00:00:00").toLocaleDateString()}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Acknowledgement</p>
              <p>{MEMO_ACK_MODE_LABEL[memo.acknowledgement_mode]}</p>
            </div>
            {memo.edit_count > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Edits</p>
                <p className="text-xs">
                  {memo.edit_count} · last {fmtDate(memo.last_edited_at)}
                </p>
              </div>
            )}
          </div>

          {!editing ? (
            <div className="whitespace-pre-wrap text-base leading-relaxed">
              {memo.body}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-body">Body</Label>
                <Textarea
                  id="edit-body"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={16}
                />
              </div>
              {memo.status === "published" && (
                <p className="text-xs text-muted-foreground">
                  Editing a published memo is tracked in the audit trail but
                  does not reset acknowledgements.
                </p>
              )}
            </div>
          )}

          {Array.isArray(memo.attachments) && memo.attachments.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Attachments ({memo.attachments.length})
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {memo.attachments.map((a) => (
                  <AttachmentPreview
                    key={a.path}
                    attachment={a}
                    hrefPrefix="/api/memos/attachments/"
                  />
                ))}
              </div>
            </div>
          )}

          {memo.document_hash && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Document integrity
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                SHA-256: {memo.document_hash}
              </p>
              {memo.author_signature_hash && (
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  Author signature: {memo.author_signature_hash}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        )}
        {editing && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setEditTitle(memo.title);
                setEditBody(memo.body);
              }}
              disabled={saving}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel edit
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        )}
        {canPublish && !editing && (
          <Button size="sm" onClick={publish} disabled={publishing}>
            <Send className="mr-2 h-4 w-4" />
            {publishing ? "Publishing…" : "Publish now"}
          </Button>
        )}
        {viewerIsAdmin && !editing && (
          <Button
            variant="destructive"
            size="sm"
            onClick={purge}
            title="Admin-only hard delete. Removes the memo, roster, audit log, and attachment files."
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete permanently
          </Button>
        )}
        {canArchive && !editing && (
          <Button variant="outline" size="sm" onClick={archive}>
            <Archive className="mr-2 h-4 w-4" />
            Archive
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="space-y-3 py-6">
          <p className="text-sm font-medium">
            Recipients ({memo.stats.delivered})
          </p>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Read</TableHead>
                  <TableHead>Acknowledged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memo.recipients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                      No recipients yet.
                    </TableCell>
                  </TableRow>
                )}
                {memo.recipients.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.name || r.profile_id}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(r.delivered_at)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.read_at ? (
                        <span className="inline-flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {fmtDate(r.read_at)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.acknowledged_at ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          {fmtDate(r.acknowledged_at)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {memo.stats.read}/{memo.stats.delivered} read ·{" "}
            {memo.stats.acknowledged}/{memo.stats.delivered} acknowledged
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 py-6">
          <p className="text-sm font-medium">Activity</p>
          <ol className="space-y-1 border-l pl-4">
            {memo.events.map((e) => {
              const label =
                (MEMO_EVENT_LABEL as Record<string, string>)[e.event_type] ||
                e.event_type;
              return (
                <li key={e.id} className="text-xs">
                  <span className="text-muted-foreground">
                    {fmtDate(e.created_at)} ·{" "}
                  </span>
                  <span className="font-medium">{label}</span>
                  {e.actor_name && (
                    <span className="text-muted-foreground">
                      {" "}
                      by {e.actor_name}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
