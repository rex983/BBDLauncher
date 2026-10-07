"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ItemDraft {
  title: string;
  system: string;
  instructions: string;
}

export const EMPTY_DRAFT: ItemDraft = { title: "", system: "", instructions: "" };

// Task fields shared by the checklist editor and a case's "Add task" dialog.
export function ItemFields({
  draft,
  onChange,
}: {
  draft: ItemDraft;
  onChange: (next: ItemDraft) => void;
}) {
  const set = (patch: Partial<ItemDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="ci-title">Task</Label>
        <Input
          id="ci-title"
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g. Remove from manufacturer portal"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ci-system">Where (optional)</Label>
        <Input
          id="ci-system"
          value={draft.system}
          onChange={(e) => set({ system: e.target.value })}
          placeholder="e.g. Eagle portal"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ci-instructions">Instructions</Label>
        <Textarea
          id="ci-instructions"
          rows={3}
          value={draft.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
        />
      </div>
    </>
  );
}
