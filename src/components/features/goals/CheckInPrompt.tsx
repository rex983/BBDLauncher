"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTimeClock } from "@/components/features/timeclock/ClockGate";
import { MyNumbersCompact } from "./MyGoals";

// The 3- and 6-hour check-ins (cron /api/cron/rep-checkins makes the bell
// notification). While a rep is on the clock this looks for today's unread
// one every couple of minutes and pops it up: "Show me" opens their numbers,
// "Not now" lets it go. Either way it's marked read, and it stays in the bell.
// Opening it from the bell (/dashboard?checkin=3) goes straight to the numbers.

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
            <MyNumbersCompact showStatus />
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
