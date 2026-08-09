import { Info } from "lucide-react";
import type { ReactNode } from "react";

export function Notice({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="notice">
      <span className="ic">{icon ?? <Info size={14} />}</span>
      <span>{children}</span>
    </div>
  );
}
