"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye } from "lucide-react";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";

interface ViewAsRoleProps {
  roles: { name: string; display_name: string }[];
  currentRole: string;
}

export function ViewAsRole({ roles, currentRole }: ViewAsRoleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { viewAs: ctxViewAs, setViewAs } = useRolePreview();

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === currentRole) {
      setViewAs(null);
      params.delete("viewAs");
    } else {
      setViewAs(value);
      params.set("viewAs", value);
    }
    const qs = params.toString();
    router.push(qs ? `/dashboard?${qs}` : "/dashboard");
  };

  const current = ctxViewAs || currentRole;

  return (
    <div className="flex items-center gap-2">
      <Eye className="h-4 w-4 text-muted-foreground" />
      <Select value={current} onValueChange={handleChange}>
        <SelectTrigger className="w-[180px] h-8 text-sm">
          <SelectValue placeholder="View as role..." />
        </SelectTrigger>
        <SelectContent>
          {roles.map((role) => (
            <SelectItem key={role.name} value={role.name}>
              {role.display_name}
              {role.name === currentRole && " (you)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
