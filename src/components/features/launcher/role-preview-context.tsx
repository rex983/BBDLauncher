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

// The person an admin is previewing the launcher as.
export interface PreviewUser {
  id: string;
  name: string;
  role: string;
  role_label: string;
  office: string | null;
  department: string | null;
  can_offboard: boolean;
}

type RolePreview = {
  viewAsUser: PreviewUser | null;
  // The previewed person's role and office, for components that only care
  // about those.
  viewAs: string | null;
  viewAsOffice: string | null;
  setViewAsUser: (user: PreviewUser | null) => void;
  exitPreview: () => void;
};

const PARAM = "viewAsUser";
const RolePreviewContext = createContext<RolePreview | null>(null);

export function RolePreviewProvider({ children }: { children: React.ReactNode }) {
  const [viewAsUser, setViewAsUser] = useState<PreviewUser | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stripped = useRef(false);

  // First mount = fresh load or refresh. Strip any lingering preview param
  // from the URL so refresh always exits the preview.
  useEffect(() => {
    if (stripped.current) return;
    stripped.current = true;
    if (!searchParams.get(PARAM)) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete(PARAM);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, router, searchParams]);

  // After the initial strip, keep the URL in sync with context state. If a
  // client-side nav lands on a page whose href dropped the param, this
  // re-injects it so the destination's server components render as the
  // previewed person. When context is cleared (Exit), the param goes too.
  useEffect(() => {
    if (!stripped.current) return;
    const want = viewAsUser?.id ?? null;
    if (want === searchParams.get(PARAM)) return;
    const next = new URLSearchParams(searchParams.toString());
    if (want) next.set(PARAM, want);
    else next.delete(PARAM);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [viewAsUser, pathname, searchParams, router]);

  const exitPreview = useCallback(() => {
    setViewAsUser(null);
    router.push("/dashboard");
  }, [router]);

  const value = useMemo(
    () => ({
      viewAsUser,
      viewAs: viewAsUser?.role ?? null,
      viewAsOffice: viewAsUser?.office ?? null,
      setViewAsUser,
      exitPreview,
    }),
    [viewAsUser, exitPreview],
  );

  return <RolePreviewContext.Provider value={value}>{children}</RolePreviewContext.Provider>;
}

export function useRolePreview() {
  const ctx = useContext(RolePreviewContext);
  if (!ctx) throw new Error("useRolePreview must be used within RolePreviewProvider");
  return ctx;
}

export function buildPreviewHref(base: string, viewAsUser: PreviewUser | null): string {
  if (!viewAsUser) return base;
  const [pathAndSearch, hash] = base.split("#");
  const [path, search] = pathAndSearch.split("?");
  const params = new URLSearchParams(search || "");
  params.set(PARAM, viewAsUser.id);
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}
