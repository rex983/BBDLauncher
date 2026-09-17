"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canEditTimeData } from "@/lib/auth/permissions";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { TimeOffCalendar } from "@/components/features/timeoff/TimeOffCalendar";
import { TimeOffSummary } from "@/components/features/timeoff/TimeOffSummary";
import { MarkDayOffDialog } from "@/components/features/timeoff/MarkDayOffDialog";
import {
  RequestDetailDialog,
  type DetailRow,
} from "@/components/features/timeoff/RequestDetailDialog";
import {
  TIME_OFF_TYPE_LABEL,
  type TimeOffAttachment,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";
import { Check, ChevronDown, ChevronRight, Paperclip, X } from "lucide-react";

interface Row {
  id: string;
  profile_id: string;
  profile?: { email: string; name: string | null; office: string | null };
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  reason: string | null;
  status: TimeOffStatus;
  decided_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  attachments: TimeOffAttachment[] | null;
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function toDetailRow(r: Row): DetailRow {
  return {
    id: r.id,
    profile_id: r.profile_id,
    profile: r.profile
      ? { name: r.profile.name, email: r.profile.email, office: r.profile.office }
      : null,
    type: r.type,
    subcategory: r.subcategory,
    start_date: r.start_date,
    end_date: r.end_date,
    full_day: r.full_day,
    hours: r.hours,
    reason: r.reason,
    status: r.status,
    decided_note: r.decided_note,
    decided_by: r.decided_by,
    decided_at: r.decided_at,
    created_at: r.created_at,
    attachments: r.attachments,
  };
}

export default function TimeOffManagementPage() {
  const { data: session } = useSession();
  const canManage = canEditTimeData(session?.user?.role);
  const { viewAsOffice } = useRolePreview();
  // Bumped by RequestsQueue each time a request is approved, denied,
  // edited, or deleted so the sibling Calendar + Summary tabs pick up the
  // change without a full page reload. Radix Tabs keeps inactive tabs
  // mounted, so we need an explicit signal instead of relying on remount.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">
            <Link href="/management/timesheets" className="hover:underline">
              ← Timesheets
            </Link>
          </div>
          <h1 className="text-2xl font-bold">Time Off</h1>
          <p className="text-muted-foreground">
            Review requests, see who&rsquo;s off on a shared calendar, and check totals per employee.
          </p>
        </div>
        {canManage && (
          <MarkDayOffDialog onCreated={bump} viewAsOffice={viewAsOffice} />
        )}
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Requests</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <RequestsQueue onChanged={bump} />
        </TabsContent>
        <TabsContent value="calendar" className="mt-4">
          <TimeOffCalendar refreshKey={refreshKey} />
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
          <TimeOffSummary refreshKey={refreshKey} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type SectionKey = "pending" | "approved" | "denied";

function RequestsQueue({ onChanged }: { onChanged: () => void }) {
  const { data: session } = useSession();
  const canManage = canEditTimeData(session?.user?.role);
  const { viewAsOffice } = useRolePreview();

  const [pending, setPending] = useState<Row[]>([]);
  const [approved, setApproved] = useState<Row[]>([]);
  const [denied, setDenied] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    pending: true,
    approved: false,
    denied: false,
  });
  const [selected, setSelected] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const buildUrl = (s: SectionKey) => {
      const p = new URLSearchParams({ status: s });
      if (viewAsOffice) p.set("office", viewAsOffice);
      return `/api/management/timeoff?${p.toString()}`;
    };
    const [pRes, aRes, dRes] = await Promise.all([
      fetch(buildUrl("pending")),
      fetch(buildUrl("approved")),
      fetch(buildUrl("denied")),
    ]);
    setPending(pRes.ok ? await pRes.json() : []);
    setApproved(aRes.ok ? await aRes.json() : []);
    setDenied(dRes.ok ? await dRes.json() : []);
    setLoading(false);
  }, [viewAsOffice]);

  useEffect(() => { load(); }, [load]);

  // If the dialog is open on a row that just changed sections after a
  // decision, keep the reference fresh from whichever bucket it moved to.
  const allRows = useMemo(
    () => [...pending, ...approved, ...denied],
    [pending, approved, denied],
  );
  useEffect(() => {
    if (!selected) return;
    const fresh = allRows.find((r) => r.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [allRows, selected]);

  const decideFromRow = async (id: string, next: "approved" | "denied") => {
    const note = next === "denied" ? window.prompt("Reason for denial (optional):") || "" : "";
    const res = await fetch(`/api/management/timeoff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, decided_note: note || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(typeof body.error === "string" ? body.error : "Failed to update request");
      return;
    }
    await load();
    onChanged();
  };

  const handleDialogChanged = async () => {
    await load();
    onChanged();
  };

  const toggle = (k: SectionKey) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="space-y-4">
      <Section
        title="Pending"
        count={pending.length}
        open={open.pending}
        onToggle={() => toggle("pending")}
        tone="pending"
      >
        <RowTable
          rows={pending}
          loading={loading}
          section="pending"
          canDecide={canManage}
          onRowClick={setSelected}
          onDecide={decideFromRow}
          emptyLabel="No pending requests."
        />
      </Section>

      <Section
        title="Approved"
        count={approved.length}
        open={open.approved}
        onToggle={() => toggle("approved")}
        tone="approved"
      >
        <RowTable
          rows={approved}
          loading={loading}
          section="approved"
          canDecide={false}
          onRowClick={setSelected}
          emptyLabel="No approved requests."
        />
      </Section>

      <Section
        title="Denied"
        count={denied.length}
        open={open.denied}
        onToggle={() => toggle("denied")}
        tone="denied"
      >
        <RowTable
          rows={denied}
          loading={loading}
          section="denied"
          canDecide={false}
          onRowClick={setSelected}
          emptyLabel="No denied requests."
        />
      </Section>

      <RequestDetailDialog
        row={selected ? toDetailRow(selected) : null}
        onClose={() => setSelected(null)}
        canDecide={canManage}
        canEdit={canManage}
        onChanged={handleDialogChanged}
      />
    </div>
  );
}

function Section({
  title, count, open, onToggle, tone, children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  tone: "pending" | "approved" | "denied";
  children: React.ReactNode;
}) {
  const badgeVariant: Record<typeof tone, "outline" | "default" | "destructive"> = {
    pending: "outline",
    approved: "default",
    denied: "destructive",
  };
  return (
    <div className="border rounded-md bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-medium">{title}</span>
        <Badge variant={badgeVariant[tone]} className="ml-1">{count}</Badge>
      </button>
      {open && <div className="border-t">{children}</div>}
    </div>
  );
}

function RowTable({
  rows,
  loading,
  section,
  canDecide,
  onRowClick,
  onDecide,
  emptyLabel,
}: {
  rows: Row[];
  loading: boolean;
  section: SectionKey;
  canDecide: boolean;
  onRowClick: (r: Row) => void;
  onDecide?: (id: string, next: "approved" | "denied") => void;
  emptyLabel: string;
}) {
  const showActions = section === "pending" && canDecide;
  const colSpan = showActions ? 6 : 5;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Length</TableHead>
          <TableHead>{section === "pending" ? "Submitted" : "Decided"}</TableHead>
          {showActions && <TableHead>Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && (
          <TableRow>
            <TableCell colSpan={colSpan} className="text-center py-6 text-muted-foreground">
              Loading…
            </TableCell>
          </TableRow>
        )}
        {!loading && rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={colSpan} className="text-center py-6 text-muted-foreground">
              {emptyLabel}
            </TableCell>
          </TableRow>
        )}
        {rows.map((r) => (
          <TableRow
            key={r.id}
            className="cursor-pointer hover:bg-muted/40"
            onClick={() => onRowClick(r)}
          >
            <TableCell>
              <div className="font-medium">{r.profile?.name || r.profile?.email}</div>
              <div className="text-xs text-muted-foreground">{r.profile?.email}</div>
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-1">
                <Badge variant="outline" className="w-fit">{TIME_OFF_TYPE_LABEL[r.type]}</Badge>
                {r.subcategory && (
                  <span className="text-xs text-muted-foreground">{r.subcategory}</span>
                )}
              </div>
            </TableCell>
            <TableCell>
              {fmtDate(r.start_date)}
              {r.start_date !== r.end_date && <> – {fmtDate(r.end_date)}</>}
            </TableCell>
            <TableCell>
              {r.full_day ? "Full day" : `${r.hours}h`}
              {r.attachments && r.attachments.length > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  {r.attachments.length}
                </span>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {section === "pending"
                ? new Date(r.created_at).toLocaleDateString()
                : r.decided_at
                  ? new Date(r.decided_at).toLocaleDateString()
                  : "—"}
            </TableCell>
            {showActions && (
              <TableCell onClick={(e) => e.stopPropagation()}>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => onDecide?.(r.id, "approved")}
                  >
                    <Check className="h-4 w-4 mr-1" />Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDecide?.(r.id, "denied")}
                  >
                    <X className="h-4 w-4 mr-1" />Deny
                  </Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
