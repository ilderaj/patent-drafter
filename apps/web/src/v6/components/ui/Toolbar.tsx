import React from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon.tsx";

export interface ToolbarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional back link rendered as the prototype ghost icon button. */
  back?: { to: string; label?: string };
  /** Right-aligned actions. */
  right?: ReactNode;
  /** Extra toolbar content between the title block and the actions. */
  children?: ReactNode;
  className?: string;
}

export function Toolbar({ title, subtitle, back, right, children, className = "" }: ToolbarProps) {
  return <header className={`toolbar ${className}`.trim()}>
    {back ? <Link to={back.to} className="btn ghost icon" aria-label={back.label ?? "返回"}><Icon name="chevL" /></Link> : null}
    <div>
      <div className="tb-title">{title}</div>
      {subtitle !== undefined && subtitle !== null ? <div className="tb-sub">{subtitle}</div> : null}
    </div>
    {children}
    <div className="tb-right">{right}</div>
  </header>;
}

export interface TabItem {
  key: string;
  label: ReactNode;
  /** Small dot used by the prototype for pending facts. */
  dot?: boolean;
  /** When set, the tab is a router link instead of a button. */
  to?: string;
  onSelect?: () => void;
}

export interface TabsProps {
  items: readonly TabItem[];
  active: string;
  ariaLabel?: string;
  className?: string;
}

export function Tabs({ items, active, ariaLabel = "标签", className = "" }: TabsProps) {
  return <nav className={`tabs ${className}`.trim()} aria-label={ariaLabel}>
    {items.map((item) => {
      const selected = item.key === active;
      const content = <>{item.label}{item.dot ? <span className="dot" aria-label="有待确认事项" /> : null}</>;
      if (item.to !== undefined) {
        return <Link key={item.key} to={item.to} className={`tab${selected ? " sel" : ""}`}
          aria-current={selected ? "page" : undefined}>{content}</Link>;
      }
      return <button key={item.key} type="button" className={`tab${selected ? " sel" : ""}`}
        aria-current={selected ? "page" : undefined} onClick={item.onSelect}>{content}</button>;
    })}
  </nav>;
}
