import React from "react";
import type { ReactNode } from "react";

export interface PaneProps {
  children: ReactNode;
  /** Prototype widths: default 980px, narrow 720px, wide (preview) 1120px. */
  width?: "default" | "narrow" | "wide";
  className?: string;
}

export function Pane({ children, width = "default", className = "" }: PaneProps) {
  const suffix = width === "narrow" ? " narrow" : width === "wide" ? " wide" : "";
  return <div className={`pane${suffix} ${className}`.trim()}>{children}</div>;
}

export interface BodyProps {
  children: ReactNode;
  /** `flush` removes padding for document/draft panes. */
  flush?: boolean;
  center?: boolean;
  className?: string;
}

export function Body({ children, flush = false, center = false, className = "" }: BodyProps) {
  return <div className={`body${flush ? " flush" : ""}${center ? " center" : ""} ${className}`.trim()}>{children}</div>;
}
