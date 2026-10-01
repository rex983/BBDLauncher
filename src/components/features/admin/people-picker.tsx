"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface Person {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
}

/**
 * Pick individual people by name or email. Used for the "allow individual
 * users" list on apps and links.
 */
export function PeoplePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : []))
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const chosen = new Set(value);
  const q = query.trim().toLowerCase();
  const matches = q
    ? people
        .filter(
          (p) => !chosen.has(p.id) && ((p.name || "").toLowerCase().includes(q) || p.email.toLowerCase().includes(q)),
        )
        .slice(0, 8)
    : [];

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((id) => {
            const p = byId.get(id);
            return (
              <Badge key={id} variant="secondary" className="gap-1 pr-1">
                {p ? p.name || p.email : "Unknown user"}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((v) => v !== id))}
                  className="rounded-sm hover:bg-muted-foreground/20"
                  aria-label={`Remove ${p?.name || p?.email || "user"}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
      <Input placeholder="Add a person — search name or email…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {matches.length > 0 && (
        <div className="rounded-md border divide-y text-sm">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange([...value, p.id]);
                setQuery("");
              }}
              className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-accent"
            >
              <span>{p.name || p.email}</span>
              <span className="text-xs text-muted-foreground">{p.office || p.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
