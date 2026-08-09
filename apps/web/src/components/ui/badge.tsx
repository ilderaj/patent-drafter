import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const badgeVariants = cva("badge", {
  variants: {
    variant: {
      default: "badge-secondary",
      secondary: "badge-secondary",
      outline: "badge-outline",
      ok: "badge-ok",
      warn: "badge-warn",
      err: "badge-err",
    },
  },
  defaultVariants: { variant: "default" },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & {
  /** 兼容旧调用：tone 映射到 variant */
  tone?: "ok" | "warn" | "err";
};

export function Badge({ className, variant, tone, ...props }: BadgeProps) {
  const resolved: BadgeProps["variant"] = variant ?? (tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "err" ? "err" : "default");
  return <span className={cn(badgeVariants({ variant: resolved }), className)} {...props} />;
}
