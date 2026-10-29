import Link from "next/link";
import { adminClient, APP_NAME } from "./config";

// This app's edit history, from the shared audit_log (launcher migration 060).
// Each app's /audit page renders it after its own access check:
//
//   import { AuditLogView, canSeeAuditLog, type AuditSearchParams } from "@/lib/launcher-kit/audit-log";
//   export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditSearchParams> }) {
//     const session = await auth();
//     if (!canSeeAuditLog(session?.user?.permRole, isEditor)) redirect("/");
//     return <AuditLogView searchParams={await searchParams} />;
//   }
//
// Server component, plain elements + shadcn colour tokens so it fits any app.

export type AuditSearchParams = Record<string, string | string[] | undefined>;

/** Admins, senior/junior managers, and anyone the app counts as an editor. */
export function canSeeAuditLog(permRole: string | null | undefined, isEditor = false): boolean {
  return permRole === "admin" || permRole === "senior_manager" || permRole === "junior_manager" || isEditor;
}

const PAGE_SIZE = 100;
const ZONE = "America/New_York";

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

const PREFIXES = /^(launcher_|pm_|mfr_hub_|handbook_|helpdesk_|rep_|psb_|qsb_|asce_|mbox_|mq_)/;
const tableLabel = (t: string) => t.replace(PREFIXES, "").replace(/_/g, " ");
const fieldLabel = (k: string) => k.replace(/_/g, " ");

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

