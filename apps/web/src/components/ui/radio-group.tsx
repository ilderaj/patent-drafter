import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn("stack-3", className)} {...props} />;
}

export function RadioCardItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item> & { children: ReactNode }) {
  return (
    <RadioGroupPrimitive.Item className={cn("radio-card", className)} {...props}>
      <span className="radio-dot" aria-hidden />
      <span className="grow" style={{ textAlign: "left" }}>
        {children}
      </span>
    </RadioGroupPrimitive.Item>
  );
}
