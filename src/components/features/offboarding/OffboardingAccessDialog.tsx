"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X } from "lucide-react";

export interface AccessPerson {
  id: string;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
  can_offboard: boolean;
}

// Admins choose, person by person, who can open /offboarding. Admins always can.
export function OffboardingAccessDialog({
  open,
  onOpenChange,
  people,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  people: AccessPerson[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const label = (p: AccessPerson) => p.name || p.email;

  const admins = people.filter((p) => p.role === "admin" && p.is_active);
  const team = people.filter((p) => p.role !== "admin" && p.can_offboard);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people
      .filter(
        (p) =>
          p.is_active &&
          p.role !== "admin" &&
          !p.can_offboard &&
          ((p.name || "").toLowerCase().includes(q) || p.email.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [people, query]);

  const set = async (p: AccessPerson, allowed: boolean) => {
    setBusy(p.id);
    const res = await fetch("/api/offboarding/access", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: p.id, allowed }),
    });
    setBusy(null);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      alert(typeof b.error === "string" ? b.error : "Couldn't update access");
      return;
    }
    setQuery("");
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who can use Offboarding</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Team</div>
          {team.length === 0 && <p className="text-sm text-muted-foreground">No one yet — add people below.</p>}
          <div className="divide-y rounded-md border">
            {team.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="flex-1">
                  {label(p)}
                  <span className="ml-2 text-xs text-muted-foreground">{p.email}</span>
                </span>
                {!p.is_active && <Badge variant="outline" className="text-[10px]">inactive</Badge>}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => set(p, false)}
                  disabled={busy === p.id}
                  title="Remove access"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Input placeholder="Add a person — search name or email…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {matches.length > 0 && (
            <div className="divide-y rounded-md border text-sm">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set(p, true)}
                  disabled={busy === p.id}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-accent"
                >
                  <span>{label(p)}</span>
                  <span className="text-xs text-muted-foreground">{p.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Admins always have access: {admins.map(label).join(", ") || "—"}. Changes apply on the
          person&rsquo;s next click.
        </p>
      </DialogContent>
    </Dialog>
  );
}
