"use client";

import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortableAppCard } from "./sortable-app-card";
import { Search, ArrowUpDown } from "lucide-react";
import type { LauncherApp } from "@/types/app";

type SortOption = "custom" | "name-asc" | "name-desc" | "recent" | "sso-type";

interface AppGridProps {
  apps: LauncherApp[];
}

const STORAGE_KEY = "bbd-app-order";
const SORT_KEY = "bbd-app-sort";

function getStoredOrder(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function storeOrder(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function getStoredSort(): SortOption {
  if (typeof window === "undefined") return "custom";
  try {
    return (localStorage.getItem(SORT_KEY) as SortOption) || "custom";
  } catch {
    return "custom";
  }
}

function storeSort(sort: SortOption) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SORT_KEY, sort);
}

function applyStoredOrder(apps: LauncherApp[]): LauncherApp[] {
  const storedOrder = getStoredOrder();
  if (!storedOrder) return apps;

  const appMap = new Map(apps.map((a) => [a.id, a]));
  const ordered: LauncherApp[] = [];

  for (const id of storedOrder) {
    const app = appMap.get(id);
    if (app) {
      ordered.push(app);
      appMap.delete(id);
    }
  }

  for (const app of appMap.values()) {
    ordered.push(app);
  }

  return ordered;
}

function sortApps(apps: LauncherApp[], sort: SortOption): LauncherApp[] {
  if (sort === "custom") return apps;
  const sorted = [...apps];
  switch (sort) {
    case "name-asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "name-desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "recent":
      sorted.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      break;
    case "sso-type":
      sorted.sort((a, b) => a.sso_type.localeCompare(b.sso_type));
      break;
  }
  return sorted;
}

export function AppGrid({ apps }: AppGridProps) {
  const [search, setSearch] = useState("");
  const [orderedApps, setOrderedApps] = useState<LauncherApp[]>(apps);
  const [sortBy, setSortBy] = useState<SortOption>("custom");

  useEffect(() => {
    setOrderedApps(applyStoredOrder(apps));
    setSortBy(getStoredSort());
  }, [apps]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Dragging resets sort to custom
    setSortBy("custom");
    storeSort("custom");

    setOrderedApps((prev) => {
      const oldIndex = prev.findIndex((a) => a.id === active.id);
      const newIndex = prev.findIndex((a) => a.id === over.id);
      const newOrder = arrayMove(prev, oldIndex, newIndex);
      storeOrder(newOrder.map((a) => a.id));
      return newOrder;
    });
  };

  const handleSortChange = (value: SortOption) => {
    setSortBy(value);
    storeSort(value);
  };

  const sorted = sortApps(orderedApps, sortBy);
  const filtered = search
    ? sorted.filter(
        (app) =>
          app.name.toLowerCase().includes(search.toLowerCase()) ||
          app.description?.toLowerCase().includes(search.toLowerCase())
      )
    : sorted;

  const isDragEnabled = sortBy === "custom";

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
        <Select value={sortBy} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[180px]">
            <ArrowUpDown className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Order by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom">Custom (drag)</SelectItem>
            <SelectItem value="name-asc">Name A-Z</SelectItem>
            <SelectItem value="name-desc">Name Z-A</SelectItem>
            <SelectItem value="recent">Recently updated</SelectItem>
            <SelectItem value="sso-type">SSO type</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search ? "No applications match your search." : "No applications available."}
        </div>
      ) : isDragEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={filtered.map((a) => a.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filtered.map((app) => (
                <SortableAppCard key={app.id} app={app} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((app) => (
            <SortableAppCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </div>
  );
}
