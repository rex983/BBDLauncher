"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AppCard } from "./app-card";
import type { LauncherApp } from "@/types/app";

interface SortableAppCardProps {
  app: LauncherApp;
  isFavorite?: boolean;
  onToggleFavorite?: (appId: string) => void;
  sortable?: boolean;
}

export function SortableAppCard({
  app,
  isFavorite,
  onToggleFavorite,
  sortable = true,
}: SortableAppCardProps) {
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
    <AppCard
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
