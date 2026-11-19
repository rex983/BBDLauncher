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

// Deactivate / reactivate / remove, with a real confirmation instead of the
// browser's confirm() box. Shared by the Users list and a person's profile.
//
//   const actions = useUserActions(reload);
//   actions.askToggleActive(user); actions.askRemove(user);
//   return <>{actions.dialog}…</>;

type Target = { id: string; email: string; name: string | null; is_active: boolean };

type Pending = {
  title: string;
  body: string;
  action: string;
  destructive: boolean;
  run: () => Promise<Response>;
};

export function useUserActions(onChanged: () => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback((p: Pending) => {
    setError(null);
    setPending(p);
  }, []);

  const askToggleActive = useCallback(
    (u: Target) => {
      const who = u.name || u.email;
      const next = u.is_active === false;
      ask({
        title: next ? `Reactivate ${who}?` : `Deactivate ${who}?`,
        body: next
          ? "They'll be able to sign in again, with the role and office they had."
          : "They'll be signed out right away and lose access to every BBD app. Their records stay, and you can reactivate them later.",
        action: next ? "Reactivate" : "Deactivate",
        destructive: !next,
        run: () =>
          fetch(`/api/users/${u.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: next }),
          }),
      });
    },
    [ask],
  );

  const askRemove = useCallback(
    (u: Target) => {
      const who = u.name || u.email;
      ask({
        title: `Remove ${who}?`,
        body: `This deletes the account for ${u.email}. They lose access immediately and it can't be undone. To keep their history, deactivate them instead.`,
        action: "Remove",
        destructive: true,
        run: () => fetch(`/api/users/${u.id}`, { method: "DELETE" }),
      });
    },
    [ask],
  );

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
      onChanged();
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

  return { askToggleActive, askRemove, dialog };
}
