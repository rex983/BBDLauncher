// Shown in the main area the moment a link is clicked, while the next page
// renders on the server. Without it the old page sat frozen until the new
// one was fully loaded, which felt like lag.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="h-4 w-80 max-w-full rounded-md bg-muted" />
      <div className="h-64 rounded-xl bg-muted/60" />
    </div>
  );
}
