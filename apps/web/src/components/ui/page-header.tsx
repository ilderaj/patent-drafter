import type { ReactNode } from "react";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="page-header row-between" style={{ marginBottom: 24 }}>
      <div>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}
