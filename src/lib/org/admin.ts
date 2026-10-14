// Admin CRUD for the shared office / department lists (launcher_offices /
// launcher_departments, migration 051). Every app on the database reads
// these, so names are immutable once created and a row can only be deleted
// when nothing — in the launcher or any other app — still uses it.
// Shared by /api/offices, /api/departments and their admin pages.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-session";
import { bustLauncherCache, isMissingTable } from "@/lib/launcher/cache";
import { DEPARTMENT_NAME_RE, NO_OFFICE, OFFICE_NAME_RE, type OrgItem } from "@/lib/org/constants";

export type OrgKind = "offices" | "departments";

type Supabase = ReturnType<typeof createAdminClient>;

interface UsageCheck {
  label: string;
  /** Count head query; tables owned by other apps may not exist. */
  count: (sb: Supabase, name: string) => PromiseLike<{ count: number | null; error: { code?: string; message: string } | null }>;
}

const eq = (table: string, column: string) => (sb: Supabase, name: string) =>
  sb.from(table).select("*", { count: "exact", head: true }).eq(column, name);
const contains = (table: string, column: string) => (sb: Supabase, name: string) =>
  sb.from(table).select("*", { count: "exact", head: true }).contains(column, [name]);

const CONFIG: Record<
  OrgKind,
  { table: string; singular: string; re: RegExp; hint: string; usage: UsageCheck[] }
> = {
  offices: {
    table: "launcher_offices",
    singular: "office",
    re: OFFICE_NAME_RE,
    hint: "Letters and digits only, 2–30 characters (e.g. Sales, RnD).",
    usage: [
      { label: "people", count: eq("profiles", "office") },
      { label: "app access rows", count: eq("launcher_role_app_access", "office") },
      { label: "app office lists", count: contains("launcher_apps", "offices") },
      { label: "links", count: eq("launcher_links", "office") },
      { label: "memos", count: eq("office_memos", "audience_office") },
      // Other apps' office-keyed data in the same database (skipped when the
      // table doesn't exist).
      { label: "PSB pricing regions", count: contains("psb_regions", "offices") },
      { label: "ASC customers", count: eq("asc_customers", "office") },
      { label: "ASC quotes", count: eq("asc_quotes", "office") },
      { label: "ASC sales reps", count: eq("asc_sales_reps", "office") },
    ],
  },
  departments: {
    table: "launcher_departments",
    singular: "department",
    re: DEPARTMENT_NAME_RE,
    hint: "Uppercase letters, digits and spaces, 2–30 characters (e.g. SALES TEAM).",
    usage: [
      { label: "people", count: eq("profiles", "department") },
      { label: "memos", count: eq("office_memos", "audience_department") },
    ],
  },
};

export function orgKindHint(kind: OrgKind): string {
  return CONFIG[kind].hint;
}

/** Everything still using a name: { total, summary } or an error if a check failed. */
export async function orgUsage(
  kind: OrgKind,
  name: string,
): Promise<{ total: number; summary: string } | { error: string }> {
  const sb = createAdminClient();
  const checks = CONFIG[kind].usage;
  const results = await Promise.all(checks.map((c) => c.count(sb, name)));
  const parts: string[] = [];
  let total = 0;
  for (let i = 0; i < checks.length; i++) {
    const { count, error } = results[i];
    if (error) {
      if (isMissingTable(error.code)) continue;
      return { error: `Couldn't check ${checks[i].label}: ${error.message}` };
    }
    if (count) {
      total += count;
      parts.push(`${count} ${checks[i].label}`);
    }
  }
  return { total, summary: parts.join(", ") };
}

/** The list for the admin page, straight from the table (no cache). */
export async function loadOrgAdmin(
  kind: OrgKind,
): Promise<{ items: OrgItem[]; missing: boolean; people: Record<string, number> }> {
  const sb = createAdminClient();
  const column = kind === "offices" ? "office" : "department";
  const [list, profiles] = await Promise.all([
    sb.from(CONFIG[kind].table).select("name, display_name, sort_order").order("sort_order").order("name"),
    sb.from("profiles").select(column).eq("is_active", true),
  ]);
  const people: Record<string, number> = {};
  for (const p of (profiles.data || []) as Array<Record<string, string | null>>) {
    const v = p[column];
    if (v) people[v] = (people[v] || 0) + 1;
  }
  if (list.error) return { items: [], missing: isMissingTable(list.error.code), people };
  return { items: (list.data || []) as OrgItem[], missing: false, people };
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(30),
  display_name: z.string().trim().min(1).max(60),
  sort_order: z.number().int().min(-100000).max(100000).optional(),
});

