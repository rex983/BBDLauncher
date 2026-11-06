"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTimeClock } from "@/components/features/timeclock/ClockGate";
import { isAdmin } from "@/lib/auth/permissions";
import { checkinTitle } from "@/lib/checkins";
import { localDateInZone } from "@/lib/timesheets/tz";
import { MyNumbersCompact } from "./MyGoals";

// The 3- and 6-hour check-ins (cron /api/cron/rep-checkins makes the bell
// notification). While a sales rep is on the clock this looks for today's
// unread one every couple of minutes and pops it up: "Show me" opens their
// numbers, "Not now" lets it go. Closing marks it read; it stays in the bell.
// Opening it from the bell (/dashboard?checkin=3) goes straight to the numbers.
// Admins get a "View as" picker there: any rep's numbers, as that rep sees them.

const POLL_MS = 2 * 60_000;
const ME = "me";

interface Popped {
  id: string;
  checkpoint: number;
  showing: boolean;
}

export function CheckInPrompt() {
  const { state } = useTimeClock();
  const onClock = !!state && state.status !== "clocked_out";
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const permRole = useSession().data?.user?.permRole;
  const admin = isAdmin(permRole);
  const [popped, setPopped] = useState<Popped | null>(null);
  const [reps, setReps] = useState<{ id: string; name: string }[] | null>(null);
  const [viewAs, setViewAs] = useState(ME);

  // From the bell: straight to the numbers (the bell marked it read).
  const linked = Number(params.get("checkin")) || 0;
  const checkpoint = popped?.checkpoint ?? linked;
  const showing = popped ? popped.showing : !!linked;

  // Admins: the reps to pick from, once the numbers are showing.
  useEffect(() => {
    if (!admin || !showing || reps) return;
    fetch("/api/checkin-reps")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; name: string }[]) => setReps(list))
      .catch(() => setReps([]));
  }, [admin, showing, reps]);

  const look = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const res = await fetch("/api/notifications?unread=1&type=rep_checkin&limit=1").catch(() => null);
    if (!res?.ok) return;
    const [hit] = (await res.json().catch(() => [])) as {
      id: string;
      metadata: { checkpoint?: number; day?: string } | null;
    }[];
    if (hit && hit.metadata?.day === localDateInZone(new Date()))
      setPopped((p) => p ?? { id: hit.id, checkpoint: hit.metadata?.checkpoint ?? 0, showing: false });
  }, []);

  // Only sales reps get check-ins, so only they look.
  useEffect(() => {
    if (!onClock || permRole !== "sales_rep") return;
    void look();
    const timer = window.setInterval(look, POLL_MS);
    window.addEventListener("focus", look);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", look);
    };
  }, [onClock, permRole, look]);

  const close = () => {
    if (popped)
      void fetch(`/api/notifications/${popped.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      }).catch(() => {});
    setPopped(null);
    setViewAs(ME);
    if (linked) {
      const q = new URLSearchParams(params);
      q.delete("checkin");
      router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
    }
  };

  return (
    <Dialog open={!!checkpoint} onOpenChange={(o) => !o && close()}>
      <DialogContent className={showing ? "sm:max-w-xl" : undefined}>
        <DialogHeader>
          <DialogTitle>{checkinTitle(checkpoint)}</DialogTitle>
          {!showing && (
            <DialogDescription>
              You&rsquo;re {checkpoint} hours into your shift. Want to see how you&rsquo;re doing today?
            </DialogDescription>
          )}
        </DialogHeader>
        {showing ? (
          <>
            {admin && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">View as</span>
                <Select value={viewAs} onValueChange={setViewAs}>
                  <SelectTrigger className="h-8 w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ME}>Me</SelectItem>
                    {(reps ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!reps && <span className="text-xs text-muted-foreground">Loading reps…</span>}
              </div>
            )}
            <MyNumbersCompact key={viewAs} showStatus asProfileId={viewAs === ME ? undefined : viewAs} />
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Not now
            </Button>
            <Button onClick={() => setPopped((p) => p && { ...p, showing: true })}>Show me</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
