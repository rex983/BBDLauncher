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
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Notable Links</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Card className="group transition-all hover:shadow-md hover:border-primary/50 h-full">
              <CardContent className="flex flex-col items-center gap-1.5 p-3">
                <div className="h-8 w-8 flex-shrink-0 flex items-center justify-center">
                  {link.icon_url ? (
                    <img
                      src={link.icon_url}
                      alt={link.name}
                      className="max-h-8 max-w-8 rounded object-contain"
                    />
                  ) : (
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <p className="font-semibold text-xs group-hover:text-primary transition-colors text-center line-clamp-1">
                  {link.name}
                </p>
                {link.description && (
                  <p className="text-[11px] text-muted-foreground text-center line-clamp-1">
                    {link.description}
                  </p>
                )}
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}
