import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { readUploadForm } from "@/app/api/_lib/attachment-upload";

// Your own profile photo (migration 066). The browser has already cropped
// it to a 256px square; this checks it's a small image, stores it in the
// public `avatars` bucket and points profiles.avatar_url at it. Old photos
// are removed so the folder only ever holds the current one.

const BUCKET = "avatars";
const MAX_BYTES = 1024 * 1024;
const TYPES: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

async function clearFolder(profileId: string, keep?: string) {
  const storage = createAdminClient().storage.from(BUCKET);
  const { data } = await storage.list(profileId, { limit: 100 });
  const old = (data || []).filter((o) => o.id && o.name !== keep).map((o) => `${profileId}/${o.name}`);
  if (old.length) await storage.remove(old);
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const profileId = session.user.profileId;

  const upload = await readUploadForm(req);
  if (upload instanceof NextResponse) return upload;
  const { file } = upload;
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Use a JPG, PNG or WebP image" }, { status: 415 });
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be under 1 MB" }, { status: 413 });
  }

  const supabase = createAdminClient();
  const name = `${randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${profileId}/${name}`, new Uint8Array(await file.arrayBuffer()), {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const url = supabase.storage.from(BUCKET).getPublicUrl(`${profileId}/${name}`).data.publicUrl;
  const { error: dbErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profileId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  await clearFolder(profileId, name).catch(() => undefined);
  return NextResponse.json({ avatar_url: url });
}

export async function DELETE() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const profileId = session.user.profileId;
  const { error } = await createAdminClient().from("profiles").update({ avatar_url: null }).eq("id", profileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await clearFolder(profileId).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
