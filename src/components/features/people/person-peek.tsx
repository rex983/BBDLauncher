"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Check, Clock, Copy, Eye, Mail, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canManageContent } from "@/lib/auth/permissions";
import { fmtDateTimeUS, fmtDateUS, fmtRelative } from "@/components/shared/format";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import type { PersonSummary } from "@/lib/people/summary";
import { PersonAvatar } from "./person-avatar";

// Click a name anywhere in the launcher → their card slides in from the
// right: photo, role, office, team, what they're doing right now. Admins and
// managers only; for everyone else a PersonLink is plain text.
//
//   <PersonLink id={row.profile.id} name={row.profile.name} email={row.profile.email} />

type Peek = { open: (id: string, hint?: { name?: string | null }) => void; enabled: boolean };

const PeekContext = createContext<Peek>({ open: () => {}, enabled: false });

export function usePersonPeek() {
  return useContext(PeekContext);
}

const STATUS_DOT: Record<string, string> = {
  working: "bg-emerald-500",
  on_lunch: "bg-amber-500",
  on_break: "bg-amber-500",
  clocked_out: "bg-muted-foreground/40",
};

export function PersonPeekProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const { viewAs, viewAsUser, setViewAsUser } = useRolePreview();
  const router = useRouter();
  const pathname = usePathname();
  // While an admin Views as someone, the page is theirs: names are only
  // clickable if that person could click them.
  const role = viewAs && viewAsUser ? viewAsUser.perm_role : session?.user?.permRole;
  const enabled = canManageContent(role);

  const [target, setTarget] = useState<{ id: string; name?: string | null } | null>(null);
  const [person, setPerson] = useState<PersonSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cache = useRef(new Map<string, { at: number; person: PersonSummary }>());

  const open = useCallback((id: string, hint?: { name?: string | null }) => {
    setTarget({ id, name: hint?.name });
  }, []);

  useEffect(() => {
    if (!target) return;
    setError(null);
    setCopied(false);
    const hit = cache.current.get(target.id);
    // Clock status moves, so a card is only reused for a minute.
    if (hit && Date.now() - hit.at < 60_000) {
      setPerson(hit.person);
      return;
    }
    setPerson(null);
    let cancelled = false;
    fetch(`/api/people/${target.id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "This person isn't available to you." : "Couldn't load this person.");
        return (await r.json()) as PersonSummary;
      })
      .then((p) => {
        if (cancelled) return;
        cache.current.set(p.id, { at: Date.now(), person: p });
        setPerson(p);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [target]);

  // Moving to another page closes the card.
  useEffect(() => setTarget(null), [pathname]);

  const value = useMemo(() => ({ open, enabled }), [open, enabled]);
  const name = person?.name || person?.email || target?.name || "Person";

  const copyEmail = async () => {
    if (!person) return;
    try {
      await navigator.clipboard.writeText(person.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the address is on screen to select.
    }
  };

  const startViewAs = () => {
    if (!person?.view_as) return;
    setViewAsUser(person.view_as);
    setTarget(null);
    router.push(`/dashboard?viewAsUser=${person.id}`);
  };

  return (
    <PeekContext.Provider value={value}>
      {children}
      <DialogPrimitive.Root open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l bg-background shadow-xl outline-none duration-200 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
          >
            <DialogPrimitive.Close className="absolute right-3 top-3 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>

            <div className="flex flex-col items-center gap-3 border-b px-6 pb-5 pt-8 text-center">
              <PersonAvatar
                profileId={target?.id}
                name={name}
                size={112}
                hasPhoto={person ? person.has_photo : undefined}
                className="ring-2 ring-border"
              />
              <div className="min-w-0 max-w-full">
                <DialogPrimitive.Title className="truncate text-xl font-semibold">{name}</DialogPrimitive.Title>
                {person && (
                  <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                    <Badge variant="secondary">{person.role_label}</Badge>
                    {person.is_it && <Badge>IT</Badge>}
                    {person.can_offboard && <Badge variant="outline">Offboarding</Badge>}
                    {!person.is_active && <Badge variant="destructive">Inactive</Badge>}
                  </div>
                )}
                {person?.clock && (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[person.clock.status])} />
                    {person.clock.label}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {error && <p className="text-sm text-muted-foreground">{error}</p>}
              {!person && !error && (
                <div className="space-y-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-muted" />
                  ))}
                </div>
              )}
              {person && (
                <dl className="space-y-3 text-sm">
                  <Field label="Email">
                    <span className="flex items-center gap-1">
                      <a href={`mailto:${person.email}`} className="truncate hover:underline">
                        {person.email}
                      </a>
                      <button
                        type="button"
                        onClick={copyEmail}
                        title="Copy email"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </span>
                  </Field>
                  <Field label="Office">{person.office_label ?? "—"}</Field>
                  <Field label="Department">{person.department_label ?? "—"}</Field>
                  <Field label="Team">
                    {person.team ? (
                      <>
                        {person.team.name}
                        {person.team.leader_id && person.team.leader_id !== person.id && person.team.leader_name && (
                          <span className="text-muted-foreground">
                            {" · led by "}
                            <button
                              type="button"
                              className="hover:underline"
                              onClick={() => open(person.team!.leader_id!, { name: person.team!.leader_name })}
                            >
                              {person.team.leader_name}
                            </button>
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </Field>
                  {person.leads.length > 0 && <Field label="Leads">{person.leads.join(", ")}</Field>}
                  <Field label="Added">{fmtDateUS(person.created_at)}</Field>
                  {person.can.activity && (
                    <Field label="Last launcher activity">
                      {person.last_activity ? (
                        <span title={fmtDateTimeUS(person.last_activity)}>
                          {fmtRelative(person.last_activity, fmtDateUS)}
                        </span>
                      ) : (
                        "Never"
                      )}
                    </Field>
                  )}
                </dl>
              )}
            </div>

            {person && (
              <div className="space-y-2 border-t px-6 py-4">
                <Button asChild className="w-full">
                  <Link href={`/admin/users/${person.id}`}>
                    <UserRound className="h-4 w-4" />
                    Open full profile
                  </Link>
                </Button>
                <div className="flex gap-2">
                  {person.can.time && (
                    <Button asChild variant="outline" className="flex-1">
                      <Link href={`/management/timesheets/${person.id}`}>
                        <Clock className="h-4 w-4" />
                        Timesheet
                      </Link>
                    </Button>
                  )}
                  {person.view_as && (
                    <Button variant="outline" className="flex-1" onClick={startViewAs}>
                      <Eye className="h-4 w-4" />
                      View as
                    </Button>
                  )}
                  <Button asChild variant="outline" className="flex-1">
                    <a href={`mailto:${person.email}`}>
                      <Mail className="h-4 w-4" />
                      Email
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </PeekContext.Provider>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * A person's name that opens their card. Plain text for people who can't
 * open it (not an admin or manager), or when there's no profile id.
 */
export function PersonLink({
  id,
  name,
  email,
  avatar = false,
  hasPhoto,
  size = 24,
  className,
  children,
}: {
  id: string | null | undefined;
  name?: string | null;
  email?: string | null;
  /** Show their photo before the name. */
  avatar?: boolean;
  hasPhoto?: boolean;
  size?: number;
  className?: string;
  /** Replaces the name as the label. */
  children?: React.ReactNode;
}) {
  const { open, enabled } = usePersonPeek();
  const label = children ?? (name || email || "Unknown");
  const photo = avatar ? <PersonAvatar profileId={id} name={name || email} size={size} hasPhoto={hasPhoto} /> : null;

  if (!enabled || !id) {
    return (
      <span className={cn(avatar && "inline-flex items-center gap-2", className)}>
        {photo}
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        open(id, { name: name || email });
      }}
      title="View profile"
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-sm text-left font-[inherit] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {photo}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
