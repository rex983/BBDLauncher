"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type RolePreview = {
  viewAs: string | null;
  viewAsOffice: string | null;
  setViewAs: (role: string | null) => void;
  setViewAsOffice: (office: string | null) => void;
  exitPreview: () => void;
};

const RolePreviewContext = createContext<RolePreview | null>(null);

export function RolePreviewProvider({ children }: { children: React.ReactNode }) {
  const [viewAs, setViewAsState] = useState<string | null>(null);
  const [viewAsOffice, setViewAsOfficeState] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stripped = useRef(false);

  // First mount = fresh load or refresh. Strip any lingering preview params
  // from the URL so refresh always exits the preview.
  useEffect(() => {
    if (stripped.current) return;
    stripped.current = true;
    if (!searchParams.get("viewAs") && !searchParams.get("viewAsOffice")) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("viewAs");
    next.delete("viewAsOffice");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, router, searchParams]);

  // After the initial strip, keep the URL in sync with context state.
  // If a client-side nav lands on a page whose href dropped the preview
  // params, this effect re-injects them so the destination's server
  // components render under the previewed role. When context is cleared
  // (Exit), any lingering params in the URL are also cleared.
  useEffect(() => {
    if (!stripped.current) return;
    const urlViewAs = searchParams.get("viewAs");
    const urlViewAsOffice = searchParams.get("viewAsOffice");
    const inSync =
      (viewAs ?? null) === (urlViewAs ?? null) &&
      (viewAsOffice ?? null) === (urlViewAsOffice ?? null);
    if (inSync) return;

    const next = new URLSearchParams(searchParams.toString());
    if (viewAs) next.set("viewAs", viewAs);
    else next.delete("viewAs");
    if (viewAsOffice) next.set("viewAsOffice", viewAsOffice);
    else next.delete("viewAsOffice");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [viewAs, viewAsOffice, pathname, searchParams, router]);

  const setViewAs = useCallback((role: string | null) => setViewAsState(role), []);
  const setViewAsOffice = useCallback(
    (office: string | null) => setViewAsOfficeState(office),
    []
  );
  const exitPreview = useCallback(() => {
    setViewAsState(null);
    setViewAsOfficeState(null);
    router.push("/dashboard");
  }, [router]);

  const value = useMemo(
    () => ({ viewAs, viewAsOffice, setViewAs, setViewAsOffice, exitPreview }),
    [viewAs, viewAsOffice, setViewAs, setViewAsOffice, exitPreview]
  );

  return (
    <RolePreviewContext.Provider value={value}>{children}</RolePreviewContext.Provider>
  );
}

export function useRolePreview() {
  const ctx = useContext(RolePreviewContext);
  if (!ctx) throw new Error("useRolePreview must be used within RolePreviewProvider");
  return ctx;
}

export function buildPreviewHref(
  base: string,
  preview: { viewAs: string | null; viewAsOffice: string | null }
): string {
  if (!preview.viewAs && !preview.viewAsOffice) return base;
  const [pathAndSearch, hash] = base.split("#");
  const [path, search] = pathAndSearch.split("?");
  const params = new URLSearchParams(search || "");
  if (preview.viewAs) params.set("viewAs", preview.viewAs);
  if (preview.viewAsOffice) params.set("viewAsOffice", preview.viewAsOffice);
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}
