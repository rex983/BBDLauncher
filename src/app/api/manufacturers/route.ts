import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageContent } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const depositTierSchema = z.object({
  upTo: z.number().nullable(),
  percent: z.number(),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().nullable().optional(),
  sign_now_template_id: z.string().default(""),
  deposit_percent: z.number().nullable().optional(),
  deposit_tiers: z.array(depositTierSchema).nullable().optional(),
  active: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("manufacturer_config")
    .select("*")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("manufacturer_config")
    .insert({
      name: parsed.data.name,
      sku: parsed.data.sku ?? null,
      sign_now_template_id: parsed.data.sign_now_template_id,
      deposit_percent: parsed.data.deposit_percent ?? null,
      deposit_tiers: parsed.data.deposit_tiers ?? null,
      active: parsed.data.active,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("manufacturer_config_changelog").insert({
    config_id: data.id,
    config_name: data.name,
    action: "created",
    changes: [
      { field: "name", oldValue: null, newValue: data.name },
      { field: "sku", oldValue: null, newValue: data.sku },
      { field: "sign_now_template_id", oldValue: null, newValue: data.sign_now_template_id },
      { field: "deposit_percent", oldValue: null, newValue: data.deposit_percent },
      { field: "deposit_tiers", oldValue: null, newValue: data.deposit_tiers },
      { field: "active", oldValue: null, newValue: data.active },
    ],
    user_id: session.user.profileId,
    user_email: session.user.email,
  });

  return NextResponse.json(data, { status: 201 });
}
