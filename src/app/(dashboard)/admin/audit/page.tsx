import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { startOfDayInZone, DEFAULT_ZONE } from "@/lib/timesheets/tz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

interface AuditRow {
  id: number;
  at: string;
  app: string;
  table_name: string;
  action: "insert" | "update" | "delete";
  row_id: string | null;
  row_label: string | null;
  source: "user" | "system" | "database";
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  as_user_id: string | null;
  as_user_email: string | null;
  changes: Record<string, { from?: unknown; to?: unknown }>;
}

interface Facets {
  apps: string[];
  tables: string[];
  actors: { id: string; name: string | null; email: string | null }[];
}

type Search = Record<string, string | undefined>;

const PREFIXES = /^(launcher_|pm_|mfr_hub_|handbook_|helpdesk_|rep_|psb_|qsb_|asce_|mbox_|mq_)/;
/** "pm_tasks" → "tasks", "launcher_role_app_access" → "role app access". */
const tableLabel = (t: string) => t.replace(PREFIXES, "").replace(/_/g, " ");

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: DEFAULT_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v === "" ? '""' : v;
  return JSON.stringify(v);
}

const ACTION_STYLE: Record<AuditRow["action"], string> = {
  insert: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  update: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  delete: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};
const ACTION_LABEL = { insert: "Created", update: "Changed", delete: "Deleted" } as const;

