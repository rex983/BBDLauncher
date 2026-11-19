"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  Factory,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortHeader } from "@/components/ui/sort-header";
import { SideSheet, SideSheetTitle } from "@/components/ui/side-sheet";
import { useSortableRows } from "@/lib/hooks/use-sortable-rows";
import { cn } from "@/lib/utils";
import { fmtDateUS, fmtRelative } from "@/components/shared/format";
import { useConfirmAction } from "@/components/shared/confirm";
import type { ManufacturerDetail, ManufacturerRow } from "@/types/manufacturer";
import {
  DepositTiers,
  ManufacturerFormDialog,
  ManufacturerHistory,
  ManufacturerLogo,
  deleteRequest,
  depositSummary,
  toggleActiveRequest,
} from "./manufacturer-parts";

// The Manufacturers page: find one fast, click it for its card, edit or
// retire it from the row. Deposits are read-only (Strapi owns them).

type Status = "active" | "inactive";
type SortKey = "name" | "sku" | "deposit" | "updated";

const SORTERS: Record<SortKey, (m: ManufacturerRow) => string | number | Date | null> = {
  name: (m) => m.name.toLowerCase(),
  sku: (m) => m.sku?.toLowerCase() ?? null,
  deposit: (m) => (m.deposit_tiers?.length ? m.deposit_tiers[0].percent : m.deposit_percent),
  updated: (m) => new Date(m.updated_at),
};

