import React from "react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button.tsx";

export interface SheetProps {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Accessible label for the close control. */
  closeLabel?: string;
}

/** Prototype modal sheet: scrim + sheet header/body/footer. */
export function Sheet({ title, subtitle, children, footer, onClose, wide = false, closeLabel = "关闭" }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    const node = sheetRef.current;
    const focusable = node?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
  }, []);
  return <div className="scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={sheetRef} className={`sheet${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : closeLabel}>
      <div className="sheet-h">
        <div>
          <h2>{title}</h2>
          {subtitle !== undefined ? <div className="sh-sub">{subtitle}</div> : null}
        </div>
        <Button variant="ghost" icon="x" iconOnly className="sheet-x" ariaLabel={closeLabel} onClick={onClose} />
      </div>
      <div className="sheet-b">{children}</div>
      {footer !== undefined ? <div className="sheet-f">{footer}</div> : null}
    </div>
  </div>;
}
