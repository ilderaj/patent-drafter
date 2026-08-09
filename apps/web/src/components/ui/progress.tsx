import * as ProgressPrimitive from "@radix-ui/react-progress";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Progress({ className, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root className={cn("progress-root", className)} {...props}>
      <ProgressPrimitive.Indicator
        className="progress-indicator"
        style={{ transform: `translateX(-${100 - (props.value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
