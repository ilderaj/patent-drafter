import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn("switch-root", className)} {...props}>
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
