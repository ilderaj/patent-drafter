import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root className={cn("checkbox-root", className)} {...props}>
      <CheckboxPrimitive.Indicator>
        <Check strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
