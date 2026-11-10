/**
 * V6-08 — the `/v6` pages. Every decision about what to show comes from
 * `navigation.ts`; this file only opens the browser repository and renders.
 *
 * The URL is the only page state: a refreshed or shared link reads the matter
 * again and shows the same view. Nothing here writes except the self-service
 * entry, and nothing is filled in with demo content.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell.tsx";
import { AppearancePage, AppearanceProvider } from "../features/settings/Appearance.tsx";
import { Recovery } from "../features/recovery/Recovery.tsx";
import { AiPage } from "../features/ai/Ai.tsx";
import { ProfessionalWorkbench } from "../features/workbench/Workbench.tsx";
import { ActivityFeed } from "../features/workbench/ActivityFeed.tsx";
import { LOCAL_TEST_GENERATION_OPTIONS } from "../features/generation/local-runtime.ts";
import { SelfService } from "../features/self-service/SelfService.tsx";
import { R1_RULE_PACK, R1_ACTIVE_RULE_PACK_VERSION } from "../features/checks/rule-pack.vite.ts";
import { MattersPage as MattersFeaturePage } from "../features/matters/Matters.tsx";
import { InboxPage } from "../features/inbox/Inbox.tsx";
import { openIndexedDbBackend } from "../lib/indexeddb-repository.ts";
import { openLocalRepository, type LocalRepository } from "../lib/repository.ts";
import {
  GLOBAL_NAV,
  LOCAL_ACTOR,
  PAGE_ERROR_MESSAGES,
  createSelfServiceMatter,
  parseV6Path,
  v6Path,
  type GlobalKey,
  type MatterTab,
  type SectionKey,
  type V6Route,
} from "./navigation.ts";
import "../styles/theme.css";
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
      return "matters";
    case "upload":
    case "self_service":
      return null;
    case "section":
      return route.key === "pricing" ? null : route.key;
    default:
      return null;
  }
}

export default function V6App() {
  return (
    <AppearanceProvider>
      <V6Pages />
    </AppearanceProvider>
  );
}

function V6Pages() {
  const { pathname } = useLocation();
  const route = parseV6Path(pathname);
  const [repo, retry] = useRepository();

  const shellMode = route.kind === "start" ? "public" : route.kind === "self_service" || route.kind === "upload" ? "self_service" : "professional";
  const matterId = route.kind === "self_service" || route.kind === "upload" ? route.matterId : undefined;
  return (
    <Shell runtime="local_web" active={activeSection(route)} mode={shellMode} matterId={matterId} repository={repo.state === "ready" ? repo.repository : undefined}>
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
      return <Navigate to={v6Path({ kind: "self_service", matterId: route.matterId, step: "upload" })} replace />;
    case "self_service":
      return <SelfService key={`${route.matterId}/${route.step}`} repository={repository} actor={LOCAL_ACTOR} matterId={route.matterId} step={route.step} />;
    case "matter":
      return <MatterPage repository={repository} matterId={route.matterId} targetId={route.targetId} tab={route.tab} />;
    case "section":
      if (route.key === "ai") return <AiPage repository={repository} actor={LOCAL_ACTOR} />;
      if (route.key === "inbox") return <InboxPage repository={repository} actor={LOCAL_ACTOR} />;
      return <SectionPage sectionKey={route.key} repository={repository} />;
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
      navigate(v6Path({ kind: "self_service", matterId: result.matterId, step: "upload" }));
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
  return (
    <div className="v6-page v6-start-page" data-testid="start-page">
      <header className="v6-start-intro">
        <p className="v6-self-kicker">专利材料准备</p>
        <h1 className="v6-title">把你的技术整理成申请准备材料</h1>
        <p className="muted">从已有材料或几个真实回答开始。先整理事实，再选择路线；案件和文件保存在本机浏览器。</p>
      </header>
      {error ? <CreateError message={error} onRetry={create} /> : null}
      <div className="v6-entries">
        <section className="card v6-entry" data-testid="entry-self">
          <h2 className="card-title">自助准备</h2>
          <p className="card-description">新建一个空案件，上传材料或直接回答问题。没有现成文档也能开始，不会自动补造材料。</p>
          <button type="button" className="btn btn-default" disabled={busy} onClick={create}>
            {busy ? "正在创建…" : "开始准备"}
          </button>
        </section>
        <section className="card v6-entry" data-testid="entry-pro">
          <h2 className="card-title">专业工作台</h2>
          <p className="card-description">在同一个案件中处理材料、事实、目标、草稿、检查和版本。</p>
          <Link className="btn btn-outline" to={v6Path({ kind: "matters" })}>打开案件列表</Link>
        </section>
        <section className="card v6-entry" data-testid="entry-service">
          <h2 className="card-title">人工服务</h2>
          <p className="card-description">了解咨询、材料复核和代理对接的范围与当前开放状态。</p>
          <Link className="btn btn-outline" to={v6Path({ kind: "section", key: "services" })}>查看服务范围</Link>
          <p className="field-hint">当前未开放预约、资料分享或付款。</p>
        </section>
      </div>
      <section className="v6-start-data">
        <strong>AI 与数据</strong>
        <span>当前自助流程使用本机测试引擎；不会把案件材料发送到模型服务。</span>
        <Link to={v6Path({ kind: "section", key: "ai" })}>查看处理能力</Link>
      </section>
      <footer className="v6-start-footer">
        <span>当前为本地准备功能，不收费、不自动递交。</span>
        <Link to={v6Path({ kind: "section", key: "pricing" })}>套餐与价格</Link>
        <Link to={v6Path({ kind: "section", key: "settings" })}>设置</Link>
      </footer>
    </div>
  );
}

function MattersPage({ repository }: { repository: LocalRepository }) {
  const navigate = useNavigate();
  const openUpload = useCallback(
    (matterId: string) => navigate(v6Path({ kind: "upload", matterId })),
    [navigate],
  );
  return <MattersFeaturePage repository={repository} actor={LOCAL_ACTOR} onCreate={openUpload} onOpenUpload={openUpload} />;
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
  return <ProfessionalWorkbench repository={repository} actor={LOCAL_ACTOR} matterId={matterId} targetId={targetId} tab={tab} generation={LOCAL_TEST_GENERATION_OPTIONS} rulePack={R1_RULE_PACK} rulePackVersion={R1_ACTIVE_RULE_PACK_VERSION} />;
}

function SectionPage({ sectionKey, repository }: { sectionKey: SectionKey; repository: LocalRepository }) {
  if (sectionKey === "settings") return <><AppearancePage /><Recovery repository={repository} actor={LOCAL_ACTOR} /></>;
  if (sectionKey === "activity") return <ActivityFeed repository={repository} actor={LOCAL_ACTOR} currentMatterId="" />;
  if (sectionKey === "services") return (
    <div className="v6-page" data-testid="section-services">
      <p className="v6-self-kicker">能力范围</p><h1 className="v6-title">人工服务</h1>
      <div className="notice"><strong>当前未开放预约</strong><p>本地版不匹配服务人员，不展示已核验资质或报价，也不接收预约、付款或资料分享。</p></div>
      <section className="card stack-3"><h2 className="card-title">未来服务范围</h2><ul><li>申请路线咨询：核对目标、公开历史与准备事项。</li><li>材料复核：由确认了资格、法域、保密条款和报价的专业人员查看指定版本。</li><li>代理对接：确认服务范围和委托关系后，再单独授权材料。</li></ul><p className="field-hint">这些服务当前都不可预约；页面说明不代表已建立委托或提供法律意见。</p></section>
    </div>
  );
  if (sectionKey === "pricing") return (
    <div className="v6-page" data-testid="section-pricing">
      <p className="v6-self-kicker">本地版本</p><h1 className="v6-title">套餐与价格</h1>
      <div className="notice"><strong>当前不收费</strong><p>本地准备功能没有套餐、单案解锁、平台额度或支付流程。未来收费范围尚未开放，也没有已确认的价格。</p></div>
      <p className="muted">人工咨询、材料复核和代理对接与软件功能分开；这些服务当前也未开放预约。</p>
    </div>
  );
  if (sectionKey === "billing") return (
    <div className="v6-page" data-testid="section-billing">
      <p className="v6-self-kicker">账户状态</p><h1 className="v6-title">账单</h1>
      <div className="notice"><strong>本地版没有账单</strong><p>当前没有账户套餐、订单、额度账本或真实扣款。这里不会生成模拟付款或续费状态。</p></div>
      <Link className="link-button" to={v6Path({ kind: "section", key: "pricing" })}>查看套餐与价格范围</Link>
    </div>
  );
  const item = GLOBAL_NAV.find((candidate) => candidate.key === sectionKey)!;
  return (
    <div className="v6-page" data-testid="section">
      <h1 className="v6-title">{item.label}</h1>
      <div className="notice">{item.capability.reason ?? "本地版本的能力范围有限。"}</div>
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
