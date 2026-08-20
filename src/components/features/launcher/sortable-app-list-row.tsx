"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AppListRow } from "./app-list-row";
import type { LauncherApp } from "@/types/app";

interface SortableAppListRowProps {
  app: LauncherApp;
  isFavorite?: boolean;
  onToggleFavorite?: (appId: string) => void;
  sortable?: boolean;
}

export function SortableAppListRow({
  app,
  isFavorite,
  onToggleFavorite,
  sortable = true,
}: SortableAppListRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: app.id, disabled: !sortable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <AppListRow
      ref={setNodeRef}
      app={app}
      isDragging={isDragging}
      dragHandleProps={sortable ? { ...attributes, ...listeners } : undefined}
      showDragHandle={sortable}
      style={style}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
    />
  );
}