export function ManufacturersShell() {
  const [items, setItems] = useState<ManufacturerRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ManufacturerRow | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  // Bumped after a save so an open card reloads its history.
  const [version, setVersion] = useState(0);

  const fetchItems = useCallback(async () => {
    const res = await fetch("/api/manufacturers").catch(() => null);
    if (res?.ok) {
      setItems(await res.json());
      setLoadError(null);
      setVersion((v) => v + 1);
    } else {
      setLoadError("Couldn't load manufacturers. Refresh to try again.");
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const confirm = useConfirmAction(fetchItems);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (m: ManufacturerRow) => {
    setEditing(m);
    setFormOpen(true);
  };

  const all = useMemo(() => items ?? [], [items]);
  const activeCount = all.filter((m) => m.active).length;
  const inactiveCount = all.length - activeCount;
  const inStatus = useMemo(() => all.filter((m) => (status === "active" ? m.active : !m.active)), [all, status]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return inStatus;
    return inStatus.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) ||
        (m.sku ?? "").toLowerCase().includes(needle) ||
        (m.hq_location ?? "").toLowerCase().includes(needle),
    );
  }, [inStatus, q]);
  const { sorted, sort, toggle } = useSortableRows<ManufacturerRow, SortKey>(filtered, SORTERS, {
    key: "name",
    direction: "asc",
  });

  const peeked = peekId ? all.find((m) => m.id === peekId) ?? null : null;
  // The manufacturer was deleted while its card was open.
  useEffect(() => {
    if (peekId && items && !items.some((m) => m.id === peekId)) setPeekId(null);
  }, [peekId, items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Manufacturers</h1>
          <p className="text-muted-foreground">
            Click a manufacturer to see its details and history. Deposits are managed in Strapi.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" />
          Add Manufacturer
        </Button>
      </div>

      <ManufacturerFormDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} onSaved={fetchItems} />
      {confirm.dialog}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or SKU…"
            className="pl-8"
            aria-label="Search manufacturers"
          />
        </div>
        {q.trim() && (
          <Button variant="ghost" size="sm" onClick={() => setQ("")}>
            <X className="h-4 w-4" />
            Clear
          </Button>
        )}
        <div className="ml-auto inline-flex rounded-md border p-0.5">
          <Segment active={status === "active"} onClick={() => setStatus("active")}>
            Active <Count>{activeCount}</Count>
          </Segment>
          <Segment active={status === "inactive"} onClick={() => setStatus("inactive")}>
            Inactive <Count>{inactiveCount}</Count>
          </Segment>
        </div>
      </div>

      {loadError && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </p>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader columnKey="name" label="Manufacturer" sort={sort} onToggle={toggle} />
              <SortHeader columnKey="sku" label="SKU" sort={sort} onToggle={toggle} />
              <SortHeader columnKey="deposit" label="Deposit" sort={sort} onToggle={toggle} />
              <TableHead>SignNow template</TableHead>
              <SortHeader columnKey="updated" label="Updated" sort={sort} onToggle={toggle} />
              <TableHead className="w-[88px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items === null && !loadError &&
              [0, 1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <div className="h-9 animate-pulse rounded bg-muted" />
                  </TableCell>
                </TableRow>
              ))}
            {items !== null && sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {q.trim() ? (
                    <>
                      Nothing matches.{" "}
                      <button type="button" className="underline underline-offset-4" onClick={() => setQ("")}>
                        Clear search
                      </button>
                    </>
                  ) : status === "inactive" ? (
                    "No inactive manufacturers."
                  ) : (
                    "No manufacturers yet."
                  )}
                </TableCell>
              </TableRow>
            )}
            {sorted.map((m) => (
              <TableRow
                key={m.id}
                className={cn("cursor-pointer", !m.active && "opacity-60")}
                onClick={() => setPeekId(m.id)}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <ManufacturerLogo id={m.id} name={m.name} logoUrl={m.logo_url} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium">
                        <span className="truncate">{m.name}</span>
                        {!m.active && <Badge variant="secondary">Inactive</Badge>}
                      </div>
                      {m.hq_location && <div className="truncate text-xs text-muted-foreground">{m.hq_location}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell>{m.sku || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{depositSummary(m)}</TableCell>
                <TableCell>
                  {m.sign_now_template_id ? (
                    <span className="font-mono text-xs" title={m.sign_now_template_id}>
                      {m.sign_now_template_id.length > 14
                        ? `${m.sign_now_template_id.slice(0, 12)}…`
                        : m.sign_now_template_id}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateUS(m.updated_at)}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon-sm" title="Edit" onClick={() => openEdit(m)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`More for ${m.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/manufacturers/${m.id}`}>
                            <Factory />
                            Open full page
                          </Link>
                        </DropdownMenuItem>
                        {m.hub_url && (
                          <DropdownMenuItem asChild>
                            <a href={m.hub_url} target="_blank" rel="noreferrer">
                              <ExternalLink />
                              Open in Manufacturer Hub
                            </a>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => openEdit(m)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => confirm.ask(toggleActiveRequest(m))}>
                          <Power />
                          {m.active ? "Deactivate" : "Reactivate"}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => confirm.ask(deleteRequest(m))}>
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {items !== null && sorted.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {q.trim() ? `${sorted.length} of ${inStatus.length}` : sorted.length} {status === "inactive" ? "inactive " : ""}
          manufacturer{sorted.length === 1 && !q.trim() ? "" : "s"}
        </p>
      )}

      <ManufacturerCard
        manufacturer={peeked}
        version={version}
        onClose={() => setPeekId(null)}
        // One dialog at a time: the card closes before the form opens.
        onEdit={(m) => {
          setPeekId(null);
          openEdit(m);
        }}
      />
    </div>
  );
}

/** The card that slides in when a row is clicked. */
function ManufacturerCard({
  manufacturer: m,
  version,
  onClose,
  onEdit,
}: {
  manufacturer: ManufacturerRow | null;
  version: number;
  onClose: () => void;
  onEdit: (m: ManufacturerRow) => void;
}) {
  const [detail, setDetail] = useState<ManufacturerDetail | null>(null);
  const [copied, setCopied] = useState(false);
  const id = m?.id ?? null;

  useEffect(() => {
    setCopied(false);
    if (!id) return;
    let cancelled = false;
    setDetail((d) => (d?.id === id ? d : null));
    fetch(`/api/manufacturers/${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<ManufacturerDetail>) : null))
      .then((d) => !cancelled && d && setDetail(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const copyTemplate = async () => {
    if (!m?.sign_now_template_id) return;
    try {
      await navigator.clipboard.writeText(m.sign_now_template_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the id is on screen to select.
    }
  };

  return (
    <SideSheet open={!!m} onOpenChange={(o) => !o && onClose()}>
      {m && (
        <>
          <div className="flex flex-col items-center gap-3 border-b px-6 pb-5 pt-8 text-center">
            <ManufacturerLogo id={m.id} name={m.name} logoUrl={m.logo_url} size={96} />
            <div className="min-w-0 max-w-full">
              <SideSheetTitle className="truncate text-xl font-semibold">{m.name}</SideSheetTitle>
              {m.headline && <p className="mt-1 text-sm text-muted-foreground">{m.headline}</p>}
              <div className="mt-2 flex justify-center">
                <Badge variant={m.active ? "default" : "secondary"}>{m.active ? "Active" : "Inactive"}</Badge>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
            <dl className="space-y-3 text-sm">
              <Field label="SKU">{m.sku || "—"}</Field>
              {m.hq_location && <Field label="Headquarters">{m.hq_location}</Field>}
              <Field label="SignNow template">
                {m.sign_now_template_id ? (
                  <span className="flex items-center justify-end gap-1">
                    <span className="truncate font-mono text-xs" title={m.sign_now_template_id}>
                      {m.sign_now_template_id}
                    </span>
                    <button
                      type="button"
                      onClick={copyTemplate}
                      title="Copy template ID"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </Field>
              <Field label="Deposit">{depositSummary(m)}</Field>
              <Field label="Added">{fmtDateUS(m.created_at)}</Field>
              <Field label="Updated">
                <span title={fmtDateUS(m.updated_at)}>{fmtRelative(m.updated_at, fmtDateUS)}</span>
              </Field>
            </dl>

            {m.deposit_tiers && m.deposit_tiers.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Deposit tiers
                </h3>
                <DepositTiers tiers={m.deposit_tiers} />
              </section>
            )}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recent changes
              </h3>
              {detail?.id === m.id ? (
                <ManufacturerHistory history={detail.history} compact />
              ) : (
                <div className="h-12 animate-pulse rounded bg-muted" />
              )}
            </section>
          </div>

          <div className="space-y-2 border-t px-6 py-4">
            <Button asChild className="w-full">
              <Link href={`/admin/manufacturers/${m.id}`}>
                <Factory className="h-4 w-4" />
                Open full page
              </Link>
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => onEdit(m)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              {m.hub_url && (
                <Button asChild variant="outline" className="flex-1">
                  <a href={m.hub_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Hub page
                  </a>
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </SideSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1 text-sm transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="text-xs tabular-nums opacity-70">{children}</span>;
}
