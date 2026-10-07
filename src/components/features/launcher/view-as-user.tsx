"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useRolePreview,
  type PreviewUser,
} from "@/components/features/launcher/role-preview-context";

// Admin-only: see the launcher exactly as one person does (their role,
// office and the apps/links granted to them by name).
export function ViewAsUser({ users, selfId }: { users: PreviewUser[]; selfId: string }) {
  const router = useRouter();
  const { viewAsUser, setViewAsUser } = useRolePreview();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = users.filter(
      (u) =>
        !needle ||
        u.name.toLowerCase().includes(needle) ||
        u.role_label.toLowerCase().includes(needle) ||
        (u.office ?? "").toLowerCase().includes(needle),
    );
    const by = new Map<string, PreviewUser[]>();
    for (const u of hits) {
      const k = u.office ?? "No office";
      by.set(k, [...(by.get(k) ?? []), u]);
    }
    return [...by.entries()];
  }, [users, q]);

  const pick = (u: PreviewUser) => {
    setOpen(false);
    setQ("");
    if (u.id === selfId) {
      setViewAsUser(null);
      router.push("/dashboard");
    } else {
      setViewAsUser(u);
      router.push(`/dashboard?viewAsUser=${u.id}`);
    }
  };

  return (
    <div ref={box} className="relative">
      <Button variant="outline" size="sm" className="h-8 gap-2" onClick={() => setOpen((o) => !o)}>
        <Eye className="h-4 w-4 text-muted-foreground" />
        <span className="max-w-44 truncate">{viewAsUser ? viewAsUser.name : "View as…"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            className="mb-2 h-8"
          />
          <div className="max-h-80 overflow-y-auto">
            {groups.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">No one matches.</div>}
            {groups.map(([office, people]) => (
              <div key={office} className="mb-1">
                <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {office}
                </div>
                {people.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => pick(u)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                      viewAsUser?.id === u.id && "bg-muted font-medium",
                    )}
                  >
                    <span className="truncate">
                      {u.name}
                      {u.id === selfId && <span className="text-muted-foreground"> (you)</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{u.role_label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
