"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// A real confirmation dialog in place of the browser's confirm() box. The
// dialog stays open with the server's message when the request fails.
//
//   const confirm = useConfirmAction(reload);
//   confirm.ask({ title, body, action: "Delete", destructive: true, run: () => fetch(...) });
//   return <>{confirm.dialog}…</>;

export interface ConfirmRequest {
  title: string;
  body: string;
  /** Label on the confirm button. */
  action: string;
  destructive?: boolean;
  run: () => Promise<Response>;
}

export function useConfirmAction(onDone: () => void) {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback((p: ConfirmRequest) => {
    setError(null);
    setPending(p);
  }, []);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await pending.run();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "That didn't work. Try again.");
        return;
      }
      setPending(null);
      onDone();
    } catch {
      setError("That didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(o) => !o && !busy && setPending(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          <DialogDescription>{pending?.body}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={pending?.destructive ? "destructive" : "default"} onClick={confirm} disabled={busy}>
            {busy ? "Working…" : pending?.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { ask, dialog };
}
