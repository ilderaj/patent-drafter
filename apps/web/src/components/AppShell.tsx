import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";

const NAV = [
  { to: "/projects", icon: "▦", label: "项目" },
  { to: "/rules", icon: "▤", label: "规则与规范" },
  { to: "/settings", icon: "⚙", label: "模型与隐私" },
];

export function AppShell() {
  const { bridgeMode, setBridgeMode } = useStore();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="mark">专</span>
          专利起草助手
        </div>
        <nav className="side-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="ic">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="bridge-status">
          <span className={`status-dot ${bridgeMode === "connected" ? "ok" : "off"}`} />
          {bridgeMode === "connected" ? (
            "本机 Bridge 已连接"
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setBridgeMode("pairing");
                navigate("/pairing");
              }}
            >
              本机 Bridge 未连接 · 去配对
            </button>
          )}
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
