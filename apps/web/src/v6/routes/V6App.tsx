/**
 * V6-08 — the `/v6` pages. Every decision about what to show comes from
 * `navigation.ts`; this file only opens the browser repository and renders.
 *
 * The URL is the only page state: a refreshed or shared link reads the matter
 * again and shows the same view. Nothing here writes except the self-service
 * entry, and nothing is filled in with demo content.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell.tsx";
import { openIndexedDbBackend } from "../lib/indexeddb-repository.ts";
import { openLocalRepository, type LocalRepository } from "../lib/repository.ts";
import {
  GLOBAL_NAV,
  LOCAL_ACTOR,
  MATTER_TABS,
  PAGE_ERROR_MESSAGES,
  TAB_CAPABILITIES,
  createSelfServiceMatter,
  listMatterView,
  parseV6Path,
  resolveMatterView,
  v6Path,
  type GlobalKey,
  type MatterListView,
  type MatterTab,
  type MatterView,
  type V6Route,
} from "./navigation.ts";
import "./v6.css";

type RepositoryState =
  | { state: "loading" }
  | { state: "ready"; repository: LocalRepository }
  | { state: "failed" };

/** Open the local database once; `retry` opens it again after a failure. */
function useRepository(): [RepositoryState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState<RepositoryState>({ state: "loading" });
  useEffect(() => {
    let live = true;
    let opened: LocalRepository | null = null;
    setValue({ state: "loading" });
    openIndexedDbBackend().then(
      (backend) => {
        opened = openLocalRepository(backend);
        if (live) setValue({ state: "ready", repository: opened });
        else opened.close();
      },
      () => {
        if (live) setValue({ state: "failed" });
      },
    );
    return () => {
      live = false;
      opened?.close();
    };
  }, [attempt]);
  return [value, useCallback(() => setAttempt((n) => n + 1), [])];
}

function activeSection(route: V6Route): GlobalKey | null {
  switch (route.kind) {
    case "matters":
    case "matter":
    case "upload":
      return "matters";
    case "section":
      return route.key;
    default:
      return null;
  }
}

export default function V6App() {
  const { pathname } = useLocation();
  const route = parseV6Path(pathname);
  const [repo, retry] = useRepository();

  return (
    <Shell runtime="local_web" active={activeSection(route)}>
      {repo.state === "loading" ? (
        <Loading />
      ) : repo.state === "failed" ? (
        <StorageUnavailable message={PAGE_ERROR_MESSAGES.STORAGE_UNAVAILABLE} onRetry={retry} />
      ) : (
        <Page route={route} repository={repo.repository} />
      )}
    </Shell>
  );
}

function Page({ route, repository }: { route: V6Route; repository: LocalRepository }) {
  switch (route.kind) {
    case "start":
      return <StartPage repository={repository} />;
    case "matters":
      return <MattersPage repository={repository} />;
    case "upload":
      return <UploadPage repository={repository} matterId={route.matterId} />;
    case "matter":
      return <MatterPage repository={repository} matterId={route.matterId} targetId={route.targetId} tab={route.tab} />;
    case "section":
      return <SectionPage sectionKey={route.key} />;
    case "not_found":
      return <UnavailablePage />;
  }
}

function Loading() {
  return (
    <div className="v6-page" aria-busy="true">
      <p className="muted">正在读取本机存储…</p>
      <div className="skeleton v6-skeleton" />
    </div>
  );
}

function StorageUnavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="v6-page">
      <div className="notice" role="alert">
        <strong>尚未保存</strong>
        <p>{message}</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>
          重试
        </button>
      </div>
    </div>
  );
}

function UnavailablePage() {
  return (
    <div className="v6-page" data-testid="unavailable">
      <h1 className="v6-title">案件不可用</h1>
      <p className="muted">这个链接指向的内容不存在，或者你没有权限查看。</p>
      <Link className="btn btn-outline" to={v6Path({ kind: "matters" })}>
        返回案件列表
      </Link>
    </div>
  );
}

