"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ManagerIncidentDialog, type ManagerIncidentSummary } from "@/components/features/incidents/ManagerIncidentDialog";
import { FileIncidentDialog } from "@/components/features/incidents/FileIncidentDialog";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incidents/types";

const SEVERITY_VARIANT: Record<
  IncidentSeverity,
  "default" | "secondary" | "outline" | "destructive"
> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  critical: "destructive",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Tab filters — statuses are the source of truth for what "In progress" and
// "Archive" mean, so a report that gets cancelled between polls jumps
// buckets automatically on refresh.
const IN_PROGRESS_STATUSES: IncidentStatus[] = [
  "draft",
  "awaiting_manager_sig",
  "awaiting_employee_sig",
];
const ARCHIVE_STATUSES: IncidentStatus[] = ["completed", "cancelled"];

export default function IncidentsManagementPage() {
  const { data: session } = useSession();
  const viewerFullName = session?.user?.name || null;

  const [rows, setRows] = useState<ManagerIncidentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"in_progress" | "archive">("in_progress");
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/management/incidents");
    if (!res.ok) {
      setRows([]);
      setLoading(false);
      return;
    }
    const body: ManagerIncidentSummary[] = await res.json();
    setRows(body);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const statuses =
      tab === "in_progress" ? IN_PROGRESS_STATUSES : ARCHIVE_STATUSES;
    return rows
      .filter((r) => statuses.includes(r.status))
      .filter((r) => severityFilter === "all" || r.severity === severityFilter)
      .filter((r) => categoryFilter === "all" || r.category === categoryFilter)
      .filter((r) => {
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return (
          r.title.toLowerCase().includes(q) ||
          (r.employee?.name || "").toLowerCase().includes(q) ||
          (r.employee?.email || "").toLowerCase().includes(q)
        );
      });
  }, [rows, tab, severityFilter, categoryFilter, query]);

  const openRow = (id: string) => {
    setSelected(id);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">
            <Link href="/management/timesheets" className="hover:underline">
              ← Timesheets
            </Link>
          </div>
          <h1 className="text-2xl font-bold">Incident Reports</h1>
          <p className="text-muted-foreground">
            File and manage HR incident reports with AI-assisted drafting and
            internal e-signature.
          </p>
        </div>
        <FileIncidentDialog onFiled={load} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="in_progress">
            In progress
            <Badge variant="secondary" className="ml-2">
              {rows.filter((r) => IN_PROGRESS_STATUSES.includes(r.status)).length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="archive">
            Archive
            <Badge variant="secondary" className="ml-2">
              {rows.filter((r) => ARCHIVE_STATUSES.includes(r.status)).length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap items-center gap-2 mt-4 print:hidden">
          <Input
            placeholder="Search title, employee, email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={severityFilter}
            onValueChange={(v) => setSeverityFilter(v as typeof severityFilter)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {INCIDENT_SEVERITIES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {INCIDENT_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="in_progress" className="mt-4">
          <IncidentRowTable
            rows={filtered}
            loading={loading}
            onRowClick={openRow}
            emptyLabel="No incidents in progress."
          />
        </TabsContent>
        <TabsContent value="archive" className="mt-4">
          <IncidentRowTable
            rows={filtered}
            loading={loading}
            onRowClick={openRow}
            emptyLabel="No archived incidents."
          />
        </TabsContent>
      </Tabs>

      <ManagerIncidentDialog
        incidentId={selected}
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setSelected(null);
        }}
        onChanged={load}
        reporterFullName={viewerFullName}
      />
    </div>
  );
}

function IncidentRowTable({
  rows,
  loading,
  onRowClick,
  emptyLabel,
}: {
  rows: ManagerIncidentSummary[];
  loading: boolean;
  onRowClick: (id: string) => void;
  emptyLabel: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Filed</TableHead>
          <TableHead>Employee</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && (
          <TableRow>
            <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
              Loading…
            </TableCell>
          </TableRow>
        )}
        {!loading && rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
              {emptyLabel}
            </TableCell>
          </TableRow>
        )}
        {rows.map((r) => (
          <TableRow
            key={r.id}
            className="cursor-pointer hover:bg-muted/40"
            onClick={() => onRowClick(r.id)}
          >
            <TableCell className="text-sm">{fmtDate(r.created_at)}</TableCell>
            <TableCell>
              <div className="font-medium">{r.employee?.name || r.employee?.email || "—"}</div>
              <div className="text-xs text-muted-foreground">{r.employee?.email}</div>
            </TableCell>
            <TableCell className="font-medium">{r.title}</TableCell>
            <TableCell>
              <Badge variant="outline">{INCIDENT_CATEGORY_LABEL[r.category]}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={SEVERITY_VARIANT[r.severity]}>
                {INCIDENT_SEVERITY_LABEL[r.severity]}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{INCIDENT_STATUS_LABEL[r.status]}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
