"use client";

import { useCallback } from "react";
import { useConfirmAction } from "@/components/shared/confirm";

// Deactivate / reactivate / remove a person, each behind a confirmation.
// Shared by the Users list and a person's profile.
//
//   const actions = useUserActions(reload);
//   actions.askToggleActive(user); actions.askRemove(user);
//   return <>{actions.dialog}…</>;

type Target = { id: string; email: string; name: string | null; is_active: boolean };

export function useUserActions(onChanged: () => void) {
  const { ask, dialog } = useConfirmAction(onChanged);

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

  return { askToggleActive, askRemove, dialog };
}
