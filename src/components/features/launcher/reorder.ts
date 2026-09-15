import { arrayMove } from "@dnd-kit/sortable";
import type { LauncherApp } from "@/types/app";

export interface ReorderUpdate {
  id: string;
  section_id: string | null;
  display_order: number;
}

// Given the current app list, the id being dragged, and the drop target
// (either another app id or a section-container id), returns the DB updates
// needed for the target section. Pure — no state mutation.
//
// Section ids that aren't real UUIDs (like `__unsorted__`) map to null.
// Returns null when the move is a no-op or the input can't be resolved.
export function computeReorderUpdates(params: {
  apps: LauncherApp[];
  activeId: string;
  overId: string;
  sectionContainerIds: Set<string>;
  unsortedId: string;
}): ReorderUpdate[] | null {
  const { apps, activeId, overId, sectionContainerIds, unsortedId } = params;
  if (activeId === overId) return null;

  let targetSectionId: string | null;
  let targetAppId: string | null = null;
  if (sectionContainerIds.has(overId)) {
    targetSectionId = overId === unsortedId ? null : overId;
  } else {
    const targetApp = apps.find((a) => a.id === overId);
    if (!targetApp) return null;
    targetSectionId = targetApp.section_id;
    targetAppId = overId;
  }

  const movingApp = apps.find((a) => a.id === activeId);
  if (!movingApp) return null;

  const targetList = apps
    .filter((a) => (a.section_id ?? null) === targetSectionId && a.id !== activeId)
    .sort((a, b) => a.display_order - b.display_order);

  let insertIndex = targetList.length;
  if (targetAppId) {
    const idx = targetList.findIndex((a) => a.id === targetAppId);
    if (idx >= 0) insertIndex = idx;
  }

  const sameSection = (movingApp.section_id ?? null) === targetSectionId;
  let nextOrder: LauncherApp[];
  if (sameSection && targetAppId) {
    const original = apps
      .filter((a) => (a.section_id ?? null) === targetSectionId)
      .sort((a, b) => a.display_order - b.display_order);
    const oldIndex = original.findIndex((a) => a.id === activeId);
    const newIndex = original.findIndex((a) => a.id === targetAppId);
    nextOrder = arrayMove(original, oldIndex, newIndex);
  } else {
    const moved = { ...movingApp, section_id: targetSectionId };
    nextOrder = [
      ...targetList.slice(0, insertIndex),
      moved,
      ...targetList.slice(insertIndex),
    ];
  }

  return nextOrder.map((a, idx) => ({
    id: a.id,
    section_id: targetSectionId,
    display_order: idx,
  }));
}

// Applies a list of ReorderUpdate to the working app list.
export function applyReorderUpdates(
  apps: LauncherApp[],
  updates: ReorderUpdate[],
): LauncherApp[] {
  const byId = new Map(apps.map((a) => [a.id, a]));
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
}
