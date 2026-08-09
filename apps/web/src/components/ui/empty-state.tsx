import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ icon, title, sub, action }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "56px 24px" }}>
      <div
        style={{
          width: 48,
          height: 48,
          margin: "0 auto",
          borderRadius: 14,
          background: "var(--accent)",
          color: "var(--primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon ?? <Inbox size={22} />}
      </div>
      <h3 className="display" style={{ margin: "18px 0 6px", fontWeight: 600, fontSize: 18 }}>{title}</h3>
      {sub ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{sub}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
