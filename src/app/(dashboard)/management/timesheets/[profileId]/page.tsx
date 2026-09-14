"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { use } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  computeState, formatDuration, STATUS_LABEL,
  type PunchEventType, type TimePunch,
} from "@/lib/timesheets/state";
import { canEditTimeData } from "@/lib/auth/permissions";

const EVENT_TYPES: { value: PunchEventType; label: string }[] = [
  { value: "clock_in",    label: "Clock in" },
  { value: "clock_out",   label: "Clock out" },
  { value: "lunch_start", label: "Lunch start" },
  { value: "lunch_end",   label: "Lunch end" },
  { value: "break_start", label: "Break start" },
  { value: "break_end",   label: "Break end" },
];

interface Profile {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
  department: string | null;
}

// Convert a UTC ISO to a value acceptable by <input type="datetime-local">.
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToISO(local: string): string {
  return new Date(local).toISOString();
}

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = use(params);
  const { data: session } = useSession();
  const canEdit = canEditTimeData(session?.user?.role);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [punches, setPunches] = useState<TimePunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [dialogOpen, setDialogOpen] = useState(false);
  // When null the dialog is in Add mode; otherwise it's editing an existing
  // punch and PATCHes /api/management/timesheets/punches/[editingId].
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    event_type: "clock_in" as PunchEventType,
    occurred_at: isoToLocalInput(new Date().toISOString()),
    note: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    const url = `/api/management/timesheets/employee/${profileId}?from=${from.toISOString()}&to=${now.toISOString()}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setProfile(data.profile);
      setPunches(data.punches);
    }
    setLoading(false);
  }, [profileId, days]);

  useEffect(() => { load(); }, [load]);

  const state = computeState(punches);

  const openAdd = () => {
    setEditingId(null);
    setForm({
      event_type: "clock_in",
      occurred_at: isoToLocalInput(new Date().toISOString()),
      note: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (p: TimePunch) => {
    setEditingId(p.id);
    setForm({
      event_type: p.event_type,
      occurred_at: isoToLocalInput(p.occurred_at),
      note: p.note ?? "",
    });
    setDialogOpen(true);
  };

  const submitPunch = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = JSON.stringify({
      event_type: form.event_type,
      occurred_at: localInputToISO(form.occurred_at),
      note: form.note || (editingId ? null : undefined),
    });
    const res = editingId
      ? await fetch(`/api/management/timesheets/punches/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
        })
      : await fetch(`/api/management/timesheets/employee/${profileId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      alert(typeof b.error === "string" ? b.error : editingId ? "Edit failed" : "Failed to add punch");
      return;
    }
    setDialogOpen(false);
    setEditingId(null);
    load();
  };

  const deletePunch = async (id: string) => {
    if (!confirm("Delete this punch?")) return;
    const res = await fetch(`/api/management/timesheets/punches/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Delete failed"); return; }
    load();
  };

  // Group punches by date for readability.
  const byDay = new Map<string, TimePunch[]>();
  for (const p of punches) {
    const day = new Date(p.occurred_at).toLocaleDateString();
    const list = byDay.get(day) || [];
    list.push(p);
    byDay.set(day, list);
  }
  const days_desc = [...byDay.entries()].sort(
    (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime(),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">
            <Link href="/management/timesheets" className="hover:underline">
              ← Timesheets
            </Link>
          </div>
          <h1 className="text-2xl font-bold">
            {profile?.name || profile?.email || "…"}
          </h1>
          <div className="text-muted-foreground text-sm">
            {profile?.email}
            {profile?.office && <> · <Badge variant="outline">{profile.office}</Badge></>}
            {profile?.department && <> · <Badge variant="outline">{profile.department}</Badge></>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 1 day</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          {canEdit && (
            <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" />Add punch</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Status" value={STATUS_LABEL[state.status]} />
        <StatCard label={`Worked (last ${days}d)`} value={formatDuration(state.worked_ms)} />
        <StatCard label="Lunch" value={formatDuration(state.lunch_ms)} />
        <StatCard label="Breaks" value={formatDuration(state.break_ms)} />
      </div>

      {loading && <p className="text-muted-foreground">Loading…</p>}

      {!loading && days_desc.length === 0 && (
        <p className="text-muted-foreground">No punches in this window.</p>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditingId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit punch" : "Add punch"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitPunch} className="space-y-4">
            <div className="space-y-2">
              <Label>Event</Label>
              <Select
                value={form.event_type}
                onValueChange={(v) => setForm({ ...form, event_type: v as PunchEventType })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Time</Label>
              <Input
                type="datetime-local"
                value={form.occurred_at}
                onChange={(e) => setForm({ ...form, occurred_at: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">
                {editingId
                  ? "Adjust the actual clock-in/out time — the punch will be marked as an admin edit."
                  : "Backfill a missing punch — use this when an employee forgot."}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="e.g. Employee arrived at 10:00, forgot to punch"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit">{editingId ? "Save" : "Add"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {days_desc.map(([day, list]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {day}
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Note</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {new Date(p.occurred_at).toLocaleTimeString([], {
                      hour: "numeric", minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.event_type.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{p.source}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{p.note || "—"}</TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(p)}
                          title="Edit this punch"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deletePunch(p.id)}
                          title="Delete this punch"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}
