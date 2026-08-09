import type { ReactNode } from "react";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}
