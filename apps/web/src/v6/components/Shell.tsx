/**
 * V6-08 — the `/v6` shell: global navigation, runtime label and the switch
 * back to the legacy app. Pages render inside it; it reads nothing from storage.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { GLOBAL_NAV, RUNTIME_LABELS, v6Path, type GlobalKey, type Runtime } from "../routes/navigation.ts";

export interface ShellProps {
  runtime: Runtime;
  /** The global section the current page belongs to; null on the start page. */
  active: GlobalKey | null;
  children: ReactNode;
}

export function Shell({ runtime, active, children }: ShellProps) {
  return (
    <div className="app-shell v6-shell">
      <aside className="sidebar">
        <Link to={v6Path({ kind: "start" })} className="logo">
          <span className="mark">专</span>
          专利起草助手
        </Link>
        <nav className="side-nav" aria-label="全局导航">
          {GLOBAL_NAV.map((item) => {
            const to = item.key === "matters" ? v6Path({ kind: "matters" }) : v6Path({ kind: "section", key: item.key });
            const unavailable = item.capability.state === "unavailable";
            return (
              <Link
                key={item.key}
                to={to}
                className={item.key === active ? "active" : ""}
                aria-current={item.key === active ? "page" : undefined}
                title={item.capability.reason ?? undefined}
              >
                {item.label}
                {unavailable ? <span className="v6-soon">未开放</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="v6-shell-foot">
          <span className="badge badge-outline" data-testid="runtime-label">
            {RUNTIME_LABELS[runtime]}
          </span>
          <Link to="/projects" className="link-button">
            切换到旧版
          </Link>
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
