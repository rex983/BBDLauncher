"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LiveState } from "@/lib/timesheets/state";

interface ScheduleData {
  scheduled: boolean;
  end_of_day_iso: string | null;
  extension_until_iso: string | null;
  effective_end_iso: string | null;
}

const PROMPT_LEAD_MS = 5 * 60_000;
const EXTENSION_OPTIONS = [15, 30, 60];
const DISMISSED_KEY = "bbd-shift-prompt-dismissed";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Renders the T-5 min "you're about to be clocked out" prompt at the layout
// level so it appears on every page of the launcher, not just /dashboard.
// The shadcn Dialog overlay already blurs + dims the entire viewport, so
// there's no need for extra chrome here.
export function ShiftEndPrompt() {
  const [state, setState] = useState<LiveState | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [phase, setPhase] = useState<"ask" | "pick" | "custom">("ask");
  const [customMinutes, setCustomMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [meRes, schedRes] = await Promise.all([
      fetch("/api/timeclock/me", { cache: "no-store" }),
      fetch("/api/timeclock/schedule", { cache: "no-store" }),
    ]);
    if (meRes.ok) {
      const data = await meRes.json();
      setState(data.state ?? null);
    }
    if (schedRes.ok) setSchedule(await schedRes.json());
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const isClockedOut = !state || state.status === "clocked_out";

  useEffect(() => {
    if (promptTimer.current) clearTimeout(promptTimer.current);
    promptTimer.current = null;
    setPromptOpen(false);
    setPhase("ask");

    if (isClockedOut) return;
    const effEnd = schedule?.effective_end_iso;
    if (!effEnd) return;
    const dismissedFor = sessionStorage.getItem(DISMISSED_KEY);
    if (dismissedFor === effEnd) return;

    const showAt = new Date(effEnd).getTime() - PROMPT_LEAD_MS;
    const delay = showAt - Date.now();
    if (delay < 0) {
      if (Date.now() < new Date(effEnd).getTime()) setPromptOpen(true);
      return;
    }
    promptTimer.current = setTimeout(() => setPromptOpen(true), delay);
    return () => {
      if (promptTimer.current) clearTimeout(promptTimer.current);
    };
  }, [schedule?.effective_end_iso, isClockedOut]);

  const dismissPrompt = () => {
    if (schedule?.effective_end_iso) {
      sessionStorage.setItem(DISMISSED_KEY, schedule.effective_end_iso);
    }
    setPromptOpen(false);
    setPhase("ask");
  };

  const submitExtension = async (minutes: number) => {
    if (busy) return;
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 480) {
      alert("Enter a number of minutes between 1 and 480.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/timeclock/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(typeof body.error === "string" ? body.error : "Failed to extend");
        return;
      }
      const data = await res.json();
      setSchedule((prev) =>
        prev
          ? {
              ...prev,
              extension_until_iso: data.effective_end_iso,
              effective_end_iso: data.effective_end_iso,
            }
          : prev,
      );
      sessionStorage.removeItem(DISMISSED_KEY);
      setPromptOpen(false);
      setPhase("ask");
    } finally {
      setBusy(false);
    }
  };

  const effEndLabel = schedule?.effective_end_iso ? fmtTime(schedule.effective_end_iso) : "";

  return (
    <Dialog
      open={promptOpen}
      onOpenChange={(o) => {
        if (!o) dismissPrompt();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            You&rsquo;re about to be clocked out at {effEndLabel}
          </DialogTitle>
        </DialogHeader>
        {phase === "ask" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Do you wish to keep working past that time? If you don&rsquo;t answer,
              you&rsquo;ll be clocked out automatically at {effEndLabel}.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={dismissPrompt} disabled={busy}>
                No, clock me out
              </Button>
              <Button onClick={() => setPhase("pick")} disabled={busy}>
                Yes, keep working
              </Button>
            </div>
          </div>
        )}
        {phase === "pick" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">How much longer?</p>
            <div className="grid grid-cols-2 gap-2">
              {EXTENSION_OPTIONS.map((m) => (
                <Button
                  key={m}
                  variant="outline"
                  onClick={() => submitExtension(m)}
                  disabled={busy}
                >
                  {m < 60 ? `${m} min` : `${m / 60} hour`}
                </Button>
              ))}
              <Button variant="outline" onClick={() => setPhase("custom")} disabled={busy}>
                Other…
              </Button>
            </div>
          </div>
        )}
        {phase === "custom" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitExtension(Number.parseInt(customMinutes, 10));
            }}
          >
            <label className="block space-y-2">
              <span className="text-sm text-muted-foreground">Minutes (1–480)</span>
              <input
                type="number"
                min={1}
                max={480}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
                required
                autoFocus
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPhase("pick")}>
                Back
              </Button>
              <Button type="submit" disabled={busy}>
                Extend
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