const updateSchema = z.object({
  display_name: z.string().trim().min(1).max(60).optional(),
  sort_order: z.number().int().min(-100000).max(100000).optional(),
});

const MIGRATION_MISSING = "Apply database migration 051 first.";

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** GET (list) + POST (create) for /api/offices and /api/departments. Admins only. */
export function orgCollectionHandlers(kind: OrgKind) {
  const cfg = CONFIG[kind];

  async function GET() {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;
    const { data, error } = await createAdminClient()
      .from(cfg.table)
      .select("name, display_name, sort_order, created_at")
      .order("sort_order")
      .order("name");
    if (error) {
      const status = isMissingTable(error.code) ? 503 : 500;
      return NextResponse.json({ error: status === 503 ? MIGRATION_MISSING : error.message }, { status });
    }
    return NextResponse.json(data || []);
  }

  async function POST(req: NextRequest) {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const name = parsed.data.name;
    if (!cfg.re.test(name)) {
      return NextResponse.json({ error: `Invalid ${cfg.singular} name. ${cfg.hint}` }, { status: 400 });
    }
    if (name.toLowerCase() === NO_OFFICE) {
      return NextResponse.json({ error: `"${name}" is reserved.` }, { status: 400 });
    }

    const sb = createAdminClient();
    const { data: existing, error: readError } = await sb.from(cfg.table).select("name, sort_order");
    if (readError) {
      const status = isMissingTable(readError.code) ? 503 : 500;
      return NextResponse.json({ error: status === 503 ? MIGRATION_MISSING : readError.message }, { status });
    }
    // Names differing only in case would be indistinguishable in most UIs.
    const clash = (existing || []).find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      return NextResponse.json({ error: `"${clash.name}" already exists.` }, { status: 409 });
    }
    const sortOrder =
      parsed.data.sort_order ??
      Math.max(0, ...(existing || []).map((r) => (r.sort_order as number) ?? 0)) + 10;

    const { data, error } = await sb
      .from(cfg.table)
      .insert({ name, display_name: parsed.data.display_name, sort_order: sortOrder })
      .select("name, display_name, sort_order, created_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `"${name}" already exists.` }, { status: 409 });
      }
      if (error.code === "23514") {
        return NextResponse.json({ error: `Invalid ${cfg.singular} name. ${cfg.hint}` }, { status: 400 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    bustLauncherCache(kind);
    return NextResponse.json(data, { status: 201 });
  }

  return { GET, POST };
}

/** PUT (display_name / sort_order) + DELETE (only when unused). Admins only. */
export function orgItemHandlers(kind: OrgKind) {
  const cfg = CONFIG[kind];
  type Ctx = { params: Promise<{ name: string }> };

  async function PUT(req: NextRequest, { params }: Ctx) {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;
    const name = decodeName((await params).name);

    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    // The name itself is immutable — every app stores it.
    const updates: Record<string, unknown> = {};
    if (parsed.data.display_name !== undefined) updates.display_name = parsed.data.display_name;
    if (parsed.data.sort_order !== undefined) updates.sort_order = parsed.data.sort_order;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await createAdminClient()
      .from(cfg.table)
      .update(updates)
      .eq("name", name)
      .select("name, display_name, sort_order, created_at")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    bustLauncherCache(kind);
    return NextResponse.json(data);
  }

  async function DELETE(_req: NextRequest, { params }: Ctx) {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;
    const name = decodeName((await params).name);

    const usage = await orgUsage(kind, name);
    if ("error" in usage) return NextResponse.json({ error: usage.error }, { status: 500 });
    if (usage.total > 0) {
      return NextResponse.json(
        { error: `Still used by ${usage.summary}. Move them to another ${cfg.singular} first.`, usage },
        { status: 409 },
      );
    }

    const { data, error } = await createAdminClient()
      .from(cfg.table)
      .delete()
      .eq("name", name)
      .select("name");
    if (error) {
      // FK / in-use trigger (migration 051): something started using it meanwhile.
      if (error.code === "23503") {
        return NextResponse.json({ error: `Still in use: ${error.message}` }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    bustLauncherCache(kind);
    return NextResponse.json({ success: true });
  }

  return { PUT, DELETE };
}
