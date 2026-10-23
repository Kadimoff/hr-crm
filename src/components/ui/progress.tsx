"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Progress({ className, value, indicatorClassName, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} value={value} {...props}>
      <ProgressPrimitive.Indicator
        className={cn("h-full w-full flex-1 bg-primary transition-transform duration-500 ease-out", indicatorClassName)}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
