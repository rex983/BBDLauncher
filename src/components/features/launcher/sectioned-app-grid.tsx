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
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Input } from "@/components/ui/input";
import { SortableAppCard } from "./sortable-app-card";
import { AppCard } from "./app-card";
import { Search, ChevronDown, ChevronRight, Star } from "lucide-react";
import type { LauncherApp, LauncherSection } from "@/types/app";

interface SectionedAppGridProps {
  apps: LauncherApp[];
  sections: LauncherSection[];
  isAdmin: boolean;
}

const FAVORITES_KEY = "bbd-favorites";
const COLLAPSE_KEY = "bbd-section-collapse";
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
  localStorage.setItem(key, JSON.stringify(value));
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

export function SectionedAppGrid({ apps, sections, isAdmin }: SectionedAppGridProps) {
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Admin-only local working copy of apps so drag-drop feels instant.
  const [workingApps, setWorkingApps] = useState<LauncherApp[]>(apps);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  useEffect(() => {
    setFavorites(readJSON<string[]>(FAVORITES_KEY, []));
    setCollapsed(readJSON<Record<string, boolean>>(COLLAPSE_KEY, {}));
  }, []);

  useEffect(() => {
    setWorkingApps(apps);
  }, [apps]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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

  // Group by section_id.
  const appsBySection = useMemo(() => {
    const map = new Map<string | null, LauncherApp[]>();
    for (const app of filteredApps) {
      const key = app.section_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(app);
    }
    // Ensure deterministic order within a section by display_order.
    for (const list of map.values()) {
      list.sort((a, b) => a.display_order - b.display_order);
    }
    return map;
  }, [filteredApps]);

  const favoriteApps = useMemo(() => {
    const set = new Set(favorites);
    return filteredApps.filter((a) => set.has(a.id));
  }, [filteredApps, favorites]);

  const unsortedApps = appsBySection.get(null) || [];

  const isSearching = search.trim().length > 0;
  const effectiveCollapsed = (id: string) => (isSearching ? false : !!collapsed[id]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // Determine target section: either a section container id or another app id.
    const sectionIds = new Set<string>([
      UNSORTED_ID,
      ...sections.map((s) => s.id),
    ]);

    let targetSectionId: string | null;
    let targetAppId: string | null = null;

    if (sectionIds.has(overId)) {
      targetSectionId = overId === UNSORTED_ID ? null : overId;
    } else {
      // Dropped on another app — adopt that app's section.
      const targetApp = workingApps.find((a) => a.id === overId);
      if (!targetApp) return;
      targetSectionId = targetApp.section_id;
      targetAppId = overId;
    }

    const movingApp = workingApps.find((a) => a.id === activeId);
    if (!movingApp) return;

    // Compute the new ordered list for the target section.
    const targetList = workingApps
      .filter((a) => (a.section_id ?? null) === targetSectionId && a.id !== activeId)
      .sort((a, b) => a.display_order - b.display_order);

    let insertIndex = targetList.length;
    if (targetAppId) {
      const idx = targetList.findIndex((a) => a.id === targetAppId);
      if (idx >= 0) insertIndex = idx;
    }

    // If moving within the same section, use arrayMove for natural reorder.
    const sameSection = (movingApp.section_id ?? null) === targetSectionId;
    let nextTargetOrder: LauncherApp[];
    if (sameSection && targetAppId) {
      const original = workingApps
        .filter((a) => (a.section_id ?? null) === targetSectionId)
        .sort((a, b) => a.display_order - b.display_order);
      const oldIndex = original.findIndex((a) => a.id === activeId);
      const newIndex = original.findIndex((a) => a.id === targetAppId);
      nextTargetOrder = arrayMove(original, oldIndex, newIndex);
    } else {
      const moved = { ...movingApp, section_id: targetSectionId };
      nextTargetOrder = [
        ...targetList.slice(0, insertIndex),
        moved,
        ...targetList.slice(insertIndex),
      ];
    }

    // Build the updates: reassign section + reindex display_order for the target section.
    const updates = nextTargetOrder.map((a, idx) => ({
      id: a.id,
      section_id: targetSectionId,
      display_order: idx,
    }));

    // Optimistic update; revert if the server rejects.
    const previous = workingApps;
    setWorkingApps((prev) => {
      const byId = new Map(prev.map((a) => [a.id, a]));
      for (const u of updates) {
        const existing = byId.get(u.id);
        if (existing) {
          byId.set(u.id, {
            ...existing,
            section_id: u.section_id,
            display_order: u.display_order,
          });
        }
      }
      return Array.from(byId.values());
    });

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

  const renderGrid = (list: LauncherApp[], sortable: boolean) => (
    <SortableContext
      items={list.map((a) => a.id)}
      strategy={rectSortingStrategy}
    >
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {list.map((app) => (
          <SortableAppCard
            key={app.id}
            app={app}
            isFavorite={favorites.includes(app.id)}
            onToggleFavorite={toggleFavorite}
            sortable={sortable}
          />
        ))}
      </div>
    </SortableContext>
  );

  const content = (
    <div className="space-y-6">
      {/* Favorites — always pinned at the top */}
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
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {favoriteApps.map((app) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    isFavorite
                    onToggleFavorite={toggleFavorite}
                    showDragHandle={false}
                  />
                ))}
              </div>
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
                <DroppableSection id={section.id} enabled={isAdmin}>
                  {list.length === 0 ? (
                    <div className="text-xs text-muted-foreground border border-dashed rounded-md p-4 text-center">
                      {isAdmin
                        ? "Drop apps here"
                        : "No apps in this section."}
                    </div>
                  ) : (
                    renderGrid(list, isAdmin)
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
              <DroppableSection id={UNSORTED_ID} enabled={isAdmin}>
                {renderGrid(unsortedApps, isAdmin)}
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
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search applications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {isAdmin ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {content}
          <DragOverlay>
            {activeApp ? (
              <AppCard app={activeApp} showDragHandle={false} />
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        content
      )}
    </div>
  );
}
