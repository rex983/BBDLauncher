"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AppCard } from "./app-card";
import { AppListRow } from "./app-list-row";
import type { LauncherApp } from "@/types/app";

interface SortableAppItemProps {
  app: LauncherApp;
  // Grid tile or list row — both take the same drag/favorite props.
  as: typeof AppCard | typeof AppListRow;
  isFavorite?: boolean;
  onToggleFavorite?: (appId: string) => void;
}

export function SortableAppItem({
  app,
  as: Item,
  isFavorite,
  onToggleFavorite,
}: SortableAppItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: app.id });

  return (
    <Item
      ref={setNodeRef}
      app={app}
      isDragging={isDragging}
      dragHandleProps={{ ...attributes, ...listeners }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
    />
  );
}
