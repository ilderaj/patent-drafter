import React from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./Icon.tsx";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "lg";

export interface ButtonProps {
  children?: ReactNode;
  /** Prototype class suffix; omit for the default bordered button. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Render an icon-only square button (requires `aria-label`). */
  iconOnly?: boolean;
  /** Router link target; renders a Link with the same classes. */
  to?: string;
  disabled?: boolean;
  className?: string;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  title?: string;
  /** Accessible name, required for icon-only buttons. */
  ariaLabel?: string;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  /** Extra attributes for tests (data-testid and friends). */
  [dataAttribute: `data-${string}`]: string | boolean | undefined;
}

export function Button({
  children,
  variant,
  size,
  icon,
  iconOnly = false,
  to,
  disabled,
  className = "",
  type = "button",
  title,
  ariaLabel,
  onClick,
  ...rest
}: ButtonProps) {
  const classes = ["btn", variant ?? "", size ?? "", iconOnly ? "icon" : "", className].filter(Boolean).join(" ");
  const content = <>{icon ? <Icon name={icon} size={size === "sm" ? "sm" : undefined} /> : null}{children}</>;
  if (to !== undefined && !disabled) {
    return <Link to={to} className={classes} title={title} aria-label={ariaLabel} {...rest}>{content}</Link>;
  }
  return <button type={type} className={classes} disabled={disabled} title={title} aria-label={ariaLabel} onClick={onClick} {...rest}>{content}</button>;
}
