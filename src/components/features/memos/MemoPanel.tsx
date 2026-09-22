"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatMemoNumber,
  MEMO_ACK_MODE_LABEL,
  MEMO_CATEGORY_LABEL,
  MEMO_PRIORITY_LABEL,
  type MemoAcknowledgementMode,
  type MemoCategory,
  type MemoPriority,
} from "@/lib/memos/types";

export interface EmployeeMemoRow {
  memo_id: string;
  recipient_id: string;
  delivered_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
  number: number | null;
  title: string;
  category: MemoCategory;
  priority: MemoPriority;
  acknowledgement_mode: MemoAcknowledgementMode;
  effective_date: string | null;
  published_at: string | null;
  author_name: string | null;
}

const PRIORITY_VARIANT: Record<
  MemoPriority,
  "default" | "secondary" | "outline" | "destructive"
> = {
  informational: "outline",
  important: "default",
  mandatory: "destructive",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Employee-facing memo list. Rows navigate to /memos/[id] — the memo
// detail is a full page, not a dialog, since memos can be long-form.
// Bell notifications from publishMemo point directly at that page too.
//
// When a parent server component supplies `initialRows`, the client
// fetch is skipped and first paint has data. Otherwise the panel
// self-loads from /api/memos on mount.
export function MemoPanel({
  initialRows,
  title = "Memos",
  description,
}: {
  initialRows?: EmployeeMemoRow[];
  title?: string;
  description?: string;
}) {
  const [rows, setRows] = useState<EmployeeMemoRow[]>(initialRows ?? []);
  const [loading, setLoading] = useState(initialRows === undefined);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/memos");
    const body: EmployeeMemoRow[] = res.ok ? await res.json() : [];
    setRows(body);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initialRows === undefined) load();
  }, [initialRows, load]);

  const pending = rows.filter(
    (r) => r.acknowledgement_mode !== "informational" && !r.acknowledged_at,
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {pending > 0 && (
            <Badge variant="destructive">{pending} to acknowledge</Badge>
          )}
        </CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No memos delivered to you yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Published</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const needsAck =
                  r.acknowledgement_mode !== "informational" &&
                  !r.acknowledged_at;
                const acked = !!r.acknowledged_at;
                return (
                  <TableRow key={r.memo_id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {formatMemoNumber(r.number)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {fmtDate(r.published_at)}
                    </TableCell>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="text-sm">
                      {r.author_name || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {MEMO_CATEGORY_LABEL[r.category]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={PRIORITY_VARIANT[r.priority]}>
                        {MEMO_PRIORITY_LABEL[r.priority]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {acked ? (
                        <Badge variant="secondary">Acknowledged</Badge>
                      ) : needsAck ? (
                        <Badge variant="destructive">
                          {MEMO_ACK_MODE_LABEL[r.acknowledgement_mode]}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          {r.read_at ? "Read" : "Delivered"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/memos/${r.memo_id}`}>
                          {needsAck ? "Review & acknowledge" : "View"}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
