"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";

type Type = "vacation" | "sick" | "personal" | "other";
type Status = "pending" | "approved" | "denied" | "cancelled";

interface Req {
  id: string;
  type: Type;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  reason: string | null;
  status: Status;
  decided_note: string | null;
  created_at: string;
}

const statusBadge: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  denied: "destructive",
  cancelled: "outline",
};

function fmt(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function MyTimeOffPage() {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    type: "vacation" as Type,
    start_date: today,
    end_date: today,
    full_day: true,
    hours: "" as string | "",
    reason: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/timeoff");
    setRows(res.ok ? await res.json() : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/timeoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.type,
        start_date: form.start_date,
        end_date: form.end_date,
        full_day: form.full_day,
        hours: form.full_day ? null : Number(form.hours),
        reason: form.reason || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(typeof body.error === "string" ? body.error : "Failed to submit");
      return;
    }
    setOpen(false);
    load();
  };

  const cancel = async (id: string) => {
    if (!confirm("Cancel this request?")) return;
    const res = await fetch(`/api/timeoff/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Cancel failed"); return; }
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Time Off</h1>
          <p className="text-muted-foreground">Submit vacation, sick, or personal requests.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Request time off</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Request time off</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as Type })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vacation">Vacation</SelectItem>
                    <SelectItem value="sick">Sick</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Start</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>End</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 font-normal">
                  <input
                    type="checkbox"
                    checked={form.full_day}
                    onChange={(e) => setForm({ ...form, full_day: e.target.checked })}
                  />
                  Full day(s)
                </Label>
                {!form.full_day && (
                  <div className="space-y-2">
                    <Label>Hours</Label>
                    <Input
                      type="number" min="0.25" max="24" step="0.25"
                      value={form.hours}
                      onChange={(e) => setForm({ ...form, hours: e.target.value })}
                      required
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Reason (optional)</Label>
                <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
              <div className="flex justify-end">
                <Button type="submit">Submit</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Dates</TableHead>
            <TableHead>Length</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          )}
          {!loading && rows.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No requests yet.</TableCell></TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
              <TableCell>
                {fmt(r.start_date)}{r.start_date !== r.end_date && <> – {fmt(r.end_date)}</>}
              </TableCell>
              <TableCell>{r.full_day ? "Full day" : `${r.hours}h`}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{r.reason || "—"}</TableCell>
              <TableCell>
                <Badge variant={statusBadge[r.status]}>{r.status}</Badge>
                {r.decided_note && (
                  <div className="text-xs text-muted-foreground mt-1">{r.decided_note}</div>
                )}
              </TableCell>
              <TableCell>
                {r.status === "pending" && (
                  <Button variant="ghost" size="sm" onClick={() => cancel(r.id)}>
                    Cancel
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
