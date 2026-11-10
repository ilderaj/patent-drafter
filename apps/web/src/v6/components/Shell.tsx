import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LocalRepository, MatterRecord } from "../lib/repository.ts";
import { LOCAL_ACTOR, GLOBAL_NAV, RUNTIME_LABELS, listMatterView, v6Path, type GlobalKey, type Runtime } from "../routes/navigation.ts";

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
      <div className={`v6-simple-shell v6-simple-shell-${mode}`}>
        <header className="v6-simple-header">
          <Link to={v6Path({ kind: "start" })} className="v6-wordmark">
            <span className="v6-wordmark-mark" aria-hidden="true">卷</span>
            <span>卷宗</span>
          </Link>
          <nav className="v6-simple-links" aria-label="页面入口">
            {matterId ? (
              <Link to={v6Path({ kind: "matter", matterId, targetId: null, tab: "overview" })}>
                同一案件的专业工作台
              </Link>
            ) : (
              <Link to={v6Path({ kind: "matters" })}>专业工作台</Link>
            )}
            <span className="badge badge-outline" data-testid="runtime-label">{RUNTIME_LABELS[runtime]}</span>
          </nav>
        </header>
        <main className="v6-simple-main">{children}</main>
      </div>
    );
  }

  return <ProfessionalShell runtime={runtime} active={active} repository={repository}>{children}</ProfessionalShell>;
}

function ProfessionalShell({ runtime, active, children, repository }: { runtime: Runtime; active: GlobalKey | null; children: ReactNode; repository?: LocalRepository }) {
  const [search, setSearch] = useState("");
  const [matters, setMatters] = useState<readonly MatterRecord[]>([]);
  const visibleNavigation = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (!query) return GLOBAL_NAV;
    return GLOBAL_NAV.filter((item) => item.label.toLocaleLowerCase("zh-CN").includes(query));
  }, [search]);
  useEffect(() => {
    let live = true;
    if (!repository) {
      setMatters([]);
      return () => { live = false; };
    }
    void listMatterView(repository, LOCAL_ACTOR).then((result) => {
      if (live) setMatters(result.state === "ready" ? result.matters : []);
    });
    return () => { live = false; };
  }, [repository]);
  const matchingMatters = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return matters.filter((matter) => query.length === 0 || matter.title.toLocaleLowerCase("zh-CN").includes(query)).slice(0, 6);
  }, [matters, search]);

  return (
    <div className="app-shell v6-shell">
      <aside className="sidebar">
        <Link to={v6Path({ kind: "start" })} className="logo v6-wordmark">
          <span className="v6-wordmark-mark" aria-hidden="true">卷</span>
          卷宗
        </Link>
        <label className="v6-nav-search">
          <span>搜索导航和案件</span>
          <input
            className="input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="搜索页面或案件名"
            aria-label="搜索导航和案件"
          />
        </label>
        <nav className="side-nav" aria-label="全局导航">
          {visibleNavigation.map((item) => {
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
                {unavailable ? <span className="v6-soon">说明</span> : null}
              </Link>
            );
          })}
        </nav>
        {matchingMatters.length > 0 ? (
          <>
            <p className="field-hint">{search.trim() ? "匹配的案件" : "最近案件"}</p>
            <nav className="side-nav" aria-label="案件快捷入口">
              {matchingMatters.map((matter) => (
                <Link key={matter.id} to={v6Path({ kind: "matter", matterId: matter.id, targetId: null, tab: "overview" })}>
                  {matter.title}
                </Link>
              ))}
            </nav>
          </>
        ) : null}
        {search.trim() && visibleNavigation.length === 0 && matchingMatters.length === 0 ? <p className="field-hint">没有匹配的页面或案件。</p> : null}
        <div className="v6-shell-foot">
          <span className="badge badge-outline" data-testid="runtime-label">{RUNTIME_LABELS[runtime]}</span>
          <Link to={v6Path({ kind: "section", key: "settings" })} className="link-button">设置</Link>
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
