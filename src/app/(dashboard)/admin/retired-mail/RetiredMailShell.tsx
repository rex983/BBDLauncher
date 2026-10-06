"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtRelative, fmtWhen } from "@/components/shared/format";
import type { CheckStatus, RetiredMailHealth } from "@/lib/offboarding/retired-mail-health";
import { ChevronDown, Mail, Search, Send, ShieldCheck, VolumeX, Bell, X } from "lucide-react";

export interface MailRow {
  id: string;
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

export interface SenderRule {
  pattern: string;
  action: "allow" | "block";
  created_at: string;
}

type Filter = "all" | "alerted" | "filtered" | "failed";

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

function status(m: MailRow): Exclude<Filter, "all"> {
  if (m.junk) return "filtered";
  return m.slack_posted ? "alerted" : "failed";
}

export default function RetiredMailShell({
  health,
  mail,
  senders,
  days,
}: {
  health: RetiredMailHealth;
  mail: MailRow[];
  senders: SenderRule[];
  days: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState("");
  const [showHow, setShowHow] = useState(false);

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
          [m.from_text, m.subject, m.sent_to, m.employee_name, m.reason]
            .some((v) => v?.toLowerCase().includes(needle))),
    );
  }, [mail, filter, q]);

  const rules = useMemo(() => new Map(senders.map((s) => [s.pattern, s.action])), [senders]);

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

  const problems = health.checks.filter((c) => c.status === "bad");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Retired employee mail</h1>
          <p className="text-muted-foreground text-sm">
            Mail to deleted @bigbuildingsdirect.com addresses lands in retiredemployees@. Real mail pings the Sales
            managers in Slack; junk stays in the archive. This page is where it&apos;s all managed.
          </p>
        </div>
        <Badge variant={problems.length ? "destructive" : "secondary"} className="text-sm">
          {problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "All systems OK"}
        </Badge>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Health</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {health.checks.map((c) => (
            <div key={c.id} className="flex gap-3 py-2 text-sm">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[c.status])} />
              <div className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground"> · {c.detail}</span>
                {c.fix && c.status !== "ok" && <div className="text-xs text-muted-foreground mt-0.5">→ {c.fix}</div>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={`Received · ${days}d`} value={String(counts.all)} />
        <StatCard label="Alerted" value={String(counts.alerted)} sub="Sent to Slack" />
        <StatCard label="Filtered" value={String(counts.filtered)} sub="Junk, archive only" />
        <StatCard label="Failed" value={String(counts.failed)} sub="Slack post failed" highlight={counts.failed > 0} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Mail</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {(["all", "alerted", "filtered", "failed"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  onClick={() => setFilter(f)}
                  className="h-7 capitalize"
                >
                  {f} {counts[f]}
                </Button>
              ))}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-7 w-44 pl-7" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              {mail.length ? "Nothing matches." : `No mail in the last ${days} days.`}
            </p>
          ) : (
            <div className="divide-y">
              {rows.map((m) => {
                const s = status(m);
                const sender = senderOf(m.from_text);
                const domain = sender.includes("@") ? sender.slice(sender.indexOf("@")) : null;
                const showDomain = domain && !PUBLIC_DOMAINS.has(domain.slice(1));
                const isOpen = open === m.id;
                return (
                  <Fragment key={m.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : m.id)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/50"
                    >
                      <Badge
                        variant={s === "alerted" ? "default" : s === "failed" ? "destructive" : "outline"}
                        className="w-16 justify-center"
                      >
                        {s === "alerted" ? "Alerted" : s === "failed" ? "Failed" : "Junk"}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          <span className={cn("font-medium", m.junk && "text-muted-foreground")}>{senderName(m.from_text)}</span>
                          <span className="text-muted-foreground"> · {m.subject || "(no subject)"}</span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          for {m.employee_name ?? m.sent_to ?? "unknown"} · {m.reason} ({DECIDED[m.decided_by]})
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground" title={fmtWhen(m.received_at)}>
                        {fmtRelative(m.received_at, fmtWhen)}
                      </span>
                      <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="space-y-3 bg-muted/30 px-4 py-3 text-sm">
                        <div className="text-xs text-muted-foreground">
                          From {m.from_text} · to {m.sent_to ?? "unknown"} · {fmtWhen(m.received_at)}
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
                          {m.junk ? (
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
                          )}
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sender rules</CardTitle>
          <p className="text-xs text-muted-foreground">
            Override the spam filter for an address or a whole @domain. Applies to new mail.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
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
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !newRule.trim()}
              onClick={() => setRule(newRule.trim(), "allow").then((ok) => ok && setNewRule(""))}
            >
              <Bell className="size-3.5" /> Always alert
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !newRule.trim()}
              onClick={() => setRule(newRule.trim(), "block").then((ok) => ok && setNewRule(""))}
            >
              <VolumeX className="size-3.5" /> Mute
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <button
          type="button"
          onClick={() => setShowHow(!showHow)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <span className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4" /> How this works
          </span>
          <ChevronDown className={cn("size-4 transition-transform", showHow && "rotate-180")} />
        </button>
        {showHow && (
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <b>Google Workspace routing</b> (Admin console → Gmail → Default routing): mail to any address that no
                longer exists is redirected to <code>retiredemployees@</code>. Deleting a user is all it takes.
                Don&apos;t add per-person forwarding there; it stops mail reaching the archive.
              </li>
              <li>
                <b>Apps Script</b> on the retiredemployees@ account (script.google.com) checks every minute and sends
                each new email here. It checks in every 5 minutes; if it goes quiet, the Health card above turns red.
                Script source: <code>docs/retired-mail-apps-script.js</code> in the launcher repo.
              </li>
              <li>
                <b>Spam filter</b>: Gmail&apos;s Promotions/Social tabs, unsubscribe/mailing-list headers and
                no-reply senders are junk. Your sender rules above always win. Anything that looks like a person
                writing alerts, so a customer is never missed; mute cold pitches as they show up.
              </li>
              <li>
                <b>Slack</b>: bbd-bot posts real mail in #bot-notifications and tags the active Sales managers
                {health.managers.length ? ` (${health.managers.map((m) => m.name || m.email).join(", ")})` : ""}.
              </li>
              <li>
                <b>Watchdog</b>: every morning the launcher checks this page&apos;s health and tags the admins in Slack
                if anything&apos;s broken. Mondays it posts a weekly summary with a link back here.
              </li>
            </ol>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="size-3.5" /> Vercel env vars: RETIRED_MAIL_SECRET, SLACK_BOT_TOKEN. Optional AI review:
              RETIRED_MAIL_AI=on + GEMINI_API_KEY. Changes need a redeploy.
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
