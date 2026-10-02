import { Badge } from "@/components/ui/badge";

// App vs link marker in the analytics tables.
export function KindBadge({ kind }: { kind: "app" | "link" }) {
  return (
    <Badge variant={kind === "app" ? "default" : "outline"} className="text-[10px]">
      {kind}
    </Badge>
  );
}
