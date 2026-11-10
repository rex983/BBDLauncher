"use client";

import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Installed-app windows (Chrome/Edge "Install app") have no browser toolbar,
// so there's no reload button. Only shown there — a browser tab already has
// one. A full reload, not router.refresh(): it re-runs the server session
// check and the clock gate exactly like opening the launcher fresh.
const INSTALLED_MODES = ["standalone", "minimal-ui", "window-controls-overlay", "fullscreen"];

export function AppRefreshButton() {
  // Decided after mount: the server can't know the display mode, and
  // guessing would mismatch hydration.
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const queries = INSTALLED_MODES.map((m) => window.matchMedia(`(display-mode: ${m})`));
    const update = () => setInstalled(queries.some((q) => q.matches));
    update();
    queries.forEach((q) => q.addEventListener("change", update));
    return () => queries.forEach((q) => q.removeEventListener("change", update));
  }, []);

  if (!installed) return null;
  return (
    <Button variant="ghost" size="icon" onClick={() => window.location.reload()} title="Refresh">
      <RotateCw className="h-5 w-5" />
      <span className="sr-only">Refresh</span>
    </Button>
  );
}
