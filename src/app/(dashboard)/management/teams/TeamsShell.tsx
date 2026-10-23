"use client";

import { useMemo, useState } from "react";
import { Crown, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Team, TeamPerson } from "@/lib/teams";

// Teams: one card per team (leader + reps). Click a card to edit; New team
// opens the same dialog. Members are a checkbox list of the office's active
// people; ticking someone who's on another team moves them here.

interface Office {
  name: string;
  display_name: string;
}

interface Draft {
  id: string | null;
  name: string;
  office: string;
  leader_id: string;
  member_ids: Set<string>;
}

const roleLabel = (r: string) => r.replace(/_/g, " ");

export default function TeamsShell({
  initialTeams,
  initialPeople,
  offices,
  fixedOffice,
  setupError,
}: {
  initialTeams: Team[];
  initialPeople: TeamPerson[];
  offices: Office[];
  /** A manager's office (teams can't leave it); null for admins. */
  fixedOffice: string | null;
  setupError: string | null;
}) {
  const [teams, setTeams] = useState(initialTeams);
  const [people, setPeople] = useState(initialPeople);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const teamOf = useMemo(() => {
    const m = new Map<string, Team>();
    for (const t of teams) for (const id of t.member_ids) m.set(id, t);
    return m;
  }, [teams]);
  const officeLabel = (name: string) => offices.find((o) => o.name === name)?.display_name ?? name;
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const p = personById.get(id);
    return p ? p.name || p.email : "Former employee";
  };

  const reload = async () => {
    const res = await fetch("/api/management/teams", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    setTeams(body.teams);
    setPeople(body.people);
  };

  const openNew = () => {
    setError(null);
    setSearch("");
    setDraft({ id: null, name: "", office: fixedOffice ?? offices[0]?.name ?? "", leader_id: "", member_ids: new Set() });
  };
  const openEdit = (t: Team) => {
    setError(null);
    setSearch("");
    setDraft({ id: t.id, name: t.name, office: t.office, leader_id: t.leader_id ?? "", member_ids: new Set(t.member_ids) });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const body = {
      name: draft.name,
      office: draft.office,
      leader_id: draft.leader_id || null,
      member_ids: [...draft.member_ids].filter((id) => id !== draft.leader_id),
    };
    const res = await fetch(draft.id ? `/api/management/teams/${draft.id}` : "/api/management/teams", {
      method: draft.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Couldn't save the team.");
      return;
    }
    setDraft(null);
    reload();
  };

  const remove = async () => {
    if (!draft?.id) return;
    if (!confirm(`Delete the team "${draft.name}"? Its reps stay; they're just no longer on a team.`)) return;
    setSaving(true);
    const res = await fetch(`/api/management/teams/${draft.id}`, { method: "DELETE" });
    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Couldn't delete the team.");
      return;
    }
    setDraft(null);
    reload();
  };

  // The dialog's people: the team's office, the leader left out of the list.
  const candidates = draft
    ? people
        .filter((p) => p.office === draft.office && p.id !== draft.leader_id)
        .filter((p) => {
          const q = search.trim().toLowerCase();
          return !q || (p.name ?? "").toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
        })
    : [];
  const leaderOptions = draft ? people.filter((p) => p.office === draft.office) : [];
  const unassigned = people.filter((p) => !teamOf.has(p.id) && p.role === "sales_rep").length;

  const byOffice = new Map<string, Team[]>();
  for (const t of teams) byOffice.set(t.office, [...(byOffice.get(t.office) ?? []), t]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-muted-foreground">
            Team leaders and the reps on their teams. Every BBD app sees these — Rep Insights shows each team&apos;s numbers.
          </p>
        </div>
        {!setupError && (
          <Button onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> New team
          </Button>
        )}
      </div>

      {setupError && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">{setupError}</div>
      )}

      {!setupError && teams.length === 0 && (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No teams yet. Click <span className="font-medium text-foreground">New team</span> to pick a leader and their reps.
        </div>
      )}

      {!setupError && unassigned > 0 && teams.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {unassigned} sales rep{unassigned === 1 ? " isn't" : "s aren't"} on a team yet.
        </p>
      )}

      {[...byOffice].map(([office, list]) => (
        <section key={office} className="space-y-3">
          {!fixedOffice && <h2 className="text-sm font-medium text-muted-foreground">{officeLabel(office)}</h2>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => openEdit(t)}
                className="group rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{t.name}</div>
                  <Pencil className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-sm">
                  <Crown className="h-3.5 w-3.5 text-muted-foreground" />
                  {nameOf(t.leader_id) ?? <span className="text-muted-foreground">No leader</span>}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {t.member_ids.length} rep{t.member_ids.length === 1 ? "" : "s"}
                </div>
                {t.member_ids.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {t.member_ids
                      .map((id) => nameOf(id) ?? "")
                      .sort((a, b) => a.localeCompare(b))
                      .map((n, i) => (
                        <Badge key={`${n}-${i}`} variant="secondary" className="font-normal">
                          {n}
                        </Badge>
                      ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit team" : "New team"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Name</span>
                <Input
                  value={draft.name}
                  maxLength={60}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>

              {!fixedOffice && (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Office</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={draft.office}
                    onChange={(e) => setDraft({ ...draft, office: e.target.value, leader_id: "", member_ids: new Set() })}
                  >
                    {offices.map((o) => (
                      <option key={o.name} value={o.name}>{o.display_name}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block space-y-1 text-sm">
                <span className="font-medium">Team leader</span>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.leader_id}
                  onChange={(e) => {
                    const ids = new Set(draft.member_ids);
                    ids.delete(e.target.value);
                    setDraft({ ...draft, leader_id: e.target.value, member_ids: ids });
                  }}
                >
                  <option value="">No leader</option>
                  {leaderOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.email} · {roleLabel(p.role)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">Reps</span>
                  <span className="text-xs text-muted-foreground">{draft.member_ids.size} picked</span>
                </div>
                <Input placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                  {candidates.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">No one matches.</p>
                  )}
                  {candidates.map((p) => {
                    const on = draft.member_ids.has(p.id);
                    const other = teamOf.get(p.id);
                    const elsewhere = other && other.id !== draft.id ? other : null;
                    return (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-accent">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            const ids = new Set(draft.member_ids);
                            if (e.target.checked) ids.add(p.id);
                            else ids.delete(p.id);
                            setDraft({ ...draft, member_ids: ids });
                          }}
                        />
                        <span className="flex-1 truncate">{p.name || p.email}</span>
                        {elsewhere && (
                          <span className="text-xs text-muted-foreground">
                            {on ? `moves from ${elsewhere.name}` : `on ${elsewhere.name}`}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{roleLabel(p.role)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {draft?.id ? (
              <Button variant="ghost" className="text-destructive" onClick={remove} disabled={saving}>
                <Trash2 className="mr-1 h-4 w-4" /> Delete team
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving || !draft?.name.trim() || !draft?.office}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
