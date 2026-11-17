"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CacheClearResult, CacheTarget } from "@/lib/cache-clear";

interface Outcome extends CacheClearResult {
  at: number;
}

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function CacheClearShell({
  targets,
  loadError,
}: {
  targets: CacheTarget[];
  loadError: string | null;
}) {
  // Ids being cleared right now; "all" covers every row.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [error, setError] = useState<string | null>(loadError);

  const anyBusy = busy.size > 0;

  async function clear(target: string) {
    const ids = target === "all" ? targets.map((t) => t.id) : [target];
    setBusy(new Set(ids));
    setError(null);
    try {
      const res = await fetch("/api/admin/cache", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const body = (await res.json().catch(() => null)) as
        | { results?: CacheClearResult[]; error?: string }
        | null;
      if (!res.ok || !body?.results) {
        setError(body?.error ?? `The request failed (${res.status}).`);
        return;
      }
      const at = Date.now();
      setOutcomes((prev) => {
        const next = { ...prev };
        for (const r of body.results!) next[r.id] = { ...r, at };
        return next;
      });
    } catch {
      setError("Couldn't reach the launcher. Check your connection and try again.");
    } finally {
      setBusy(new Set());
    }
  }

  const done = Object.values(outcomes);
  const failures = done.filter((o) => !o.ok).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clear Cache</h1>
          <p className="text-muted-foreground">
            Makes the launcher and its apps re-read their data instead of using saved copies.
          </p>
        </div>
        <Button onClick={() => clear("all")} disabled={anyBusy || targets.length === 0}>
          {anyBusy && busy.size > 1 ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Clear everything
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Use this when something you changed isn&apos;t showing up: a role, an app&apos;s access, pricing, or a
        list that looks out of date. Nothing is deleted and nobody is signed out. The next page each
        person opens loads a little slower while the saved copies rebuild. It doesn&apos;t clear anyone&apos;s
        browser: a tab that is already open shows the new data after a reload.
      </p>

      {error && (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {done.length > 0 && !anyBusy && (
        <p role="status" className="text-sm">
          {failures === 0
            ? `Cleared ${done.length === 1 ? done[0].name : `${done.length} of ${done.length}`}.`
            : `${failures} of ${done.length} couldn't be cleared. See the rows below.`}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>App</TableHead>
            <TableHead>Last cleared from this page</TableHead>
            <TableHead className="w-32 text-right">
              <span className="sr-only">Clear</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {targets.map((t) => {
            const o = outcomes[t.id];
            const working = busy.has(t.id);
            return (
              <TableRow key={t.id}>
                <TableCell>
                  <div className="font-medium">{t.name}</div>
                  {t.origin && <div className="text-xs text-muted-foreground">{t.origin.replace(/^https?:\/\//, "")}</div>}
                </TableCell>
                <TableCell className="text-sm">
                  {working ? (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Clearing…
                    </span>
                  ) : !o ? (
                    <span className="text-muted-foreground">Not yet</span>
                  ) : o.ok ? (
                    <span className="inline-flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
                      Cleared at {timeFmt.format(o.at)}
                    </span>
                  ) : (
                    <span className="inline-flex items-start gap-2 text-destructive">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>Not cleared. {o.detail}</span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clear(t.id)}
                    disabled={anyBusy}
                    aria-label={`Clear ${t.name}`}
                  >
                    Clear
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
          {targets.length === 0 && !loadError && (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                No apps are set up to sign in through the launcher.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
