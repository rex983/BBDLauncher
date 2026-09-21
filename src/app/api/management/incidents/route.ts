import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import {
  EMPLOYEE_ACKNOWLEDGEMENT_TEMPLATE,
} from "@/lib/incidents/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const VALID_OFFICES = new Set(["Harbor", "Marion", "BST", "RnD"]);
const VALID_DEPARTMENTS = new Set(["SALES TEAM", "BST", "RnD"]);

const attachmentSchema = z.object({
  path: z.string().min(1),
  filename: z.string().min(1),
  size: z.number().nonnegative(),
  mime: z.string().min(1),
});

// Manager creates a new incident report. Body carries the AI-generated
// document text (or the manager's edited version) — the /generate endpoint
// produces it separately so drafts can be regenerated without persisting a
// row every time.
const createSchema = z.object({
  employee_profile_id: z.string().uuid(),
  title: z.string().min(3).max(200),
  severity: z.enum(["low", "medium", "high", "critical"]),
  category: z.enum([
    "attendance",
    "performance",
    "conduct",
    "safety",
    "policy",
    "other",
  ]),
  occurred_at: z.string().datetime().nullable().optional(),
  description: z.string().min(10).max(10_000),
  document: z.string().min(10).max(30_000),
  acknowledgement_text: z.string().max(5_000).optional(),
  attachments: z.array(attachmentSchema).max(10).default([]),
});

// GET /api/management/incidents — list incidents visible to the viewer.
// Query params:
//   status         (optional) — comma-separated statuses to include
//   office         (admin overlay) — filter by employee's office
//   department     (admin overlay) — filter by employee's department
export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope } = gate;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("statuses") || url.searchParams.get("status");
  const statuses = statusParam
    ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
    : ["draft", "awaiting_manager_sig", "awaiting_employee_sig", "completed", "cancelled"];

  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  if (officeFilter && !VALID_OFFICES.has(officeFilter)) {
    return NextResponse.json({ error: "Invalid office" }, { status: 400 });
  }
  if (departmentFilter && !VALID_DEPARTMENTS.has(departmentFilter)) {
    return NextResponse.json({ error: "Invalid department" }, { status: 400 });
  }

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department")
    .eq("is_active", true);
  if (scope.department) profileQuery = profileQuery.eq("department", scope.department);
  else if (departmentFilter) profileQuery = profileQuery.eq("department", departmentFilter);
  if (scope.office) profileQuery = profileQuery.eq("office", scope.office);
  else if (officeFilter) profileQuery = profileQuery.eq("office", officeFilter);

  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json([]);

  const { data: reports, error } = await supabase
    .from("incident_reports")
    .select(
      "id, number, employee_profile_id, reporter_profile_id, title, severity, category, status, occurred_at, attachments, manager_signed_at, employee_signed_at, cancelled_at, created_at, updated_at",
    )
    .in("employee_profile_id", profileIds)
    .in("status", statuses)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  return NextResponse.json(
    (reports || []).map((r) => ({
      ...r,
      employee: profileMap.get(r.employee_profile_id) || null,
    })),
  );
}

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const gate = await requireTimeDataAccess(parsed.data.employee_profile_id, "edit");
  if (!gate.ok) return gate.response;
  const { session, supabase } = gate;

  // Prevent managers from filing on themselves — admins can override.
  if (
    parsed.data.employee_profile_id === session.user.profileId &&
    session.user.role !== "admin"
  ) {
    return NextResponse.json(
      { error: "Cannot file an incident report on yourself" },
      { status: 400 },
    );
  }

  // Validate attachment paths are prefixed with the target employee's id —
  // stops a manager smuggling in files uploaded against a different employee.
  for (const a of parsed.data.attachments) {
    if (!a.path.startsWith(`${parsed.data.employee_profile_id}/`)) {
      return NextResponse.json({ error: "Invalid attachment path" }, { status: 400 });
    }
  }

  const acknowledgement =
    parsed.data.acknowledgement_text?.trim() || EMPLOYEE_ACKNOWLEDGEMENT_TEMPLATE;

  const { data, error } = await supabase
    .from("incident_reports")
    .insert({
      employee_profile_id: parsed.data.employee_profile_id,
      reporter_profile_id: session.user.profileId,
      title: parsed.data.title,
      severity: parsed.data.severity,
      category: parsed.data.category,
      occurred_at: parsed.data.occurred_at ?? null,
      description: parsed.data.description,
      document: parsed.data.document,
      acknowledgement_text: acknowledgement,
      attachments: parsed.data.attachments,
      // Newly created reports go straight to "awaiting manager signature" —
      // there's no separate draft-save UX yet; the manager reviews on the
      // client and clicks "Send for signatures" which does one create+sign
      // sequence.
      status: "awaiting_manager_sig",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
