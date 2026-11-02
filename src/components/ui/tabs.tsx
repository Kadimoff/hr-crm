"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root> & {
  /**
   * Seçilmiş tab URL-də saxlanılır (?<urlParam>=…, history.replaceState — server sorğusu yoxdur):
   * yeniləmədə, «geri» ilə qayıdanda və paylaşılan linkdə eyni tab açılır.
   */
  urlParam?: string;
};

export function Tabs({ urlParam, ...props }: TabsProps) {
  if (!urlParam) return <TabsPrimitive.Root {...props} />;
  return <UrlTabs urlParam={urlParam} {...props} />;
}

function UrlTabs({ urlParam, defaultValue, onValueChange, ...props }: TabsProps & { urlParam: string }) {
  const [value, setValue] = useState(defaultValue);
  const root = useRef<HTMLDivElement>(null);
  // «Geri» ilə qayıdanda Next.js səhifəni keşdən (köhnə ?tab ilə) bərpa edir — həqiqi dəyər ünvan sətrindədir
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(urlParam);
    const exists = fromUrl && [...(root.current?.querySelectorAll("[role=tab]") ?? [])].some((t) => t.id.endsWith(`-trigger-${fromUrl}`));
    if (exists) setValue(fromUrl);
  }, [urlParam]);
  return (
    <TabsPrimitive.Root
      ref={root}
      {...props}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onValueChange?.(v);
        const url = new URL(window.location.href);
        url.searchParams.set(urlParam, v);
        // null — Next.js öz vəziyyətini köçürür və useSearchParams yenilənir
        window.history.replaceState(null, "", url);
      }}
    />
  );
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex h-10 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-4 outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0", className)} {...props} />;
}
