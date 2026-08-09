import * as SeparatorPrimitive from "@radix-ui/react-separator";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Separator({ className, orientation = "horizontal", ...props }: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(orientation === "horizontal" ? "separator-h" : "separator-v", "separator", className)}
      {...props}
    />
  );
}
