import React from "react";
import type { ReactNode } from "react";

export function SectionHeader({ title, right, className = "" }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return <div className={`section-h ${className}`.trim()}>
    {title}
    {right !== undefined ? <span className="sh-r">{right}</span> : null}
  </div>;
}
