"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";
import type { Office } from "@/types/auth";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";

interface ViewAsOfficeProps {
  offices: Office[];
  currentOffice: Office | null;
}

const NONE_VALUE = "__none__";

export function ViewAsOffice({ offices, currentOffice }: ViewAsOfficeProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { viewAsOffice: ctxViewAsOffice, setViewAsOffice } = useRolePreview();

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === NONE_VALUE) {
      setViewAsOffice(null);
      params.delete("viewAsOffice");
    } else {
      setViewAsOffice(value);
      params.set("viewAsOffice", value);
    }
    const qs = params.toString();
    router.push(qs ? `/dashboard?${qs}` : "/dashboard");
  };

  const current = ctxViewAsOffice || NONE_VALUE;

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select value={current} onValueChange={handleChange}>
        <SelectTrigger className="w-[180px] h-8 text-sm">
          <SelectValue placeholder="View as office..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>
            All offices (admin){currentOffice ? "" : " (you)"}
          </SelectItem>
          {offices.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
              {o === currentOffice && " (you)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