/** UTC instant of 00:00 Eastern on a yyyy-mm-dd day. */
function startOfEasternDay(day: string): Date {
  const noonUtc = new Date(`${day}T12:00:00Z`);
  const offsetMin = (() => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, timeZoneName: "longOffset" })
      .formatToParts(noonUtc)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
    const m = parts.match(/GMT([+-])(\d{2}):(\d{2})/);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : -300;
  })();
  return new Date(Date.parse(`${day}T00:00:00Z`) - offsetMin * 60_000);
}

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
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export async function AuditLogView({
  searchParams,
  basePath = "/audit",
  title = "Edit history",
}: {
  searchParams: AuditSearchParams;
  basePath?: string;
  title?: string;
}) {
  const sp = {
    who: one(searchParams.who),
    table: one(searchParams.table),
    row: one(searchParams.row),
    action: one(searchParams.action),
    from: one(searchParams.from),
    to: one(searchParams.to),
    q: one(searchParams.q),
    before: one(searchParams.before),
  };
  const supabase = adminClient();

  let query = supabase.from("audit_log").select("*").eq("app", APP_NAME).order("id", { ascending: false }).limit(PAGE_SIZE + 1);
  if (sp.table) query = query.eq("table_name", sp.table);
  if (sp.row) query = query.eq("row_id", sp.row);
  if (sp.action === "insert" || sp.action === "update" || sp.action === "delete") query = query.eq("action", sp.action);
  if (sp.who === "system") query = query.neq("source", "user");
  else if (sp.who && /^[\w-]+$/.test(sp.who)) query = query.eq("actor_id", sp.who);
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) query = query.gte("at", startOfEasternDay(sp.from).toISOString());
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) {
    const next = new Date(`${sp.to}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    query = query.lt("at", startOfEasternDay(next.toISOString().slice(0, 10)).toISOString());
  }
  if (sp.q) {
    const q = sp.q.replace(/[%,()*]/g, " ").trim();
    if (q) query = query.or(`row_label.ilike.*${q}*,actor_name.ilike.*${q}*,actor_email.ilike.*${q}*`);
  }
  if (sp.before && /^\d+$/.test(sp.before)) query = query.lt("id", Number(sp.before));

  const [{ data, error }, { data: recent }] = await Promise.all([
    query,
    // Filter lists: people and record types seen recently in this app.
    supabase.from("audit_log").select("table_name, actor_id, actor_name, actor_email").eq("app", APP_NAME).order("id", { ascending: false }).limit(3000),
  ]);
  const rows = ((data ?? []) as AuditRow[]).slice(0, PAGE_SIZE);
  const hasMore = (data?.length ?? 0) > PAGE_SIZE;
  const tables = [...new Set((recent ?? []).map((r) => r.table_name as string))].sort();
  const actorMap = new Map<string, string>();
  for (const r of recent ?? []) {
    if (r.actor_id && !actorMap.has(r.actor_id as string)) actorMap.set(r.actor_id as string, (r.actor_name as string) || (r.actor_email as string) || "Unknown");
  }
  const actors = [...actorMap].sort((a, b) => a[1].localeCompare(b[1]));

  const link = (patch: Partial<typeof sp>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, before: undefined, ...patch })) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const filtered = Object.entries(sp).some(([k, v]) => k !== "before" && v);
  const control = "h-9 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">
          Every change made in {APP_NAME}: who made it, what changed (old → new) and exactly when. Times are Eastern.
        </p>
      </div>

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        <select name="who" defaultValue={sp.who ?? ""} className={control} aria-label="Person">
          <option value="">Everyone</option>
          {actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          <option value="system">System (syncs, scheduled jobs)</option>
        </select>
        <select name="table" defaultValue={sp.table ?? ""} className={control} aria-label="Record type">
          <option value="">All record types</option>
          {tables.map((t) => <option key={t} value={t}>{tableLabel(t)}</option>)}
        </select>
        <select name="action" defaultValue={sp.action ?? ""} className={control} aria-label="Change">
          <option value="">Any change</option>
          <option value="insert">Created</option>
          <option value="update">Changed</option>
          <option value="delete">Deleted</option>
        </select>
        <label className="flex flex-col text-xs text-muted-foreground">From<input type="date" name="from" defaultValue={sp.from} className={control} /></label>
        <label className="flex flex-col text-xs text-muted-foreground">To<input type="date" name="to" defaultValue={sp.to} className={control} /></label>
        <input name="q" defaultValue={sp.q} placeholder="Search record or person" className={`${control} w-52 px-3`} />
        {sp.row ? <input type="hidden" name="row" value={sp.row} /> : null}
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Filter</button>
        {filtered ? <Link href={basePath} className="h-9 rounded-md px-3 text-sm leading-9 hover:bg-muted">Clear</Link> : null}
      </form>

      {sp.row ? (
        <p className="text-sm">
          History of one {sp.table ? tableLabel(sp.table) : "record"} ·{" "}
          <Link className="underline" href={link({ row: undefined })}>show everything</Link>
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border p-4 text-sm">The edit history couldn&apos;t load: {error.message}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {filtered ? "No changes match." : "No changes recorded yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 font-medium">Changes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fields = Object.entries(r.changes ?? {});
                const who = r.source === "user" ? r.actor_name || r.actor_email || "Unknown person" : r.source === "system" ? "System" : "Database";
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{timeFmt.format(new Date(r.at))}</td>
                    <td className="px-3 py-2">
                      {r.source === "user" && r.actor_id ? (
                        <Link className="font-medium hover:underline" href={link({ who: r.actor_id })}>{who}</Link>
                      ) : (
                        <span className="text-muted-foreground" title={r.source === "system" ? "A sync, scheduled job or webhook, not a person" : "Run directly on the database"}>{who}</span>
                      )}
                      {r.as_user_id ? <div className="text-xs text-muted-foreground">viewing as {r.as_user_email ?? r.as_user_id}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${ACTION_STYLE[r.action]}`}>{ACTION_LABEL[r.action]}</span>
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
                              ? fields.map(([k]) => fieldLabel(k)).slice(0, 4).join(", ") + (fields.length > 4 ? ` +${fields.length - 4}` : "")
                              : `${fields.length} field${fields.length === 1 ? "" : "s"}`}
                          </summary>
                          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                            {fields.map(([k, c]) => (
                              <div key={k} className="contents">
                                <dt className="font-medium text-muted-foreground">{fieldLabel(k)}</dt>
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
          <Link
            className="h-9 rounded-md border px-4 text-sm leading-9 hover:bg-muted"
            href={`${link({})}${link({}).includes("?") ? "&" : "?"}before=${rows[rows.length - 1].id}`}
          >
            Older changes →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
