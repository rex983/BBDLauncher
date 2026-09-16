import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageContent } from "@/lib/auth/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";

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

// SSRF defense: reject any outbound fetch whose resolved host lands in a
// private/loopback/link-local range. Admin-only endpoint, but this stops a
// compromised admin (or an admin who pastes an intranet URL by accident)
// from turning the launcher into an internal-network scanner.
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;         // ULA
  if (lower.startsWith("ff")) return true;                                    // multicast
  if (lower.startsWith("::ffff:")) {                                          // IPv4-mapped
    const v4 = lower.slice(7);
    return isIP(v4) === 4 ? isPrivateIPv4(v4) : true;
  }
  return false;
}

// Reject hostnames that browsers/Node normalize to loopback via octal, hex,
// integer, or trailing-dot forms. These bypass the isIP() literal-IP check
// because they aren't dotted-quad and thus don't classify as IPv4.
function isSuspiciousHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost") return true;
  if (lower.endsWith(".localhost")) return true;
  if (lower === "0" || lower === "0.0.0.0") return true;
  // Bare hex/octal/decimal (e.g. 0x7f000001, 017700000001, 2130706433)
  if (/^0x[0-9a-f]+$/.test(lower)) return true;
  if (/^0[0-7]+$/.test(lower)) return true;
  if (/^\d+$/.test(lower)) return true;
  // Metadata service literals (also blocked by isPrivateIPv4 for 169.254, but
  // guard the alias forms defensively).
  if (lower === "metadata.google.internal") return true;
  if (lower.endsWith(".internal")) return true;
  return false;
}

async function resolvePublicIPs(hostname: string): Promise<string[] | null> {
  const version = isIP(hostname);
  if (version === 4) {
    return isPrivateIPv4(hostname) ? null : [hostname];
  }
  if (version === 6) {
    return isPrivateIPv6(hostname) ? null : [hostname];
  }
  if (isSuspiciousHostname(hostname)) return null;

  try {
    const addrs = await lookup(hostname, { all: true, verbatim: false });
    if (addrs.length === 0) return null;
    for (const { address, family } of addrs) {
      if (family === 4 && isPrivateIPv4(address)) return null;
      if (family === 6 && isPrivateIPv6(address)) return null;
    }
    return addrs.map((a) => a.address);
  } catch {
    return null;
  }
}

async function isPublicHost(hostname: string): Promise<boolean> {
  return (await resolvePublicIPs(hostname)) !== null;
}

interface IconCandidate {
  href: string;
  size: number;
  isApple: boolean;
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const parsed = new URL(url);
  if (!(await isPublicHost(parsed.hostname))) {
    throw new Error("Refusing to fetch private/loopback host");
  }
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

  // Outbound fetch per admin: this endpoint reaches arbitrary hosts, so cap
  // it hard to prevent using the launcher as a DNS scanner or HTTP probe.
  const rl = rateLimit(`fetch-favicon:${session.user.profileId}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many favicon fetches" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
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

  if (!(await isPublicHost(target.hostname))) {
    return NextResponse.json(
      { error: "URL host is not publicly reachable" },
      { status: 400 }
    );
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
