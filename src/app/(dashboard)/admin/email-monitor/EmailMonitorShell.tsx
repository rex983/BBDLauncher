"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtRelative, fmtWhen } from "@/components/shared/format";
import type { CheckStatus, HealthCheck, MailboxHealth, RetiredMailHealth } from "@/lib/offboarding/retired-mail-health";
import { INTERNAL_REASON } from "@/lib/offboarding/mail-filter";
import { MAILBOXES, mailboxInfo, shortMailbox } from "@/lib/offboarding/mailboxes";
import { Bell, ChevronDown, Pencil, Search, Send, VolumeX, X } from "lucide-react";

export interface MailRow {
  id: string;
  mailbox: string;
  received_at: string;
  from_text: string;
  subject: string;
  preview: string;
  sent_to: string | null;
  employee_name: string | null;
  case_id: string | null;
  junk: boolean;
  reason: string | null;
  decided_by: "rules" | "ai" | "sender" | "admin";
  slack_posted: boolean;
  slack_error: string | null;
}

export interface Person {
  id: string;
  name: string | null;
  email: string;
  office: string | null;
}

export interface SenderRule {
  pattern: string;
  action: "allow" | "block";
  created_at: string;
}

type Status = "alerted" | "filtered" | "failed";
type Filter = "all" | Status;

const PAGE = 50;

const DOT: Record<CheckStatus, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
};

const DECIDED: Record<MailRow["decided_by"], string> = {
  rules: "rule",
  ai: "AI",
  sender: "sender rule",
  admin: "admin",
};

// Webmail domains are shared by customers, so never offer to mute them whole.
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "verizon.net",
  "proton.me", "protonmail.com", "gmx.com",
]);

