"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppCard } from "./app-card";
import { AppListRow } from "./app-list-row";
import { AppGrid, type ViewType } from "./app-grid";
import { ImportantLinks } from "./important-links";
import { applyReorderUpdates, computeReorderUpdates } from "./reorder";
import { DEFAULT_SORT, SORT_OPTIONS, isSortMode, sortItems, type ClickStats, type SortMode } from "./sort";
import { Search, ChevronDown, ChevronRight, Star, LayoutGrid, List, ArrowUpDown } from "lucide-react";
import type { LauncherApp, LauncherSection } from "@/types/app";
import type { ImportantLink } from "@/types/link";

interface SectionedAppGridProps {
  apps: LauncherApp[];
  sections: LauncherSection[];
  isAdmin: boolean;
  links: ImportantLink[];
  /** The viewer's own opens, for the click sorts. */
  clickStats: ClickStats;
}

const FAVORITES_KEY = "bbd-favorites";
const COLLAPSE_KEY = "bbd-section-collapse";
const VIEW_TYPE_KEY = "bbd-view-type";
const SORT_KEY = "bbd-sort";
const FAVORITES_ID = "__favorites__";
const UNSORTED_ID = "__unsorted__";

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window / blocked storage: the choice just isn't remembered.
  }
}

function SectionHeader({
  id,
  name,
  count,
  collapsed,
  onToggle,
  pinnedIcon,
}: {
  id: string;
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  pinnedIcon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={`section-${id}`}
      className="flex items-center gap-2 w-full text-left py-1.5 hover:text-primary transition-colors group"
    >
      {collapsed ? (
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
      ) : (
        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
      )}
      {pinnedIcon}
      <h2 className="text-sm font-semibold">{name}</h2>
      <span className="text-xs text-muted-foreground">({count})</span>
    </button>
  );
}

function DroppableSection({
  id,
  children,
  enabled,
}: {
  id: string;
  children: React.ReactNode;
  enabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !enabled });
  return (
    <div
      ref={enabled ? setNodeRef : undefined}
      className={`rounded-md transition-colors ${
        enabled && isOver ? "bg-accent/40 ring-2 ring-primary/40" : ""
      }`}
    >
      {children}
    </div>
  );
}

