"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTimeClock } from "@/components/features/timeclock/ClockGate";
import { MyNumbersCompact } from "./MyGoals";

// The 3- and 6-hour check-ins (cron /api/cron/rep-checkins makes the bell
// notification). While a rep is on the clock this looks for today's unread
// one every couple of minutes and pops it up: "Show me" opens their numbers,
// "Not now" lets it go. Either way it's marked read, and it stays in the bell.
// Opening it from the bell (/dashboard?checkin=3) goes straight to the numbers.
// Admins get a "View as" picker there: any rep's numbers, as that rep sees them.

const POLL_MS = 2 * 60_000;

interface CheckIn {
  id: string;
  title: string;
  checkpoint: number;
}

const todayEt = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export function CheckInPrompt() {
  const { state } = useTimeClock();
  const onClock = !!state && state.status !== "clocked_out";
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState<CheckIn | null>(null);
  const [showing, setShowing] = useState(false);
  const admin = useSession().data?.user?.permRole === "admin";
  const [reps, setReps] = useState<{ id: string; name: string }[] | null>(null);
  const [viewAs, setViewAs] = useState("me");

  // Admins: the reps to pick from, once the numbers are showing.
  useEffect(() => {
    if (!admin || !showing || reps) return;
    fetch("/api/checkin-reps")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; name: string }[]) => setReps(list))
      .catch(() => setReps([]));
  }, [admin, showing, reps]);

  // From the bell: straight to the numbers.
  const linked = params.get("checkin");
  useEffect(() => {
    if (!linked) return;
    setOpen({ id: "", title: `${linked} hours in: how's today going?`, checkpoint: Number(linked) || 0 });
    setShowing(true);
  }, [linked]);

  const look = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const res = await fetch("/api/notifications?unread=1&limit=20").catch(() => null);
    if (!res?.ok) return;
    const rows = (await res.json().catch(() => [])) as {
      id: string;
      type: string;
      title: string;
      metadata: { checkpoint?: number; day?: string } | null;
    }[];
    const today = todayEt();
    const hit = rows.find((n) => n.type === "rep_checkin" && n.metadata?.day === today);
    if (hit) setOpen((o) => o ?? { id: hit.id, title: hit.title, checkpoint: hit.metadata?.checkpoint ?? 0 });
  }, []);

  useEffect(() => {
    if (!onClock) return;
    void look();
    const timer = window.setInterval(look, POLL_MS);
    const onFocus = () => void look();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [onClock, look]);

  const markRead = (id: string) => {
    if (!id) return;
    void fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    }).catch(() => {});
  };

  const close = () => {
    if (open) markRead(open.id);
    setOpen(null);
    setShowing(false);
    setViewAs("me");
    if (linked) {
      const q = new URLSearchParams(params);
      q.delete("checkin");
      router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
    }
  };

  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && close()}>
      <DialogContent className={showing ? "sm:max-w-xl" : undefined}>
        <DialogHeader>
          <DialogTitle>{open?.title}</DialogTitle>
          {!showing && (
            <DialogDescription>
              You&rsquo;re {open?.checkpoint} hours into your shift. Want to see how you&rsquo;re doing today?
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
                    <SelectItem value="me">Me</SelectItem>
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
            <MyNumbersCompact key={viewAs} showStatus asProfileId={viewAs === "me" ? undefined : viewAs} />
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Not now
            </Button>
            <Button
              onClick={() => {
                if (open) markRead(open.id);
                setShowing(true);
              }}
            >
              Show me
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