// Every edit made in any BBD app on the shared database: who, what, when.
// Rows come from the audit_capture triggers (migration 060).
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await auth();
  if (!isAdmin(session?.user?.permRole)) redirect("/dashboard");

  const sp = await searchParams;
  const supabase = createAdminClient();

  let query = supabase
    .from("audit_log")
    .select("*")
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (sp.app) query = query.eq("app", sp.app);
  if (sp.table) query = query.eq("table_name", sp.table);
  if (sp.row) query = query.eq("row_id", sp.row);
  if (sp.action) query = query.eq("action", sp.action);
  if (sp.source) query = query.eq("source", sp.source);
  if (sp.who) query = query.or(`actor_id.eq.${sp.who},as_user_id.eq.${sp.who}`);
  if (sp.from) query = query.gte("at", startOfDayInZone(new Date(`${sp.from}T12:00:00Z`)).toISOString());
  if (sp.to) {
    const next = new Date(`${sp.to}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    query = query.lt("at", startOfDayInZone(next).toISOString());
  }
  if (sp.q) {
    const q = sp.q.replace(/[%,()*]/g, " ").trim();
    if (q) query = query.or(`row_label.ilike.*${q}*,row_id.eq.${q},actor_email.ilike.*${q}*`);
  }
  if (sp.before && /^\d+$/.test(sp.before)) query = query.lt("id", Number(sp.before));

  const [{ data, error }, { data: facetData }] = await Promise.all([
    query,
    supabase.rpc("audit_log_facets"),
  ]);
  const missing = error?.code === "42P01" || error?.message?.includes("audit_log");
  const rows = ((data ?? []) as AuditRow[]).slice(0, PAGE_SIZE);
  const hasMore = (data?.length ?? 0) > PAGE_SIZE;
  const facets = (facetData ?? { apps: [], tables: [], actors: [] }) as Facets;

  // Current names for the people in this page (stored names are a fallback).
  const ids = [...new Set(rows.flatMap((r) => [r.actor_id, r.as_user_id]).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of people ?? []) names.set(p.id as string, (p.full_name as string) || (p.email as string));
  }

  const link = (patch: Search) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, before: undefined, ...patch })) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/admin/audit?${s}` : "/admin/audit";
  };
  const filtered = ["app", "table", "row", "action", "source", "who", "from", "to", "q"].some((k) => sp[k]);
  const selectCls = "h-9 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every change made in any BBD app: who made it, what changed (old → new) and exactly when. Times are Eastern.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <select name="app" defaultValue={sp.app ?? ""} className={selectCls} aria-label="App">
          <option value="">All apps</option>
          {facets.apps.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select name="who" defaultValue={sp.who ?? ""} className={selectCls} aria-label="Person">
          <option value="">Everyone</option>
          {facets.actors.map((a) => <option key={a.id} value={a.id}>{names.get(a.id) ?? a.name ?? a.email ?? a.id}</option>)}
        </select>
        <select name="table" defaultValue={sp.table ?? ""} className={selectCls} aria-label="Record type">
          <option value="">All record types</option>
          {facets.tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select name="action" defaultValue={sp.action ?? ""} className={selectCls} aria-label="Change">
          <option value="">Any change</option>
          <option value="insert">Created</option>
          <option value="update">Changed</option>
          <option value="delete">Deleted</option>
        </select>
        <select name="source" defaultValue={sp.source ?? ""} className={selectCls} aria-label="Made by">
          <option value="">People + system</option>
          <option value="user">People only</option>
          <option value="system">System (sync, cron)</option>
          <option value="database">Database (SQL)</option>
        </select>
        <label className="text-xs text-muted-foreground">From<Input type="date" name="from" defaultValue={sp.from} className="w-36" /></label>
        <label className="text-xs text-muted-foreground">To<Input type="date" name="to" defaultValue={sp.to} className="w-36" /></label>
        <Input name="q" defaultValue={sp.q} placeholder="Search record or email" className="w-52" />
        {sp.row ? <input type="hidden" name="row" value={sp.row} /> : null}
        <Button type="submit">Filter</Button>
        {filtered ? <Button variant="ghost" asChild><Link href="/admin/audit">Clear</Link></Button> : null}
      </form>

      {sp.row ? (
        <p className="text-sm">
          History of one record <code className="text-xs">{sp.table} · {sp.row}</code> ·{" "}
          <Link className="underline" href={link({ row: undefined })}>show all records</Link>
        </p>
      ) : null}

      {missing ? (
        <p className="rounded-md border p-4 text-sm">
          The audit log isn&apos;t set up yet: run <code>supabase/migrations/060_audit_log.sql</code> in the Supabase SQL Editor.
        </p>
      ) : error ? (
        <p className="rounded-md border border-destructive p-4 text-sm">{error.message}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No changes match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">App</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 font-medium">Changes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fields = Object.entries(r.changes ?? {});
                const who =
                  r.source === "user"
                    ? (r.actor_id && names.get(r.actor_id)) || r.actor_name || r.actor_email || "Unknown person"
                    : r.source === "system" ? "System" : "Database";
                const asWho = r.as_user_id ? (names.get(r.as_user_id) ?? r.as_user_email ?? r.as_user_id) : null;
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{timeFmt.format(new Date(r.at))}</td>
                    <td className="px-3 py-2">
                      {r.source === "user" && r.actor_id ? (
                        <Link className="font-medium hover:underline" href={link({ who: r.actor_id })}>{who}</Link>
                      ) : (
                        <span className="text-muted-foreground" title={r.source === "system" ? "A sync, scheduled job or webhook, not a person" : "Run directly on the database (SQL Editor or migration)"}>{who}</span>
                      )}
                      {asWho ? <div className="text-xs text-muted-foreground">viewing as {asWho}</div> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link className="hover:underline" href={link({ app: r.app })}>{r.app}</Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={`mr-1.5 border-0 ${ACTION_STYLE[r.action]}`}>{ACTION_LABEL[r.action]}</Badge>
                      <span className="text-muted-foreground">{tableLabel(r.table_name)}</span>{" "}
                      {r.row_id ? (
                        <Link className="font-medium hover:underline" href={link({ table: r.table_name, row: r.row_id })} title="History of this record">
                          {r.row_label ?? r.row_id}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.row_label}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {fields.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer select-none text-muted-foreground">
                            {r.action === "update"
                              ? fields.map(([k]) => k.replace(/_/g, " ")).slice(0, 4).join(", ") + (fields.length > 4 ? ` +${fields.length - 4}` : "")
                              : `${fields.length} field${fields.length === 1 ? "" : "s"}`}
                          </summary>
                          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                            {fields.map(([k, c]) => (
                              <div key={k} className="contents">
                                <dt className="font-medium text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                                <dd className="break-words">
                                  {r.action === "update" ? (
                                    <>
                                      <span className="text-red-700 line-through decoration-red-300 dark:text-red-400">{show(c.from)}</span>
                                      <span className="mx-1 text-muted-foreground">→</span>
                                      <span className="text-emerald-700 dark:text-emerald-400">{show(c.to)}</span>
                                    </>
                                  ) : (
                                    show(r.action === "insert" ? c.to : c.from)
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasMore ? (
        <div className="flex justify-end">
          <Button variant="outline" asChild>
            <Link href={`${link({})}${link({}).includes("?") ? "&" : "?"}before=${rows[rows.length - 1].id}`}>Older changes →</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
