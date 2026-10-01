import { closestCenter, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

// Drag ids are prefixed so sections and tasks can share one DndContext.
export const sid = (id: string) => `s:${id}`;
export const iid = (id: string) => `i:${id}`;
export const raw = (dragId: string | number) => String(dragId).slice(2);
export const isSection = (dragId: string | number) => String(dragId).startsWith("s:");

// Sections only collide with sections. Tasks prefer the task under the
// pointer, then the section under it (so empty sections accept drops).
export const sectionsAndTasksCollision: CollisionDetection = (args) => {
  if (isSection(args.active.id)) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => isSection(c.id)),
    });
  }
  const tasks = args.droppableContainers.filter((c) => !isSection(c.id));
  const overTask = pointerWithin({ ...args, droppableContainers: tasks });
  if (overTask.length) return overTask;
  const overSection = pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => isSection(c.id)),
  });
  if (overSection.length) return overSection;
  return closestCenter({ ...args, droppableContainers: tasks });
};

/**
 * Moves a dragged task into another section while dragging (so the list
 * opens up under the pointer). `sectionOf` reads a task's section key.
 * Returns null when nothing changes.
 */
export function moveAcrossSections<T extends { id: string }>(
  list: T[],
  activeId: string | number,
  overId: string | number,
  sectionOf: (t: T) => string,
  withSection: (t: T, section: string) => T,
): T[] | null {
  const taskId = raw(activeId);
  const current = list.find((t) => t.id === taskId);
  const overTask = isSection(overId) ? undefined : list.find((t) => t.id === raw(overId));
  const target = isSection(overId) ? raw(overId) : overTask && sectionOf(overTask);
  if (!current || !target || sectionOf(current) === target) return null;
  const moving = withSection(current, target);
  const rest = list.filter((t) => t.id !== taskId);
  const at = isSection(overId) ? -1 : rest.findIndex((t) => t.id === raw(overId));
  if (at < 0) return [...rest, moving];
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}
