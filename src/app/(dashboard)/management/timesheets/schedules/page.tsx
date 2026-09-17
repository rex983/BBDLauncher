"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { canEditTimeData } from "@/lib/auth/permissions";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { Pencil } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_START = "10:00";
const DEFAULT_END = "18:00";

interface Profile {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
}
interface Schedule {
  profile_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
}

function fmt(t: string) {
  // HH:MM(:SS) → 12h
  const [h, m] = t.split(":");
  const H = Number(h);
  const suffix = H >= 12 ? "PM" : "AM";
  const twelve = ((H + 11) % 12) + 1;
  return `${twelve}:${m} ${suffix}`;
}

export default function SchedulesPage() {
  const { data: session } = useSession();
  const canEdit = canEditTimeData(session?.user?.role);
  const { viewAsOffice } = useRolePreview();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editing, setEditing] = useState<{ profile: Profile } | null>(null);
  const [form, setForm] = useState<Record<number, { start: string; end: string; enabled: boolean }>>({});

  const load = useCallback(async () => {
    // Forward the admin's preview-office (if any) so this page shows what a
    // manager in that office would see. Real managers get office-scoped
    // server-side regardless of this param.
    const qs = viewAsOffice ? `?office=${encodeURIComponent(viewAsOffice)}` : "";
    const res = await fetch(`/api/management/schedules${qs}`);
    if (!res.ok) return;
    const data = await res.json();
    setProfiles(data.profiles);
    setSchedules(data.schedules);
  }, [viewAsOffice]);

  useEffect(() => { load(); }, [load]);

  const scheduleFor = (profileId: string, weekday: number) =>
    schedules.find((s) => s.profile_id === profileId && s.weekday === weekday);

  const openEdit = (profile: Profile) => {
    const initial: Record<number, { start: string; end: string; enabled: boolean }> = {};
    for (let w = 0; w < 7; w++) {
      const existing = scheduleFor(profile.id, w);
      initial[w] = existing
        ? { start: existing.start_time.slice(0, 5), end: existing.end_time.slice(0, 5), enabled: true }
        : { start: DEFAULT_START, end: DEFAULT_END, enabled: false };
    }
    setForm(initial);
    setEditing({ profile });
  };

  const save = async () => {
    if (!editing) return;
    for (let w = 0; w < 7; w++) {
      const row = form[w];
      const existing = scheduleFor(editing.profile.id, w);
      if (row.enabled) {
        await fetch("/api/management/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile_id: editing.profile.id,
            weekday: w,
            start_time: row.start,
            end_time: row.end,
          }),
        });
      } else if (existing) {
        await fetch("/api/management/schedules", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile_id: editing.profile.id, weekday: w }),
        });
      }
    }
    setEditing(null);
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-muted-foreground">
          <Link href="/management/timesheets" className="hover:underline">
            ← Timesheets
          </Link>
        </div>
        <h1 className="text-2xl font-bold">Schedules</h1>
        <p className="text-muted-foreground">
          Per-employee weekly hours. Default is 10:00 AM – 6:00 PM ET when no override is set.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            {DAYS.map((d) => <TableHead key={d}>{d}</TableHead>)}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {profiles.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">
                {p.name || p.email}
                {p.office && <Badge variant="outline" className="ml-2">{p.office}</Badge>}
              </TableCell>
              {DAYS.map((_, w) => {
                const s = scheduleFor(p.id, w);
                return (
                  <TableCell key={w} className="text-xs text-muted-foreground">
                    {s
                      ? <span className="text-foreground">{fmt(s.start_time)}–{fmt(s.end_time)}</span>
                      : "—"}
                  </TableCell>
                );
              })}
              <TableCell>
                {canEdit && (
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit schedule — {editing?.profile.name || editing?.profile.email}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {DAYS.map((label, w) => (
              <div key={w} className="flex items-center gap-3">
                <label className="flex items-center gap-2 w-20 text-sm">
                  <input
                    type="checkbox"
                    checked={form[w]?.enabled || false}
                    onChange={(e) =>
                      setForm({ ...form, [w]: { ...form[w], enabled: e.target.checked } })
                    }
                  />
                  {label}
                </label>
                <Input
                  type="time"
                  disabled={!form[w]?.enabled}
                  value={form[w]?.start || DEFAULT_START}
                  onChange={(e) =>
                    setForm({ ...form, [w]: { ...form[w], start: e.target.value } })
                  }
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  disabled={!form[w]?.enabled}
                  value={form[w]?.end || DEFAULT_END}
                  onChange={(e) =>
                    setForm({ ...form, [w]: { ...form[w], end: e.target.value } })
                  }
                  className="w-32"
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Unchecked days = no work / off. Uncheck a previously-set day to remove its override
              (default 10-6 ET reapplies on weekdays).
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
