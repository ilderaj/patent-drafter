import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  size,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "lg";
}) {
  const cls = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "", className]
    .filter(Boolean)
    .join(" ");
  return <button className={cls} {...rest} />;
}

export function Badge({ tone, children }: { tone?: "ok" | "warn" | "err"; children: ReactNode }) {
  return <span className={`badge${tone ? ` badge-${tone}` : ""}`}>{children}</span>;
}

export function Card({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />;
}

export function RadioCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`radio-card${selected ? " selected" : ""}`} onClick={onClick}>
      <span className="radio-dot" />
      <span className="grow" style={{ textAlign: "left" }}>
        {children}
      </span>
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="row-between" style={{ cursor: "pointer", padding: "10px 0" }}>
      <span className="grow" style={{ fontSize: 13 }}>{label}</span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="track" />
        <span className="thumb" />
      </span>
    </label>
  );
}

export function Notice({ icon = "i", children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="notice">
      <span className="ic">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

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

export function EmptyState({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "56px 24px" }}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <h3 style={{ margin: "16px 0 4px", fontWeight: 600 }}>{title}</h3>
      {sub ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{sub}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
