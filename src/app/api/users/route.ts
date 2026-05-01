import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(["admin", "manager", "sales_rep", "bst", "rnd"]).default("sales_rep"),
  office: z.enum(["Harbor", "Marion"]).nullable().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  // The shared profiles table uses `full_name`; alias it as `name` for the UI.
  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, name:full_name, role, office, created_at, updated_at")
    .order("email");

  return NextResponse.json(users || []);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, name, role, office } = parsed.data;
  const supabase = createAdminClient();

  // Insert the profile directly. The shared DB has no auth.users FK on
  // profiles.id, and we don't manage Supabase Auth from the launcher —
  // users sign in via NextAuth (Google), which matches by email.
  const { data: profile, error } = await supabase
    .from("profiles")
    .insert({ email, full_name: name ?? null, role, office: office ?? null })
    .select("id, email, name:full_name, role, office, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A user with that email already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(profile, { status: 201 });
}
