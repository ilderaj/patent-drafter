import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "btn-default",
      secondary: "btn-secondary",
      outline: "btn-outline",
      ghost: "btn-ghost",
      destructive: "btn-destructive",
      link: "btn-link",
    },
    size: {
      default: "",
      sm: "btn-sm",
      lg: "btn-lg",
      icon: "btn-icon",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
