"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Server page.tsx hydrates this shell with initialRows so first paint is
// populated. Client refetches on filter changes / after actions.
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
import {
  formatMemoNumber,
  MEMO_CATEGORIES,
  MEMO_CATEGORY_LABEL,
  MEMO_PRIORITIES,
  MEMO_PRIORITY_LABEL,
  MEMO_STATUS_LABEL,
  type MemoAcknowledgementMode,
  type MemoAudienceScope,
  type MemoCategory,
  type MemoPriority,
  type MemoStatus,
} from "@/lib/memos/types";

interface MemoSummary {
  id: string;
  number: number | null;
  author_profile_id: string | null;
  author_name: string | null;
  title: string;
  category: MemoCategory;
  priority: MemoPriority;
  acknowledgement_mode: MemoAcknowledgementMode;
  audience_scope: MemoAudienceScope;
  audience_office: string | null;
  audience_department: string | null;
  status: MemoStatus;
  effective_date: string | null;
  published_at: string | null;
  created_at: string;
  stats: { delivered: number; read: number; acknowledged: number };
}

const PRIORITY_VARIANT: Record<
  MemoPriority,
  "default" | "secondary" | "outline" | "destructive"
> = {
  informational: "outline",
  important: "default",
  mandatory: "destructive",
};

const ACTIVE_STATUSES: MemoStatus[] = ["draft", "published"];
const ARCHIVE_STATUSES: MemoStatus[] = ["archived"];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function audienceLabel(m: MemoSummary) {
  if (m.audience_scope === "company") return "Whole company";
  if (m.audience_scope === "office") return `Office · ${m.audience_office}`;
  if (m.audience_scope === "department") {
    return `Dept · ${m.audience_department}${m.audience_office ? ` @ ${m.audience_office}` : ""}`;
  }
  return "Custom list";
}

export default function MemosShell({
  initialRows,
}: {
  initialRows: MemoSummary[];
}) {
  useSession(); // keep the SessionProvider dependency for consistency
  const [rows, setRows] = useState<MemoSummary[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [priorityFilter, setPriorityFilter] = useState<MemoPriority | "all">(
    "all",
  );
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  // Skip the initial refetch — server rendered with the right rows.
  const skipInitialFetch = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/management/memos");
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const body: MemoSummary[] = await res.json();
    setRows(body);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const statuses = tab === "active" ? ACTIVE_STATUSES : ARCHIVE_STATUSES;
    return rows
      .filter((r) => statuses.includes(r.status))
      .filter((r) => priorityFilter === "all" || r.priority === priorityFilter)
      .filter((r) => categoryFilter === "all" || r.category === categoryFilter)
      .filter((r) => {
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return (
          r.title.toLowerCase().includes(q) ||
          (r.author_name || "").toLowerCase().includes(q)
        );
      });
  }, [rows, tab, priorityFilter, categoryFilter, query]);


  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">
            <Link href="/management/timesheets" className="hover:underline">
              ← Timesheets
            </Link>
          </div>
          <h1 className="text-2xl font-bold">Office Memos</h1>
          <p className="text-muted-foreground">
            Publish memos to your office, department, or a custom list. Track
            reads and acknowledgements.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/management/memos/new">
            <Megaphone className="mr-2 h-4 w-4" />
            New memo
          </Link>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="active">
            Active
            <Badge variant="secondary" className="ml-2">
              {rows.filter((r) => ACTIVE_STATUSES.includes(r.status)).length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="archive">
            Archive
            <Badge variant="secondary" className="ml-2">
              {rows.filter((r) => ARCHIVE_STATUSES.includes(r.status)).length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Input
            placeholder="Search title, author…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={priorityFilter}
            onValueChange={(v) => setPriorityFilter(v as typeof priorityFilter)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {MEMO_PRIORITIES.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {MEMO_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="active" className="mt-4">
          <MemoRowTable
            rows={filtered}
            loading={loading}
            emptyLabel="No active memos."
          />
        </TabsContent>
        <TabsContent value="archive" className="mt-4">
          <MemoRowTable
            rows={filtered}
            loading={loading}
            emptyLabel="No archived memos."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MemoRowTable({
  rows,
  loading,
  emptyLabel,
}: {
  rows: MemoSummary[];
  loading: boolean;
  emptyLabel: string;
}) {
  const router = useRouter();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Published</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Audience</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Acks</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && (
          <TableRow>
            <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
              Loading…
            </TableCell>
          </TableRow>
        )}
        {!loading && rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
              {emptyLabel}
            </TableCell>
          </TableRow>
        )}
        {rows.map((r) => (
          <TableRow
            key={r.id}
            className="cursor-pointer hover:bg-muted/40"
            onClick={() => router.push(`/management/memos/${r.id}`)}
          >
            <TableCell className="font-mono text-xs text-muted-foreground">
              {formatMemoNumber(r.number)}
            </TableCell>
            <TableCell className="text-sm">
              {fmtDate(r.published_at || r.created_at)}
            </TableCell>
            <TableCell className="font-medium">{r.title}</TableCell>
            <TableCell className="text-sm">{r.author_name || "—"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {audienceLabel(r)}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{MEMO_CATEGORY_LABEL[r.category]}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={PRIORITY_VARIANT[r.priority]}>
                {MEMO_PRIORITY_LABEL[r.priority]}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{MEMO_STATUS_LABEL[r.status]}</Badge>
            </TableCell>
            <TableCell className="text-xs">
              {r.status === "published" ? (
                <span className="text-muted-foreground">
                  {r.stats.acknowledged}/{r.stats.delivered}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
