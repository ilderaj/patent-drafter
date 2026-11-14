import React from "react";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export type CalloutTone = "info" | "warn" | "ok" | "risk";
export type TagTone = "ok" | "warn" | "risk" | "ai" | "pro" | "plain";
export type StatusTone = "ok" | "warn" | "risk" | "idle" | "ai";

const STATUS_SHAPES: Readonly<Record<StatusTone, string>> = Object.freeze({
  ok: "●",
  warn: "○",
  risk: "▲",
  idle: "–",
  ai: "◇",
});

export function Callout({ tone = "info", icon, children, className = "", testId }: {
  tone?: CalloutTone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return <div className={`callout ${tone} ${className}`.trim()} data-testid={testId}>
    {icon ? <Icon name={icon} /> : null}
    <div>{children}</div>
  </div>;
}

export function Tag({ tone, children, className = "" }: { tone?: TagTone; children: ReactNode; className?: string }) {
  return <span className={`tag ${tone ?? ""} ${className}`.trim()}>{children}</span>;
}

export function StatusShape({ tone, label, className = "" }: { tone: StatusTone; label?: ReactNode; className?: string }) {
  return <span className={`stx ${className}`.trim()}>
    <span className={`st st-${tone}`} aria-hidden="true">{STATUS_SHAPES[tone]}</span>
    {label !== undefined ? <span className={`stt-${tone}`}>{label}</span> : null}
  </span>;
}
