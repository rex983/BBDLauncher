"use client";

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
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  type IncidentAttachment,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incidents/types";
import { EmployeeIncidentDialog } from "./EmployeeIncidentDialog";

export interface IncidentSummary {
  id: string;
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  status: IncidentStatus;
  occurred_at: string | null;
  manager_signed_at: string | null;
  employee_signed_at: string | null;
  attachments: IncidentAttachment[] | null;
  created_at: string;
}

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

// Employee-facing incident report card. Shows a row per report awaiting
// signature or archived. Clicking a row opens the signing dialog. Mirrors
// the shape of TimeOffPanel but signing (not cancellation) is the primary
// action — employees can't cancel a report about themselves.
export function IncidentPanel({
  initialRows,
  employeeFullName,
  title = "Incident reports",
  description,
}: {
  initialRows?: IncidentSummary[];
  employeeFullName: string | null;
  title?: string;
  description?: string;
}) {
  const [rows, setRows] = useState<IncidentSummary[]>(initialRows || []);
  const [loading, setLoading] = useState(initialRows === undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/incidents");
    const body: IncidentSummary[] = res.ok ? await res.json() : [];
    setRows(body);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initialRows === undefined) load();
  }, [initialRows, load]);

  const openRow = (id: string) => {
    setSelected(id);
    setOpen(true);
  };

  const pending = rows.filter((r) => r.status === "awaiting_employee_sig").length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {title}
            {pending > 0 && (
              <Badge variant="destructive">{pending} awaiting</Badge>
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
              No incident reports on file.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filed</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {INCIDENT_CATEGORY_LABEL[r.category]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[r.severity]}>
                        {INCIDENT_SEVERITY_LABEL[r.severity]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "awaiting_employee_sig"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {INCIDENT_STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => openRow(r.id)}>
                        {r.status === "awaiting_employee_sig" ? "Review & sign" : "View"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EmployeeIncidentDialog
        incidentId={selected}
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setSelected(null);
        }}
        onSigned={load}
        employeeFullName={employeeFullName}
      />
    </>
  );
}
