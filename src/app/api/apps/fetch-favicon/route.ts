import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageContent } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/gif",
]);

const EXT_FROM_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/gif": "gif",
};

const MAX_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 8_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; BBDLauncherFaviconBot/1.0; +https://bbd-launcher.vercel.app)";

interface IconCandidate {
  href: string;
  size: number;
  isApple: boolean;
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
        ...(init?.headers || {}),
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseSizes(sizesAttr: string | null): number {
  if (!sizesAttr) return 0;
  if (/any/i.test(sizesAttr)) return 512;
  const match = sizesAttr.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return 0;
  return Math.max(parseInt(match[1], 10) || 0, parseInt(match[2], 10) || 0);
}

function extractIconCandidates(html: string, baseUrl: URL): IconCandidate[] {
  const candidates: IconCandidate[] = [];
  const linkRegex = /<link\b[^>]*>/gi;
  const links = html.match(linkRegex) || [];
  for (const link of links) {
    const relMatch = link.match(/\brel\s*=\s*["']([^"']+)["']/i);
    if (!relMatch) continue;
    const rel = relMatch[1].toLowerCase();
    if (
      !rel.includes("icon") &&
      rel !== "apple-touch-icon" &&
      rel !== "apple-touch-icon-precomposed"
    ) {
      continue;
    }
    const hrefMatch = link.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const sizesMatch = link.match(/\bsizes\s*=\s*["']([^"']+)["']/i);
    try {
      const absolute = new URL(hrefMatch[1], baseUrl).toString();
      candidates.push({
        href: absolute,
        size: parseSizes(sizesMatch?.[1] ?? null),
        isApple: rel.startsWith("apple"),
      });
    } catch {
      // ignore malformed href
    }
  }
  return candidates;
}

function rankCandidates(candidates: IconCandidate[]): IconCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    if (a.isApple !== b.isApple) return a.isApple ? -1 : 1;
    return 0;
  });
}

async function downloadIcon(
  href: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await fetchWithTimeout(href);
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) return null;
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_BYTES) return null;
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let target: URL;
  try {
    const body = await req.json();
    if (typeof body?.url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    target = new URL(body.url);
    if (!/^https?:$/.test(target.protocol)) {
      return NextResponse.json({ error: "URL must be http(s)" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  let candidates: IconCandidate[] = [];
  try {
    const pageRes = await fetchWithTimeout(target.toString());
    if (pageRes.ok) {
      const html = await pageRes.text();
      candidates = extractIconCandidates(html, new URL(pageRes.url));
    }
  } catch {
    // fall through to /favicon.ico
  }

  candidates.push({
    href: new URL("/favicon.ico", target).toString(),
    size: 0,
    isApple: false,
  });

  let picked: { buffer: Buffer; contentType: string; source: string } | null = null;
  for (const candidate of rankCandidates(candidates)) {
    const downloaded = await downloadIcon(candidate.href);
    if (downloaded) {
      picked = { ...downloaded, source: candidate.href };
      break;
    }
  }

  if (!picked) {
    return NextResponse.json(
      { error: "No usable favicon found" },
      { status: 404 }
    );
  }

  const ext = EXT_FROM_TYPE[picked.contentType] || "png";
  const path = `${randomUUID()}.${ext}`;
  const supabase = createAdminClient();

  const { error } = await supabase.storage
    .from("app-icons")
    .upload(path, picked.buffer, {
      contentType: picked.contentType,
      upsert: false,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from("app-icons").getPublicUrl(path);
  return NextResponse.json({ url: pub.publicUrl, path, source: picked.source });
}
