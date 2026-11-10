"use client";

import { forwardRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, GripVertical } from "lucide-react";
import type { ImportantLink } from "@/types/link";

interface ImportantLinksProps {
  /** Already sorted for display. */
  links: ImportantLink[];
  /** Admins in "Custom order" can drag links around. */
  sortable?: boolean;
  /** Called with the new order after a drop has saved. */
  onReordered?: (links: ImportantLink[]) => void;
}

interface LinkCardProps {
  link: ImportantLink;
  isDragging?: boolean;
  dragHandleProps?: Record<string, unknown>;
  style?: React.CSSProperties;
  showDragHandle?: boolean;
}

const LinkCard = forwardRef<HTMLDivElement, LinkCardProps>(function LinkCard(
  { link, isDragging, dragHandleProps, style, showDragHandle = false },
  ref,
) {
  return (
    <div ref={ref} style={style} className={isDragging ? "z-50" : ""}>
      <Card
        className={`group transition-all hover:shadow-md hover:border-primary/50 h-full ${
          isDragging ? "shadow-lg ring-2 ring-primary/30 opacity-90" : ""
        }`}
      >
        <CardContent className="flex flex-col items-center gap-1.5 p-3 h-full relative">
          {showDragHandle && (
            <div
              {...dragHandleProps}
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-40 hover:!opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </div>
          )}
          <a
            href={`/api/links/${link.id}/click`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 flex-1 w-full"
          >
            <div className="h-8 w-8 flex-shrink-0 flex items-center justify-center">
              {link.icon_url ? (
                <img
                  src={link.icon_url}
                  alt={link.name}
                  className="max-h-8 max-w-8 rounded object-contain"
                />
              ) : (
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <p className="font-semibold text-xs group-hover:text-primary transition-colors text-center line-clamp-1">
              {link.name}
            </p>
            {link.description && (
              <p className="text-[11px] text-muted-foreground text-center line-clamp-1">
                {link.description}
              </p>
            )}
          </a>
        </CardContent>
      </Card>
    </div>
  );
});

function SortableLinkCard({ link }: { link: ImportantLink }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: link.id });
  return (
    <LinkCard
      ref={setNodeRef}
      link={link}
      isDragging={isDragging}
      dragHandleProps={{ ...attributes, ...listeners }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      showDragHandle
    />
  );
}

// New display_order values for the dropped order. The viewer may not see
// every link (office / people-only), so the links shown swap the order slots
// they already held and hidden links keep their place. Old rows that share
// a slot (everything at 0) get numbered 0..n instead.
function orderUpdates(before: ImportantLink[], after: ImportantLink[]) {
  const slots = before.map((l) => l.display_order).sort((a, b) => a - b);
  const distinct = new Set(slots).size === slots.length;
  return after.map((l, i) => ({ id: l.id, display_order: distinct ? slots[i] : i }));
}

const GRID = "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3";

export function ImportantLinks({ links, sortable = false, onReordered }: ImportantLinksProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  if (links.length === 0) return null;

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = links.findIndex((l) => l.id === active.id);
    const to = links.findIndex((l) => l.id === over.id);
    if (from < 0 || to < 0) return;

    const moved = arrayMove(links, from, to);
    const updates = orderUpdates(links, moved);
    const orderById = new Map(updates.map((u) => [u.id, u.display_order]));
    const next = moved.map((l) => ({ ...l, display_order: orderById.get(l.id) ?? l.display_order }));
    const previous = links;
    onReordered?.(next);

    try {
      const res = await fetch("/api/links/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error(`reorder ${res.status}`);
    } catch (err) {
      console.error("Link reorder failed:", err);
      onReordered?.(previous);
      alert("Couldn't save the new order — reverted.");
    }
  };

  const activeLink = activeId ? links.find((l) => l.id === activeId) : null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Notable Links</h2>
      {sortable ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={links.map((l) => l.id)} strategy={rectSortingStrategy}>
            <div className={GRID}>
              {links.map((link) => (
                <SortableLinkCard key={link.id} link={link} />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>{activeLink ? <LinkCard link={activeLink} /> : null}</DragOverlay>
        </DndContext>
      ) : (
        <div className={GRID}>
          {links.map((link) => (
            <LinkCard key={link.id} link={link} />
          ))}
        </div>
      )}
    </div>
  );
}
