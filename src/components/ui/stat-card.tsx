// Label / value / optional sub-line tile. `highlight` flags an alert state
// (e.g. overtime) with a destructive border.
export function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-card p-4 ${
        highlight ? "border-destructive/60 bg-destructive/5" : ""
      }`}
    >
      <div className="text-xs text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="text-lg font-semibold mt-1 truncate" title={value}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
