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
import { SortableAppCard } from "./sortable-app-card";
import { Search } from "lucide-react";
import type { LauncherApp } from "@/types/app";

interface AppGridProps {
  apps: LauncherApp[];
}

const STORAGE_KEY = "bbd-app-order";

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

function applyStoredOrder(apps: LauncherApp[]): LauncherApp[] {
  const storedOrder = getStoredOrder();
  if (!storedOrder) return apps;

  const appMap = new Map(apps.map((a) => [a.id, a]));
  const ordered: LauncherApp[] = [];

  // Add apps in stored order
  for (const id of storedOrder) {
    const app = appMap.get(id);
    if (app) {
      ordered.push(app);
      appMap.delete(id);
    }
  }

  // Append any new apps not in stored order
  for (const app of appMap.values()) {
    ordered.push(app);
  }

  return ordered;
}

export function AppGrid({ apps }: AppGridProps) {
  const [search, setSearch] = useState("");
  const [orderedApps, setOrderedApps] = useState<LauncherApp[]>(apps);

  useEffect(() => {
    setOrderedApps(applyStoredOrder(apps));
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

    setOrderedApps((prev) => {
      const oldIndex = prev.findIndex((a) => a.id === active.id);
      const newIndex = prev.findIndex((a) => a.id === over.id);
      const newOrder = arrayMove(prev, oldIndex, newIndex);
      storeOrder(newOrder.map((a) => a.id));
      return newOrder;
    });
  };

  const filtered = search
    ? orderedApps.filter(
        (app) =>
          app.name.toLowerCase().includes(search.toLowerCase()) ||
          app.description?.toLowerCase().includes(search.toLowerCase())
      )
    : orderedApps;

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search applications..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search ? "No applications match your search." : "No applications available."}
        </div>
      ) : (
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
      )}
    </div>
  );
}
