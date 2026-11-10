import React from "react";
import type { ReactNode } from "react";
import type { StatusTone } from "./Feedback.tsx";

export interface StatItem {
  label: ReactNode;
  value: ReactNode;
  tone?: StatusTone;
}

export function Stat({ label, value, tone }: StatItem) {
  return <div className={`stat${tone ? ` ${tone}` : ""}`}>
    <div className="s-n">{value}</div>
    <div className="s-l">{label}</div>
  </div>;
}

export function StatRow({ items, className = "" }: { items: readonly StatItem[]; className?: string }) {
  return <div className={`statrow ${className}`.trim()}>
    {items.map((item, index) => <Stat key={`${index}-${String(item.label)}`} {...item} />)}
  </div>;
}
