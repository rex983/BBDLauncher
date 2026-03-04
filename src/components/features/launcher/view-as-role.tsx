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

interface ViewAsRoleProps {
  roles: { name: string; display_name: string }[];
  currentRole: string;
}

export function ViewAsRole({ roles, currentRole }: ViewAsRoleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewAs = searchParams.get("viewAs");

  const handleChange = (value: string) => {
    if (value === currentRole) {
      router.push("/dashboard");
    } else {
      router.push(`/dashboard?viewAs=${value}`);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Eye className="h-4 w-4 text-muted-foreground" />
      <Select value={viewAs || currentRole} onValueChange={handleChange}>
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
