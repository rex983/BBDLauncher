"use client";

import {
  SortableContext,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableAppCard } from "./sortable-app-card";
import { AppCard } from "./app-card";
import { SortableAppListRow } from "./sortable-app-list-row";
import { AppListRow } from "./app-list-row";
import type { LauncherApp } from "@/types/app";

export type ViewType = "cards" | "list";

interface AppGridProps {
  apps: LauncherApp[];
  viewType: ViewType;
  favorites: string[];
  onToggleFavorite: (appId: string) => void;
  // `sortable=false` and `showDragHandle=false` render plain (non-sortable)
  // items — used for the favorites section and non-admin views.
  sortable?: boolean;
  showDragHandle?: boolean;
}

// Renders a group of apps in either card or list mode. Wraps items in a
// SortableContext when `sortable` is true, otherwise renders plain items.
export function AppGrid({
  apps,
  viewType,
  favorites,
  onToggleFavorite,
  sortable = false,
  showDragHandle = true,
}: AppGridProps) {
  const isList = viewType === "list";
  const listWrap = isList
    ? "flex flex-col gap-1.5"
    : "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3";

  if (sortable) {
    return (
      <SortableContext
        items={apps.map((a) => a.id)}
        strategy={isList ? verticalListSortingStrategy : rectSortingStrategy}
      >
        <div className={listWrap}>
          {apps.map((app) =>
            isList ? (
              <SortableAppListRow
                key={app.id}
                app={app}
                isFavorite={favorites.includes(app.id)}
                onToggleFavorite={onToggleFavorite}
                sortable={sortable}
              />
            ) : (
              <SortableAppCard
                key={app.id}
                app={app}
                isFavorite={favorites.includes(app.id)}
                onToggleFavorite={onToggleFavorite}
                sortable={sortable}
              />
            ),
          )}
        </div>
      </SortableContext>
    );
  }

  return (
    <div className={listWrap}>
      {apps.map((app) =>
        isList ? (
          <AppListRow
            key={app.id}
            app={app}
            isFavorite={favorites.includes(app.id)}
            onToggleFavorite={onToggleFavorite}
            showDragHandle={showDragHandle}
          />
        ) : (
          <AppCard
            key={app.id}
            app={app}
            isFavorite={favorites.includes(app.id)}
            onToggleFavorite={onToggleFavorite}
            showDragHandle={showDragHandle}
          />
        ),
      )}
    </div>
  );
}
