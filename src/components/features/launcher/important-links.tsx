"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";
import type { ImportantLink } from "@/types/link";

interface ImportantLinksProps {
  links: ImportantLink[];
}

export function ImportantLinks({ links }: ImportantLinksProps) {
  if (links.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Notable Links</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Card className="group transition-all hover:shadow-md hover:border-primary/50 h-full">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="h-8 w-8 flex-shrink-0 flex items-center justify-center">
                  {link.icon_url ? (
                    <img
                      src={link.icon_url}
                      alt={link.name}
                      className="max-h-8 max-w-8 rounded object-contain"
                    />
                  ) : (
                    <ExternalLink className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm group-hover:text-primary transition-colors truncate">
                    {link.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {link.description}
                  </p>
                </div>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}
