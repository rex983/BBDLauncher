"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AppCard } from "./app-card";
import type { LauncherApp } from "@/types/app";

interface SortableAppCardProps {
  app: LauncherApp;
}

export function SortableAppCard({ app }: SortableAppCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: app.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <AppCard
      ref={setNodeRef}
      app={app}
      isDragging={isDragging}
      dragHandleProps={{ ...attributes, ...listeners }}
      style={style}
    />
  );
}