export function SectionedAppGrid({ apps, sections, isAdmin, links, clickStats }: SectionedAppGridProps) {
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [viewType, setViewType] = useState<ViewType>("cards");
  const [sort, setSort] = useState<SortMode>(DEFAULT_SORT);
  // Admin-only local working copy of apps so drag-drop feels instant.
  // Re-seeded during render whenever the server sends a new `apps` list.
  const [workingApps, setWorkingApps] = useState<LauncherApp[]>(apps);
  const [seededFrom, setSeededFrom] = useState(apps);
  if (seededFrom !== apps) {
    setSeededFrom(apps);
    setWorkingApps(apps);
  }
  const [workingLinks, setWorkingLinks] = useState<ImportantLink[]>(links);
  const [linksSeededFrom, setLinksSeededFrom] = useState(links);
  if (linksSeededFrom !== links) {
    setLinksSeededFrom(links);
    setWorkingLinks(links);
  }
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // Admins can drag in any sort. Off "Custom order" a drop starts from the
  // order on screen, then the page switches to Custom order to show it.
  const canDrag = isAdmin;

  useEffect(() => {
    setFavorites(readJSON<string[]>(FAVORITES_KEY, []));
    setCollapsed(readJSON<Record<string, boolean>>(COLLAPSE_KEY, {}));
    const savedView = readJSON<ViewType>(VIEW_TYPE_KEY, "cards");
    setViewType(savedView === "list" ? "list" : "cards");
    const savedSort = readJSON<unknown>(SORT_KEY, DEFAULT_SORT);
    setSort(isSortMode(savedSort) ? savedSort : DEFAULT_SORT);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const changeViewType = (next: ViewType) => {
    setViewType(next);
    writeJSON(VIEW_TYPE_KEY, next);
  };

  const changeSort = (next: string) => {
    if (!isSortMode(next)) return;
    setSort(next);
    writeJSON(SORT_KEY, next);
  };

  const toggleFavorite = (appId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(appId)
        ? prev.filter((id) => id !== appId)
        : [...prev, appId];
      writeJSON(FAVORITES_KEY, next);
      return next;
    });
  };

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeJSON(COLLAPSE_KEY, next);
      return next;
    });
  };

  const filteredApps = useMemo(() => {
    if (!search) return workingApps;
    const q = search.toLowerCase();
    return workingApps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q)
    );
  }, [workingApps, search]);

  const appsBySection = useMemo(() => {
    const map = new Map<string | null, LauncherApp[]>();
    for (const app of filteredApps) {
      const key = app.section_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(app);
    }
    for (const [key, list] of map) {
      map.set(key, sortItems(list, sort, clickStats.apps));
    }
    return map;
  }, [filteredApps, sort, clickStats]);

  const favoriteApps = useMemo(() => {
    const set = new Set(favorites);
    return sortItems(filteredApps.filter((a) => set.has(a.id)), sort, clickStats.apps);
  }, [filteredApps, favorites, sort, clickStats]);

  const sortedLinks = useMemo(
    () => sortItems(workingLinks, sort, clickStats.links),
    [workingLinks, sort, clickStats],
  );

  const unsortedApps = appsBySection.get(null) || [];
  const isSearching = search.trim().length > 0;
  const effectiveCollapsed = (id: string) => (isSearching ? false : !!collapsed[id]);

  // display_order rewritten to match the current sort, section by section.
  const asShown = (list: LauncherApp[]) => {
    const bySection = new Map<string | null, LauncherApp[]>();
    for (const app of list) {
      const key = app.section_id ?? null;
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key)!.push(app);
    }
    return [...bySection.values()].flatMap((group) =>
      sortItems(group, sort, clickStats.apps).map((a, i) => ({ ...a, display_order: i })),
    );
  };

  const handleLinksReordered = (next: ImportantLink[]) => {
    setWorkingLinks(next);
    if (sort !== "custom") changeSort("custom");
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const sectionContainerIds = new Set<string>([
      UNSORTED_ID,
      ...sections.map((s) => s.id),
    ]);

    const updates = computeReorderUpdates({
      apps: sort === "custom" ? workingApps : asShown(workingApps),
      activeId: String(active.id),
      overId: String(over.id),
      sectionContainerIds,
      unsortedId: UNSORTED_ID,
    });
    if (!updates) return;

    const previous = workingApps;
    setWorkingApps((prev) => applyReorderUpdates(prev, updates));
    if (sort !== "custom") changeSort("custom");

    try {
      const res = await fetch("/api/apps/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error(`reorder ${res.status}`);
    } catch (err) {
      console.error("Reorder failed:", err);
      setWorkingApps(previous);
      alert("Couldn't save the new order — reverted.");
    }
  };

  const activeApp = activeDragId
    ? workingApps.find((a) => a.id === activeDragId)
    : null;

  const content = (
    <div className="space-y-6">
      {favoriteApps.length > 0 && (
        <div className="space-y-2">
          <SectionHeader
            id={FAVORITES_ID}
            name="Favorites"
            count={favoriteApps.length}
            collapsed={effectiveCollapsed(FAVORITES_ID)}
            onToggle={() => toggleCollapse(FAVORITES_ID)}
            pinnedIcon={
              <Star className="h-4 w-4 text-yellow-500" fill="currentColor" />
            }
          />
          {!effectiveCollapsed(FAVORITES_ID) && (
            <div id={`section-${FAVORITES_ID}`}>
              {/* Favorites grid is never droppable/sortable — it's a per-user view. */}
              <AppGrid
                apps={favoriteApps}
                viewType={viewType}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                showDragHandle={false}
              />
            </div>
          )}
        </div>
      )}

      {sections.map((section) => {
        const list = appsBySection.get(section.id) || [];
        const isCollapsed = effectiveCollapsed(section.id);
        return (
          <div key={section.id} className="space-y-2">
            <SectionHeader
              id={section.id}
              name={section.name}
              count={list.length}
              collapsed={isCollapsed}
              onToggle={() => toggleCollapse(section.id)}
            />
            {!isCollapsed && (
              <div id={`section-${section.id}`}>
                <DroppableSection id={section.id} enabled={canDrag}>
                  {list.length === 0 ? (
                    <div className="text-xs text-muted-foreground border border-dashed rounded-md p-4 text-center">
                      {canDrag ? "Drop apps here" : "No apps in this section."}
                    </div>
                  ) : (
                    <AppGrid
                      apps={list}
                      viewType={viewType}
                      favorites={favorites}
                      onToggleFavorite={toggleFavorite}
                      sortable={canDrag}
                      showDragHandle={canDrag}
                    />
                  )}
                </DroppableSection>
              </div>
            )}
          </div>
        );
      })}

      {unsortedApps.length > 0 && (
        <div className="space-y-2">
          <SectionHeader
            id={UNSORTED_ID}
            name="Unsorted"
            count={unsortedApps.length}
            collapsed={effectiveCollapsed(UNSORTED_ID)}
            onToggle={() => toggleCollapse(UNSORTED_ID)}
          />
          {!effectiveCollapsed(UNSORTED_ID) && (
            <div id={`section-${UNSORTED_ID}`}>
              <DroppableSection id={UNSORTED_ID} enabled={canDrag}>
                <AppGrid
                  apps={unsortedApps}
                  viewType={viewType}
                  favorites={favorites}
                  onToggleFavorite={toggleFavorite}
                  sortable={canDrag}
                  showDragHandle={canDrag}
                />
              </DroppableSection>
            </div>
          )}
        </div>
      )}

      {workingApps.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No applications available.
        </div>
      )}

      {workingApps.length > 0 &&
        filteredApps.length === 0 &&
        favoriteApps.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No applications match your search.
          </div>
        )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search applications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          <Select value={sort} onValueChange={changeSort}>
            <SelectTrigger size="sm" className="w-[150px]" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          className="inline-flex rounded-md border p-0.5 self-start sm:self-auto"
          role="group"
          aria-label="View type"
        >
          <Button
            type="button"
            size="sm"
            variant={viewType === "cards" ? "secondary" : "ghost"}
            onClick={() => changeViewType("cards")}
            aria-pressed={viewType === "cards"}
            aria-label="Card view"
            className="h-7 px-2"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewType === "list" ? "secondary" : "ghost"}
            onClick={() => changeViewType("list")}
            aria-pressed={viewType === "list"}
            aria-label="List view"
            className="h-7 px-2"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {canDrag ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {content}
          <DragOverlay>
            {activeApp ? (
              viewType === "list" ? (
                <AppListRow app={activeApp} showDragHandle={false} />
              ) : (
                <AppCard app={activeApp} showDragHandle={false} />
              )
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        content
      )}

      {sortedLinks.length > 0 && (
        <>
          <hr className="border-border" />
          <ImportantLinks links={sortedLinks} sortable={canDrag} onReordered={handleLinksReordered} />
        </>
      )}
    </div>
  );
}
