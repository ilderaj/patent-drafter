import React from "react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LocalRepository, MatterRecord } from "../lib/repository.ts";
import { LOCAL_ACTOR, GLOBAL_NAV, RUNTIME_LABELS, listMatterView, v6Path, type GlobalKey, type Runtime } from "../routes/navigation.ts";
import { loadInbox } from "../features/inbox/inbox.ts";
import { Icon, type IconName } from "./ui/Icon.tsx";

export interface ShellProps {
  runtime: Runtime;
  /** The global section the current page belongs to; null on the start page. */
  active: GlobalKey | null;
  children: ReactNode;
  mode?: "professional" | "public" | "self_service";
  matterId?: string;
  repository?: LocalRepository;
}

export function Shell({ runtime, active, children, mode = "professional", matterId, repository }: ShellProps) {
  if (mode !== "professional") {
    return (
      <div className={`v6-shell v6-simple-shell v6-simple-shell-${mode}`}>
        <main className="v6-simple-main">{children}</main>
      </div>
    );
  }

  return <ProfessionalShell runtime={runtime} active={active} matterId={matterId} repository={repository}>{children}</ProfessionalShell>;
}

interface SidebarCounts {
  inbox: number | null;
  matters: number | null;
}

const NAV_ICONS: Readonly<Record<string, IconName>> = Object.freeze({
  inbox: "inbox",
  matters: "folder",
  filings: "send",
  activity: "pulse",
  services: "users",
  ai: "spark",
  billing: "card",
  settings: "gear",
});

const NAV_LABELS: Readonly<Record<string, string>> = Object.freeze({
  inbox: "收件箱",
  matters: "案件",
  filings: "申请",
  activity: "动态",
  services: "专家服务",
  ai: "AI 与数据",
  billing: "套餐与账单",
  settings: "设置",
});

function isEmptyCount(value: number | null): value is null {
  return value === null;
}

function ProfessionalShell({ runtime, active, matterId, children, repository }: {
  runtime: Runtime;
  active: GlobalKey | null;
  matterId?: string;
  children: ReactNode;
  repository?: LocalRepository;
}) {
  const [search, setSearch] = useState("");
  const [matters, setMatters] = useState<readonly MatterRecord[]>([]);
  const [counts, setCounts] = useState<SidebarCounts>({ inbox: null, matters: null });

  useEffect(() => {
    let live = true;
    if (!repository) {
      setMatters([]);
      setCounts({ inbox: null, matters: null });
      return () => { live = false; };
    }
    void listMatterView(repository, LOCAL_ACTOR).then((result) => {
      if (!live) return;
      const items = result.state === "ready" ? result.matters : [];
      setMatters(items);
      setCounts((current) => ({
        ...current,
        matters: items.filter((matter) => matter.status === "active").length,
      }));
    });
    void loadInbox(repository, LOCAL_ACTOR).then((result) => {
      if (!live || !result.ok) return;
      setCounts((current) => ({ ...current, inbox: result.data.items.filter((item) => item.state === "open").length }));
    }).catch(() => {});
    return () => { live = false; };
  }, [repository]);

  const query = search.trim().toLocaleLowerCase("zh-CN");
  const activeMatters = useMemo(() => matters
    .filter((matter) => matter.status !== "deletion_pending")
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)), [matters]);
  const matchingMatters = useMemo(() => activeMatters
    .filter((matter) => query.length === 0 || matter.title.toLocaleLowerCase("zh-CN").includes(query))
    .slice(0, query.length > 0 ? 8 : 3), [activeMatters, query]);
  const navItems = useMemo(() => {
    const byKey = new Map(GLOBAL_NAV.map((item) => [item.key, item]));
    return (["inbox", "matters", "filings", "activity"] as const).map((key) => byKey.get(key)!).filter(Boolean);
  }, []);
  const bottomItems = useMemo(() => (["services", "ai", "billing", "settings"] as const)
    .map((key) => GLOBAL_NAV.find((item) => item.key === key)!)
    .filter(Boolean), []);
  const navMatches = useMemo(() => {
    if (query.length === 0) return null;
    return GLOBAL_NAV.filter((item) => NAV_LABELS[item.key]?.toLocaleLowerCase("zh-CN").includes(query));
  }, [query]);

  return (
    <div className="app-shell v6-shell">
      <aside className="sidebar" aria-label="专业工作台导航">
        <label className="sb-search">
          <Icon name="search" size="sm" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="搜索案件标题"
            aria-label="搜索案件标题"
          />
        </label>

        <nav aria-label="全局导航">
          {navItems.map((item) => {
            const to = item.key === "matters" ? v6Path({ kind: "matters" }) : v6Path({ kind: "section", key: item.key });
            const count = item.key === "inbox" ? counts.inbox : item.key === "matters" ? counts.matters : null;
            return <Link key={item.key} to={to}
              className={`sb-item${item.key === active ? " sel" : ""}`}
              aria-current={item.key === active ? "page" : undefined}
              title={item.capability.reason ?? undefined}>
              <Icon name={NAV_ICONS[item.key] ?? "doc"} />
              <span>{NAV_LABELS[item.key] ?? item.label}</span>
              {!isEmptyCount(count) ? <span className="count" data-testid={`sidebar-count-${item.key}`}>{count}</span> : null}
            </Link>;
          })}
        </nav>

        {navMatches === null || navMatches.length > 0 || matchingMatters.length > 0 ? (
          <>
            <div className="sb-label">{query.length > 0 ? "搜索结果" : "最近案件"}</div>
            {navMatches?.map((item) => <Link key={`nav-${item.key}`} to={item.key === "matters" ? v6Path({ kind: "matters" }) : v6Path({ kind: "section", key: item.key })} className="sb-item">
              <Icon name={NAV_ICONS[item.key] ?? "doc"} /><span>{NAV_LABELS[item.key] ?? item.label}</span>
            </Link>)}
            {matchingMatters.map((matter) => <Link key={matter.id}
              to={v6Path({ kind: "matter", matterId: matter.id, targetId: null, tab: "overview" })}
              className={`sb-item sb-sub${matter.id === matterId ? " sel" : ""}`}
              aria-current={matter.id === matterId ? "page" : undefined}
              title={matter.title}>{matter.title}</Link>)}
            {query.length > 0 && (navMatches?.length ?? 0) === 0 && matchingMatters.length === 0 ? <div className="sb-empty">没有匹配的案件或页面。</div> : null}
          </>
        ) : null}

        <div className="sb-spacer" />
        <nav aria-label="账户与工具">
          {bottomItems.map((item) => <Link key={item.key} to={v6Path({ kind: "section", key: item.key as Exclude<GlobalKey, "matters"> })}
            className={`sb-item${item.key === active ? " sel" : ""}`}
            aria-current={item.key === active ? "page" : undefined}
            title={item.capability.reason ?? undefined}>
            <Icon name={NAV_ICONS[item.key] ?? "doc"} />
            <span>{NAV_LABELS[item.key] ?? item.label}</span>
          </Link>)}
        </nav>
        <div className="sb-user">
          <span className="avatar" aria-hidden="true">本</span>
          <div>
            <div className="u-name">本机用户</div>
            <div className="u-plan" data-testid="runtime-label">{RUNTIME_LABELS[runtime]}</div>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
