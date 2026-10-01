"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListChecks, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CASE_STATUS_LABEL,
  CASE_STATUS_VARIANT,
  OFFBOARDING_REASON_LABEL,
  OFFBOARDING_REASONS,
  type CaseSummary,
  type OffboardingReason,
} from "@/lib/offboarding/types";

interface Person {
  id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
  department: string | null;
  is_active: boolean;
}

export function fmtDay(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function OffboardingListShell({
  initialCases,
  people,
}: {
  initialCases: CaseSummary[];
  people: Person[];
}) {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [startOpen, setStartOpen] = useState(false);

  const rows = useMemo(
    () => initialCases.filter((c) => (tab === "open" ? c.status === "open" : c.status !== "open")),
    [initialCases, tab],
  );
  const openCount = initialCases.filter((c) => c.status === "open").length;
  const busyProfileIds = new Set(
    initialCases.filter((c) => c.status === "open" && c.profile_id).map((c) => c.profile_id as string),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Offboarding</h1>
          <p className="text-muted-foreground">
            Revoke access, back up data and collect equipment when someone leaves — with a
            record of who did each step and when.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/offboarding/checklist">
              <ListChecks className="mr-2 h-4 w-4" />
              Edit checklist
            </Link>
          </Button>
          <Button onClick={() => setStartOpen(true)}>
            <UserMinus className="mr-2 h-4 w-4" />
            Start offboarding
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="open">
            Open
            <Badge variant="secondary" className="ml-2">{openCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
        </TabsList>
      </Tabs>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Office</TableHead>
            <TableHead>Last day</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => {
            const done = c.total_tasks - c.open_tasks;
            const pct = c.total_tasks ? Math.round((done / c.total_tasks) * 100) : 0;
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <Link href={`/offboarding/${c.id}`} className="font-medium hover:underline">
                    {c.employee_name || c.employee_email}
                  </Link>
                  <div className="text-xs text-muted-foreground">{c.employee_email}</div>
                </TableCell>
                <TableCell>{c.employee_office || "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDay(c.last_day)}</TableCell>
                <TableCell>{OFFBOARDING_REASON_LABEL[c.reason]}</TableCell>
                <TableCell className="min-w-[140px]">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {done}/{c.total_tasks}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={CASE_STATUS_VARIANT[c.status]}>{CASE_STATUS_LABEL[c.status]}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                {tab === "open" ? "No offboardings in progress." : "No closed offboardings yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <StartOffboardingDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        people={people.filter((p) => !busyProfileIds.has(p.id))}
      />
    </div>
  );
}

function StartOffboardingDialog({
  open,
  onOpenChange,
  people,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  people: Person[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [profileId, setProfileId] = useState("");
  const [lastDay, setLastDay] = useState(todayISO());
  const [reason, setReason] = useState<OffboardingReason>("resigned");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter(
      (p) => !q || (p.name || "").toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
    );
  }, [people, query]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/offboarding/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId, last_day: lastDay, reason, notes: notes || null }),
    });
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.error === "string" ? body.error : "Couldn't start offboarding");
      return;
    }
    router.push(`/offboarding/${body.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start offboarding</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Input
              placeholder="Search name or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {/* A plain list, not a Select: a searchable list of everyone is
                easier to scan, and nests cleanly inside the dialog. */}
            <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProfileId(p.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                    profileId === p.id && "bg-primary/10 font-medium",
                  )}
                >
                  <span className="truncate">{p.name || p.email}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {p.office || "no office"}
                    {!p.is_active && " · inactive"}
                  </span>
                </button>
              ))}
              {matches.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {people.length === 0 ? "No employees found." : "No one matches that search."}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ob-last-day">Last day</Label>
              <Input
                id="ob-last-day"
                type="date"
                value={lastDay}
                onChange={(e) => setLastDay(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as OffboardingReason)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OFFBOARDING_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ob-notes">Notes</Label>
            <Textarea
              id="ob-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the team should know (e.g. who takes over their accounts)"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Creates a checklist from the template plus a task for every launcher app they can
            open. Nothing is turned off until someone runs each step.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !profileId || !lastDay}>
              {saving ? "Starting…" : "Start offboarding"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
