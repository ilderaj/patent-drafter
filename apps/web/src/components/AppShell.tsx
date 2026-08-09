import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Folder, ScrollText, Settings } from "lucide-react";
import { useStore } from "../lib/store";
import { fetchStatus, getProviderMode } from "../lib/bridge";
import { Button } from "./ui";

const NAV = [
  { to: "/projects", icon: <Folder size={15} />, label: "项目" },
  { to: "/rules", icon: <ScrollText size={15} />, label: "规则与规范" },
  { to: "/settings", icon: <Settings size={15} />, label: "模型与隐私" },
];

export function AppShell() {
  const { bridgeMode, setBridgeMode } = useStore();
  const navigate = useNavigate();

  useEffect(() => {
    void fetchStatus().then((s) => {
      setBridgeMode(s.bridgeConnected && s.authenticated ? "connected" : s.bridgeConnected ? "pairing" : "none");
    });
  }, [setBridgeMode]);

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
            getProviderMode() === "cloud" ? (
              "云端已解锁"
            ) : (
              "本机 Bridge 已连接"
            )
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBridgeMode("pairing");
                navigate(getProviderMode() === "cloud" ? "/unlock" : "/pairing");
              }}
            >
              {getProviderMode() === "cloud" ? "云端未解锁 · 输入密码" : "本机 Bridge 未连接 · 去配对"}
            </Button>
          )}
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