/** S01 进入自助. The ids live in a ref so a retry after a fault reuses them. */
function useSelfServiceCreate(repository: LocalRepository) {
  const navigate = useNavigate();
  const ids = useRef<{ matterId: string; eventId: string } | null>(null);
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const create = useCallback(async () => {
    ids.current ??= { matterId: crypto.randomUUID(), eventId: crypto.randomUUID() };
    setState({ busy: true, error: null });
    const result = await createSelfServiceMatter(repository, LOCAL_ACTOR, {
      ...ids.current,
      requestId: crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    if (result.ok) {
      ids.current = null;
      navigate(result.next);
      return;
    }
    setState({ busy: false, error: result.message });
  }, [repository, navigate]);

  return { ...state, create };
}

function CreateError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="notice" role="alert">
      <strong>尚未保存</strong>
      <p>{message}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

function StartPage({ repository }: { repository: LocalRepository }) {
  const { busy, error, create } = useSelfServiceCreate(repository);
  const services = GLOBAL_NAV.find((item) => item.key === "services")!;
  return (
    <div className="v6-page">
      <h1 className="v6-title">从哪里开始</h1>
      <p className="muted">案件保存在这台设备的浏览器里，不会上传。</p>
      {error ? <CreateError message={error} onRetry={create} /> : null}
      <div className="v6-entries">
        <section className="card v6-entry" data-testid="entry-self">
          <h2 className="card-title">自助起草</h2>
          <p className="card-description">新建一个空案件，从上传材料开始。</p>
          <button type="button" className="btn btn-default" disabled={busy} onClick={create}>
            {busy ? "正在创建…" : "创建案件"}
          </button>
        </section>
        <section className="card v6-entry" data-testid="entry-pro">
          <h2 className="card-title">专业工作台</h2>
          <p className="card-description">打开已有案件，按材料、事实、草稿、检查等标签处理。</p>
          <Link className="btn btn-outline" to={v6Path({ kind: "matters" })}>
            打开案件列表
          </Link>
        </section>
        <section className="card v6-entry" data-testid="entry-service">
          <h2 className="card-title">人工服务</h2>
          <p className="card-description">咨询、复核和代理对接。</p>
          <Link className="btn btn-outline" to={v6Path({ kind: "section", key: "services" })}>
            查看服务目录
          </Link>
          <p className="field-hint">{services.capability.reason}</p>
        </section>
      </div>
    </div>
  );
}

function MattersPage({ repository }: { repository: LocalRepository }) {
  const [view, setView] = useState<MatterListView | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { busy, error, create } = useSelfServiceCreate(repository);
  useEffect(() => {
    let live = true;
    setView(null);
    void listMatterView(repository, LOCAL_ACTOR).then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [repository, attempt]);

  if (view === null) return <Loading />;
  if (view.state === "storage_unavailable") return <StorageUnavailable message={view.message} onRetry={() => setAttempt((n) => n + 1)} />;
  return (
    <div className="v6-page">
      <div className="row-between">
        <h1 className="v6-title">案件</h1>
        {view.matters.length > 0 ? (
          <button type="button" className="btn btn-default btn-sm" disabled={busy} onClick={create}>
            创建案件
          </button>
        ) : null}
      </div>
      {error ? <CreateError message={error} onRetry={create} /> : null}
      {view.matters.length === 0 ? (
        <div className="card v6-empty" data-testid="matters-empty">
          <p>还没有案件。</p>
          <div className="v6-empty-actions">
            <button type="button" className="btn btn-default" disabled={busy} onClick={create}>
              创建案件
            </button>
            <button type="button" className="btn btn-outline" disabled title="五个问题尚未开放。">
              回答五个问题
            </button>
            <button type="button" className="btn btn-outline" disabled title="示例体验尚未开放；它会使用独立的存储空间。">
              示例体验
            </button>
          </div>
          <p className="field-hint">「回答五个问题」和「示例体验」尚未开放。</p>
        </div>
      ) : (
        <ul className="v6-list" data-testid="matters-list">
          {view.matters.map((matter) => (
            <li key={matter.id} className="project-row">
              <Link to={v6Path({ kind: "matter", matterId: matter.id, targetId: null, tab: "overview" })}>{matter.title}</Link>
              <span className="muted">更新于 {formatTime(matter.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Load a matter view for the URL; reloads when the URL's ids change. */
function useMatterView(repository: LocalRepository, matterId: string, targetId: string | null) {
  const [view, setView] = useState<MatterView | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setView(null);
    void resolveMatterView(repository, LOCAL_ACTOR, matterId, targetId).then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [repository, matterId, targetId, attempt]);
  return [view, () => setAttempt((n) => n + 1)] as const;
}

function UploadPage({ repository, matterId }: { repository: LocalRepository; matterId: string }) {
  const [view, retry] = useMatterView(repository, matterId, null);
  if (view === null) return <Loading />;
  if (view.state === "storage_unavailable") return <StorageUnavailable message={view.message} onRetry={retry} />;
  if (view.state === "unavailable") return <UnavailablePage />;
  return (
    <div className="v6-page" data-testid="upload">
      <p className="muted">{view.matter.title}</p>
      <h1 className="v6-title">上传材料</h1>
      <div className="notice">
        <p>{TAB_CAPABILITIES.sources.reason}</p>
        <p>案件已保存在本机，可以随时回来继续。</p>
      </div>
      <Link className="btn btn-outline" to={v6Path({ kind: "matter", matterId, targetId: null, tab: "overview" })}>
        打开案件
      </Link>
    </div>
  );
}

function MatterPage({
  repository,
  matterId,
  targetId,
  tab,
}: {
  repository: LocalRepository;
  matterId: string;
  targetId: string | null;
  tab: MatterTab;
}) {
  const [view, retry] = useMatterView(repository, matterId, targetId);
  if (view === null) return <Loading />;
  if (view.state === "storage_unavailable") return <StorageUnavailable message={view.message} onRetry={retry} />;
  if (view.state === "unavailable") return <UnavailablePage />;

  const capability = TAB_CAPABILITIES[tab];
  return (
    <div className="v6-page" data-testid="matter">
      <h1 className="v6-title">{view.matter.title}</h1>
      {view.targets.length > 0 ? (
        <nav className="v6-targets" aria-label="目标">
          <Link
            to={v6Path({ kind: "matter", matterId, targetId: null, tab })}
            className={targetId === null ? "chip active" : "chip"}
          >
            整个案件
          </Link>
          {view.targets.map((target, index) => (
            <Link
              key={target.id}
              to={v6Path({ kind: "matter", matterId, targetId: target.id, tab })}
              className={target.id === targetId ? "chip active" : "chip"}
            >
              目标 {index + 1}
            </Link>
          ))}
        </nav>
      ) : null}
      <nav className="tabs-list v6-tabs" aria-label="案件标签">
        {MATTER_TABS.map((item) => (
          <Link
            key={item.key}
            to={v6Path({ kind: "matter", matterId, targetId, tab: item.key })}
            className="tabs-trigger"
            data-state={item.key === tab ? "active" : "inactive"}
            aria-current={item.key === tab ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {capability.state === "unavailable" ? (
        <div className="notice" data-testid="tab-unavailable">
          {capability.reason}
        </div>
      ) : (
        <dl className="kv v6-overview">
          <dt>状态</dt>
          <dd>{view.matter.status === "active" ? "进行中" : view.matter.status}</dd>
          <dt>创建时间</dt>
          <dd>{formatTime(view.matter.createdAt)}</dd>
          <dt>材料版本</dt>
          <dd>{view.matter.sourceVersion}</dd>
          <dt>目标</dt>
          <dd>{view.targets.length === 0 ? "尚未创建" : `${view.targets.length} 个`}</dd>
          <dt>下一步</dt>
          <dd>
            <Link to={v6Path({ kind: "upload", matterId })}>上传材料</Link>
          </dd>
        </dl>
      )}
    </div>
  );
}

function SectionPage({ sectionKey }: { sectionKey: Exclude<GlobalKey, "matters"> }) {
  const item = GLOBAL_NAV.find((candidate) => candidate.key === sectionKey)!;
  return (
    <div className="v6-page" data-testid="section">
      <h1 className="v6-title">{item.label}</h1>
      <div className="notice">{item.capability.reason}</div>
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
