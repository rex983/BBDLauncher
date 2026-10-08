"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtRelative, fmtWhen } from "@/components/shared/format";
import type { CheckStatus, HealthCheck, MailboxHealth, RetiredMailHealth } from "@/lib/offboarding/retired-mail-health";
import { mailboxInfo, shortMailbox } from "@/lib/offboarding/mailboxes";
import { Bell, ChevronDown, Pencil, Search, VolumeX, X } from "lucide-react";

export interface Person {
  id: string;
  name: string | null;
  email: string;
  office: string | null;
}

// One alert the automation fired. No email content is kept.
export interface Fire {
  id: string;
  received_at: string;
  mailbox: string;
  slack_posted: boolean;
  slack_error: string | null;
  case_id: string | null;
}

const LOG_PAGE = 25;

export interface SenderRule {
  pattern: string;
  action: "allow" | "block";
  created_at: string;
}

const DOT: Record<CheckStatus, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
};

const worst = (checks: HealthCheck[]): CheckStatus =>
  checks.some((c) => c.status === "bad") ? "bad" : checks.some((c) => c.status === "warn") ? "warn" : "ok";

const nameOf = (p: { name: string | null; email: string }) => p.name || p.email;

// Settings only: is each mailbox's script running and who it tags. The
// mail itself stays in Gmail. Health details, sender rules and setup notes
// are one click away.
export default function EmailMonitorShell({
  health,
  senders,
  people,
  fires,
  days,
}: {
  health: RetiredMailHealth;
  senders: SenderRule[];
  people: Person[];
  fires: Fire[];
  days: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showHealth, setShowHealth] = useState(false);
  const [editing, setEditing] = useState<MailboxHealth | null>(null);
  const [panel, setPanel] = useState<"rules" | "how" | null>(null);
  const [shown, setShown] = useState(LOG_PAGE);

  const issues = health.checks.filter((c) => c.status !== "ok");
  const overall = worst(health.checks);

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setError(null);
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Request failed (${res.status})`);
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  const setRule = (pattern: string, action: "allow" | "block") =>
    call("/api/admin/retired-mail/senders", { method: "POST", body: JSON.stringify({ pattern, action }) });
  const removeRule = (pattern: string) =>
    call(`/api/admin/retired-mail/senders?pattern=${encodeURIComponent(pattern)}`, { method: "DELETE" });
  const setTags = (mailbox: string, profile_ids: string[]) =>
    call("/api/admin/retired-mail/tags", { method: "POST", body: JSON.stringify({ mailbox, profile_ids }) });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Email monitor</h1>
          <p className="text-sm text-muted-foreground">
            New mail to these inboxes is posted in #bot-notifications. To read the mail, open the inbox in Gmail.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHealth(!showHealth)}
          className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm hover:bg-muted/50"
        >
          <span className={cn("size-2 rounded-full", DOT[overall])} />
          {overall === "ok" ? "All systems OK" : `${issues.length} thing${issues.length === 1 ? "" : "s"} to check`}
          <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", showHealth && "rotate-180")} />
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Problems always show; the full list is one click away. */}
      {(showHealth || issues.length > 0) && (
        <Card className="gap-0 divide-y py-0">
          {(showHealth ? health.checks : issues).map((c) => (
            <div key={c.id} className="flex gap-3 px-4 py-2 text-sm">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[c.status])} />
              <div className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground"> · {c.detail}</span>
                {c.fix && c.status !== "ok" && <div className="mt-0.5 text-xs text-muted-foreground">→ {c.fix}</div>}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* One row per mailbox */}
      <Card className="gap-0 divide-y py-0">
        {health.mailboxes.map((b) => {
          const state = worst(health.checks.filter((c) => c.id.endsWith(`:${b.address}`)));
          return (
            <div key={b.address} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className={cn("size-2 shrink-0 rounded-full", DOT[state])} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{b.address}</div>
                <div className="text-xs text-muted-foreground">
                  {b.lastCheckAt ? `Checked ${fmtRelative(b.lastCheckAt, fmtWhen)}` : "Script not set up yet"}
                  {" · "}
                  {mailboxInfo(b.address)?.filtered ? "junk filtered out" : "every email alerts"}
                  {" · tags "}
                  <span className="text-foreground">{b.tagged.length ? b.tagged.map(nameOf).join(", ") : "nobody"}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(b)}>
                <Pencil className="size-3.5" /> Edit tags
              </Button>
            </div>
          );
        })}
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-medium">
          Alerts fired <span className="font-normal text-muted-foreground">· last {days} days · {fires.length}</span>
        </h2>
        <Card className="gap-0 divide-y py-0">
          {fires.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No alerts yet.</p>
          ) : (
            fires.slice(0, shown).map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                <span className={cn("size-2 shrink-0 rounded-full", f.slack_posted ? "bg-emerald-500" : "bg-red-500")} />
                <span className="w-36 shrink-0 text-muted-foreground">{fmtWhen(f.received_at)}</span>
                <span className="w-40 shrink-0 truncate">{shortMailbox(f.mailbox)}</span>
                <span className={cn("min-w-0 flex-1 truncate", !f.slack_posted && "text-destructive")}>
                  {f.slack_posted ? "Posted to Slack" : `Slack failed: ${f.slack_error ?? "unknown error"}`}
                </span>
                {f.case_id && (
                  <Link href={`/offboarding/${f.case_id}`} className="shrink-0 text-xs text-muted-foreground underline">
                    Case
                  </Link>
                )}
              </div>
            ))
          )}
          {fires.length > shown && (
            <button
              type="button"
              onClick={() => setShown(shown + LOG_PAGE)}
              className="w-full px-4 py-2 text-center text-sm text-muted-foreground hover:bg-muted/50"
            >
              Show more ({fires.length - shown} left)
            </button>
          )}
        </Card>
      </div>

      <div className="flex gap-4 text-sm">
        <button
          type="button"
          onClick={() => setPanel(panel === "rules" ? null : "rules")}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          Sender rules ({senders.length})
          <ChevronDown className={cn("size-3.5 transition-transform", panel === "rules" && "rotate-180")} />
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === "how" ? null : "how")}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          How this works
          <ChevronDown className={cn("size-3.5 transition-transform", panel === "how" && "rotate-180")} />
        </button>
      </div>

      {panel === "rules" && (
        <SenderRules senders={senders} pending={pending} setRule={setRule} removeRule={removeRule} />
      )}
      {panel === "how" && <HowItWorks />}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Who gets tagged for {shortMailbox(editing.address)}</DialogTitle>
              <DialogDescription>Changes save as you click and apply to the next email.</DialogDescription>
            </DialogHeader>
            <TagPicker
              key={editing.address}
              mailbox={editing}
              people={people}
              onChange={(ids) => setTags(editing.address, ids)}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function SenderRules({
  senders,
  pending,
  setRule,
  removeRule,
}: {
  senders: SenderRule[];
  pending: boolean;
  setRule: (pattern: string, action: "allow" | "block") => Promise<boolean>;
  removeRule: (pattern: string) => void;
}) {
  const [newRule, setNewRule] = useState("");
  const add = (action: "allow" | "block") => setRule(newRule.trim(), action).then((ok) => ok && setNewRule(""));
  return (
    <Card className="gap-3 px-4 py-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Override the retiredemployees@ junk filter for an address or a whole @domain. Applies to new mail.
      </p>
      {senders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {senders.map((r) => (
            <span
              key={r.pattern}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
                r.action === "allow" ? "border-emerald-500/50 bg-emerald-500/10" : "border-muted-foreground/30 bg-muted",
              )}
            >
              {r.action === "allow" ? <Bell className="size-3" /> : <VolumeX className="size-3" />}
              {r.pattern}
              <button
                type="button"
                aria-label={`Remove ${r.pattern}`}
                disabled={pending}
                onClick={() => removeRule(r.pattern)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          value={newRule}
          onChange={(e) => setNewRule(e.target.value)}
          placeholder="name@company.com or @company.com"
          className="h-8 w-72"
        />
        <Button size="sm" variant="outline" disabled={pending || !newRule.trim()} onClick={() => add("allow")}>
          <Bell className="size-3.5" /> Always alert
        </Button>
        <Button size="sm" variant="outline" disabled={pending || !newRule.trim()} onClick={() => add("block")}>
          <VolumeX className="size-3.5" /> Mute
        </Button>
      </div>
    </Card>
  );
}

function HowItWorks() {
  return (
    <Card className="px-4 py-3 text-sm">
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <b>Apps Script</b>: the same script (<code>docs/email-monitor-apps-script.js</code>) runs on each
          mailbox&apos;s own account at script.google.com. It checks for new mail every minute and checks in every 5;
          if it goes quiet, this page turns red.
        </li>
        <li>
          <b>retiredemployees@</b>: Google Workspace routes mail for deleted addresses here. Mail from BBD staff, mass
          BCC blasts, Gmail&apos;s Promotions/Social tabs, newsletters and no-reply senders is filtered out (labelled
          Launcher/Junk in Gmail); anything that looks like a person writing alerts. Sender rules always win.
        </li>
        <li>
          <b>orders@</b>: every email alerts, no filter.
        </li>
        <li>
          <b>Slack</b>: bbd-bot posts in #bot-notifications and tags the people picked for that mailbox.
        </li>
        <li>
          <b>Watchdog</b>: every morning the launcher checks the health and tags the admins in Slack if something&apos;s
          broken; Mondays it posts a weekly summary.
        </li>
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Vercel env vars: RETIRED_MAIL_SECRET (same as the script&apos;s LAUNCHER_SECRET), SLACK_BOT_TOKEN. Optional AI
        review: RETIRED_MAIL_AI=on + GEMINI_API_KEY.
      </p>
    </Card>
  );
}

// Picked people as chips, everyone else in a searchable checkbox list.
// Saves on every click.
function TagPicker({
  mailbox,
  people,
  onChange,
}: {
  mailbox: MailboxHealth;
  people: Person[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  // Local copy so quick clicks build on each other instead of on the last
  // server refresh.
  const [ids, setIds] = useState(mailbox.tagIds);
  const picked = new Set(ids);
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? people.filter((p) => [p.name, p.email, p.office].some((v) => v?.toLowerCase().includes(needle)))
    : people;
  const toggle = (id: string) => {
    const next = picked.has(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setIds(next);
    onChange(next);
  };
  const chosen = people.filter((p) => picked.has(p.id));

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {chosen.length === 0 && <span className="text-muted-foreground">Nobody yet. Alerts post without tags.</span>}
        {chosen.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-0.5 text-xs">
            {nameOf(p)}
            <button
              type="button"
              aria-label={`Stop tagging ${nameOf(p)}`}
              onClick={() => toggle(p.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="h-8 pl-7" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {matches.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Nobody matches.</p>
        ) : (
          matches.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/50">
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span className="truncate">{nameOf(p)}</span>
              {p.office && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.office}</span>}
            </label>
          ))
        )}
      </div>
    </div>
  );
}