function senderOf(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

function senderName(from: string): string {
  const name = from.replace(/<[^>]+>/, "").replace(/"/g, "").trim();
  return name || senderOf(from);
}

function status(m: MailRow): Status {
  if (m.junk) return "filtered";
  return m.slack_posted ? "alerted" : "failed";
}

const worst = (checks: HealthCheck[]): CheckStatus =>
  checks.some((c) => c.status === "bad") ? "bad" : checks.some((c) => c.status === "warn") ? "warn" : "ok";

const nameOf = (p: { name: string | null; email: string }) => p.name || p.email;

// One mailbox at a time: its status and tags on one line, then its mail.
// Health details, sender rules and setup notes stay one click away.
export default function EmailMonitorShell({
  health,
  mail: allMail,
  senders,
  people,
  days,
}: {
  health: RetiredMailHealth;
  mail: MailRow[];
  senders: SenderRule[];
  people: Person[];
  days: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [box, setBox] = useState<string>(MAILBOXES[0].address);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHealth, setShowHealth] = useState(false);
  const [editTags, setEditTags] = useState(false);
  const [panel, setPanel] = useState<"rules" | "how" | null>(null);

  const info = mailboxInfo(box) ?? MAILBOXES[0];
  const boxHealth = health.mailboxes.find((b) => b.address === box);
  const boxChecks = health.checks.filter((c) => c.id.endsWith(`:${box}`));
  const issues = health.checks.filter((c) => c.status !== "ok");

  const mail = useMemo(() => allMail.filter((m) => m.mailbox === box), [allMail, box]);
  const counts = useMemo(() => {
    const c = { all: mail.length, alerted: 0, filtered: 0, failed: 0 };
    for (const m of mail) c[status(m)]++;
    return c;
  }, [mail]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return mail.filter(
      (m) =>
        (filter === "all" || status(m) === filter) &&
        (!needle ||
          [m.from_text, m.subject, m.sent_to, m.employee_name, m.reason].some((v) => v?.toLowerCase().includes(needle))),
    );
  }, [mail, filter, q]);
  const rules = useMemo(() => new Map(senders.map((s) => [s.pattern, s.action])), [senders]);

  // Filters that mean something here: no "Filtered" on a mailbox that
  // alerts on everything, no "Failed" when nothing failed.
  const filters = (["all", "alerted", "filtered", "failed"] as const).filter(
    (f) => f === "all" || f === filter || counts[f] > 0 || (f === "filtered" && info.filtered),
  );

  function pickBox(address: string) {
    setBox(address);
    setFilter("all");
    setShown(PAGE);
    setOpen(null);
    if (!mailboxInfo(address)?.filtered && panel === "rules") setPanel(null);
  }

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

  const resend = (id: string) => call("/api/admin/retired-mail/resend", { method: "POST", body: JSON.stringify({ id }) });
  const setRule = (pattern: string, action: "allow" | "block") =>
    call("/api/admin/retired-mail/senders", { method: "POST", body: JSON.stringify({ pattern, action }) });
  const removeRule = (pattern: string) =>
    call(`/api/admin/retired-mail/senders?pattern=${encodeURIComponent(pattern)}`, { method: "DELETE" });
  const setTags = (mailbox: string, profile_ids: string[]) =>
    call("/api/admin/retired-mail/tags", { method: "POST", body: JSON.stringify({ mailbox, profile_ids }) });

  const overall = worst(health.checks);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Email monitor</h1>
          <p className="text-sm text-muted-foreground">New mail to these inboxes is posted in #bot-notifications.</p>
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

      {/* Mailbox tabs */}
      <div className="flex gap-1 border-b">
        {MAILBOXES.map((m) => {
          const count = allMail.filter((r) => r.mailbox === m.address).length;
          const state = worst(health.checks.filter((c) => c.id.endsWith(`:${m.address}`)));
          return (
            <button
              key={m.address}
              type="button"
              onClick={() => pickBox(m.address)}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm",
                box === m.address
                  ? "border-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {state !== "ok" && <span className={cn("size-2 rounded-full", DOT[state])} />}
              {shortMailbox(m.address)}
              <span className="text-xs text-muted-foreground">{count}</span>
            </button>
          );
        })}
      </div>

      {/* This mailbox in one line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span className={cn("size-2 rounded-full", DOT[worst(boxChecks)])} />
        <span>
          {boxHealth?.lastCheckAt ? `Checked ${fmtRelative(boxHealth.lastCheckAt, fmtWhen)}` : "Script not set up yet"}
        </span>
        <span>·</span>
        <span>{info.filtered ? "Junk filtered out" : "Every email alerts"}</span>
        <span>·</span>
        <span className="min-w-0">
          Tags{" "}
          <span className="text-foreground">
            {boxHealth?.tagged.length ? boxHealth.tagged.map(nameOf).join(", ") : "nobody"}
          </span>
        </span>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditTags(true)}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      </div>

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          {filters.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "secondary" : "ghost"}
              onClick={() => {
                setFilter(f);
                setShown(PAGE);
              }}
              className="h-7 capitalize"
            >
              {f} <span className="text-muted-foreground">{counts[f]}</span>
            </Button>
          ))}
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
              placeholder="Search"
              className="h-7 w-44 pl-7"
            />
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {mail.length ? "Nothing matches." : `No mail in the last ${days} days.`}
          </p>
        ) : (
          <div className="divide-y">
            {rows.slice(0, shown).map((m) => (
              <MailItem
                key={m.id}
                m={m}
                isOpen={open === m.id}
                onToggle={() => setOpen(open === m.id ? null : m.id)}
                filtered={info.filtered}
                rules={rules}
                pending={pending}
                resend={resend}
                setRule={setRule}
              />
            ))}
            {rows.length > shown && (
              <button
                type="button"
                onClick={() => setShown(shown + PAGE)}
                className="w-full px-4 py-2 text-center text-sm text-muted-foreground hover:bg-muted/50"
              >
                Show more ({rows.length - shown} left)
              </button>
            )}
          </div>
        )}
      </Card>

      <div className="flex gap-4 text-sm">
        {info.filtered && (
          <button
            type="button"
            onClick={() => setPanel(panel === "rules" ? null : "rules")}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            Sender rules ({senders.length})
            <ChevronDown className={cn("size-3.5 transition-transform", panel === "rules" && "rotate-180")} />
          </button>
        )}
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

      {boxHealth && (
        <Dialog open={editTags} onOpenChange={setEditTags}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Who gets tagged for {shortMailbox(box)}</DialogTitle>
              <DialogDescription>Changes save as you click and apply to the next email.</DialogDescription>
            </DialogHeader>
            <TagPicker
              key={box}
              mailbox={boxHealth}
              people={people}
              onChange={(ids) => setTags(box, ids)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function MailItem({
  m,
  isOpen,
  onToggle,
  filtered,
  rules,
  pending,
  resend,
  setRule,
}: {
  m: MailRow;
  isOpen: boolean;
  onToggle: () => void;
  filtered: boolean;
  rules: Map<string, "allow" | "block">;
  pending: boolean;
  resend: (id: string) => void;
  setRule: (pattern: string, action: "allow" | "block") => void;
}) {
  const s = status(m);
  const sender = senderOf(m.from_text);
  const domain = sender.includes("@") ? sender.slice(sender.indexOf("@")) : null;
  const showDomain = domain && !PUBLIC_DOMAINS.has(domain.slice(1));
  const label = s === "alerted" ? "Alerted" : s === "failed" ? "Failed" : m.reason === INTERNAL_REASON ? "Staff" : "Junk";

  return (
    <Fragment>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/50"
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            s === "alerted" ? "bg-emerald-500" : s === "failed" ? "bg-red-500" : "bg-muted-foreground/30",
          )}
          title={label}
        />
        <div className="min-w-0 flex-1 truncate">
          <span className={cn("font-medium", m.junk && "text-muted-foreground")}>{senderName(m.from_text)}</span>
          <span className="text-muted-foreground"> · {m.subject || "(no subject)"}</span>
        </div>
        {filtered && m.employee_name && (
          <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">for {m.employee_name}</span>
        )}
        {s !== "alerted" && (
          <Badge variant={s === "failed" ? "destructive" : "outline"} className="shrink-0">
            {label}
          </Badge>
        )}
        <span className="w-20 shrink-0 text-right text-xs text-muted-foreground" title={fmtWhen(m.received_at)}>
          {fmtRelative(m.received_at, fmtWhen)}
        </span>
      </button>
      {isOpen && (
        <div className="space-y-3 bg-muted/30 px-4 py-3 text-sm">
          <div className="text-xs text-muted-foreground">
            From {m.from_text} · to {m.sent_to ?? "unknown"} · {fmtWhen(m.received_at)}
            {filtered && (
              <>
                <br />
                {label}: {m.reason} ({DECIDED[m.decided_by]})
              </>
            )}
            {m.case_id && (
              <>
                {" · "}
                <Link href={`/offboarding/${m.case_id}`} className="underline">
                  Offboarding case
                </Link>
              </>
            )}
            {m.slack_error && <span className="text-destructive"> · Slack: {m.slack_error}</span>}
          </div>
          {m.preview && (
            <p className="max-h-40 overflow-y-auto whitespace-pre-line rounded border bg-background p-2 text-xs">
              {m.preview.trim()}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {s !== "alerted" && (
              <Button size="sm" disabled={pending} onClick={() => resend(m.id)}>
                <Send className="size-3.5" /> {s === "failed" ? "Retry Slack alert" : "Not junk, send to Slack"}
              </Button>
            )}
            {filtered &&
              (m.junk ? (
                <>
                  {rules.get(sender) !== "allow" && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setRule(sender, "allow")}>
                      <Bell className="size-3.5" /> Always alert for {sender}
                    </Button>
                  )}
                  {showDomain && rules.get(domain) !== "allow" && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setRule(domain, "allow")}>
                      <Bell className="size-3.5" /> Always alert for {domain}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {rules.get(sender) !== "block" && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setRule(sender, "block")}>
                      <VolumeX className="size-3.5" /> Mute {sender}
                    </Button>
                  )}
                  {showDomain && rules.get(domain) !== "block" && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setRule(domain, "block")}>
                      <VolumeX className="size-3.5" /> Mute all of {domain}
                    </Button>
                  )}
                </>
              ))}
          </div>
        </div>
      )}
    </Fragment>
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
          BCC blasts, Gmail&apos;s Promotions/Social tabs, newsletters and no-reply senders is filtered out; anything
          that looks like a person writing alerts. Sender rules always win.
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
