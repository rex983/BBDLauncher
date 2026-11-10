"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AtSign, ListPlus, Paperclip, UserPlus, X } from "lucide-react";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { fmtDay } from "@/components/shared/format";
import {
  daysLeft,
  ONBOARDING_TTL_DAYS,
  onboardingStatus,
  tasksDone,
  type OnboardingRequest,
} from "@/lib/onboarding/types";
import { ACCEPT_DOCS, uploadDocuments } from "./upload";
import { ChecklistDialog, TaggingDialog } from "./OnboardingSettings";

export function OnboardingListShell({ initial, isAdmin }: { initial: OnboardingRequest[]; isAdmin: boolean }) {
  const [newOpen, setNewOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [taggingOpen, setTaggingOpen] = useState(false);
  const { viewAsUser } = useRolePreview();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Onboarding</h1>
          <p className="text-muted-foreground">
            {isAdmin
              ? "New hires managers have asked for. Work the checklist, then enter their login."
              : "Add a new hire and their accounts get set up. You'll get their login here."}{" "}
            Each request deletes itself after {ONBOARDING_TTL_DAYS} days.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <>
              <Button variant="outline" onClick={() => setTaggingOpen(true)} disabled={!!viewAsUser}>
                <AtSign className="mr-2 h-4 w-4" />
                Who gets tagged
              </Button>
              <Button variant="outline" onClick={() => setChecklistOpen(true)} disabled={!!viewAsUser}>
                <ListPlus className="mr-2 h-4 w-4" />
                Add task
              </Button>
            </>
          )}
          <Button onClick={() => setNewOpen(true)} disabled={!!viewAsUser}>
            <UserPlus className="mr-2 h-4 w-4" />
            New hire
          </Button>
        </div>
      </div>

      {initial.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No open onboarding requests.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>New hire</TableHead>
              <TableHead>Date of hire</TableHead>
              {isAdmin && <TableHead>Requested by</TableHead>}
              <TableHead>Checklist</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Deletes in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initial.map((r) => {
              const status = onboardingStatus(r);
              const left = daysLeft(r.expires_at);
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/onboarding/${r.id}`} className="font-medium hover:underline">
                      {r.first_name} {r.last_name}
                    </Link>
                  </TableCell>
                  <TableCell>{fmtDay(r.hire_date)}</TableCell>
                  {isAdmin && <TableCell>{r.created_by_name || "—"}</TableCell>}
                  <TableCell className="tabular-nums">
                    {tasksDone(r)}/{r.tasks.length}
                  </TableCell>
                  <TableCell>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {left === 1 ? "1 day" : `${left} days`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <NewHireDialog open={newOpen} onOpenChange={setNewOpen} />
      {isAdmin && <ChecklistDialog open={checklistOpen} onOpenChange={setChecklistOpen} />}
      {isAdmin && <TaggingDialog open={taggingOpen} onOpenChange={setTaggingOpen} />}
    </div>
  );
}

function NewHireDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [dob, setDob] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: first, last_name: last, hire_date: hireDate, dob }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaving(false);
      setError(typeof body.error === "string" ? body.error : "Couldn't save");
      return;
    }
    const failed = await uploadDocuments(body.id, files);
    // The request page lists what made it, and has its own upload button.
    router.push(failed.length ? `/onboarding/${body.id}?uploadFailed=${failed.length}` : `/onboarding/${body.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New hire</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ob-first">First name</Label>
              <Input id="ob-first" value={first} onChange={(e) => setFirst(e.target.value)} required maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-last">Last name</Label>
              <Input id="ob-last" value={last} onChange={(e) => setLast(e.target.value)} required maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-hire">Date of hire</Label>
              <Input id="ob-hire" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-dob">Date of birth</Label>
              <Input id="ob-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Documents</Label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
              <Paperclip className="h-4 w-4" />
              Add files (photo, PDF, Word — 10 MB each)
              <input
                type="file"
                multiple
                accept={ACCEPT_DOCS}
                className="sr-only"
                onChange={(e) => {
                  const picked = Array.from(e.target.files || []);
                  setFiles((prev) => [...prev, ...picked]);
                  e.target.value = "";
                }}
              />
            </label>
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Submit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
