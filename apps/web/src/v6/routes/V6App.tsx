/**
 * V6-08 — the `/v6` pages. Every decision about what to show comes from
 * `navigation.ts`; this file only opens the browser repository and renders.
 *
 * The URL is the only page state: a refreshed or shared link reads the matter
 * again and shows the same view. Nothing here writes except the self-service
 * entry, and nothing is filled in with demo content.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell.tsx";
import { ErrorBoundary } from "../components/ErrorBoundary.tsx";
import { AppearanceProvider } from "../features/settings/Appearance.tsx";
import { R1_RULE_PACK, R1_ACTIVE_RULE_PACK_VERSION } from "../features/checks/rule-pack.vite.ts";
import { Body, Button, Callout, Icon, Pane, SectionHeader, Tag, Toolbar } from "../components/ui/index.ts";
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
import "../features/self-service/self-service.css";
import "./v6.css";

// Route-level code splitting: the shell, repository and start page stay in the
// V6App chunk; each feature page loads on first visit behind Suspense. PDF and
// export assembly remain their own on-demand chunks.
const SelfServicePage = lazy(() =>
  import("../features/self-service/SelfService.tsx").then((module) => ({ default: module.SelfService })),
);
const ProfessionalWorkbench = lazy(() =>
  import("../features/workbench/Workbench.tsx").then((module) => ({ default: module.ProfessionalWorkbench })),
);
const AiPage = lazy(() => import("../features/ai/Ai.tsx").then((module) => ({ default: module.AiPage })));
const InboxPage = lazy(() => import("../features/inbox/Inbox.tsx").then((module) => ({ default: module.InboxPage })));
const MattersFeaturePage = lazy(() => import("../features/matters/Matters.tsx").then((module) => ({ default: module.MattersPage })));
const ActivityFeedPage = lazy(() =>
  import("../features/workbench/ActivityFeed.tsx").then((module) => ({ default: module.ActivityFeed })),
);
const SettingsPage = lazy(() => import("./SettingsPage.tsx"));

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
        <ErrorBoundary area="页面" resetKey={pathname}>
          <Suspense fallback={<RouteSkeleton />}>
            <Page route={route} repository={repo.repository} />
          </Suspense>
        </ErrorBoundary>
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
      return <SelfServicePage key={`${route.matterId}/${route.step}`} repository={repository} actor={LOCAL_ACTOR} matterId={route.matterId} step={route.step} />;
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

/** Placeholder while a route chunk downloads; the shell and navigation stay usable. */
function RouteSkeleton() {
  return (
    <div className="v6-page" aria-busy="true" data-testid="route-skeleton">
      <p className="muted">正在读取页面…</p>
      <div className="skeleton v6-skeleton" />
      <div className="skeleton v6-skeleton" />
    </div>
  );
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

function StartPage({ repository }: { repository: LocalRepository }) {
  const { busy, error, create } = useSelfServiceCreate(repository);
  return (
    <main className="main" data-testid="start-page">
      <Toolbar title="卷宗" subtitle="申请材料，从这里开始" right={<Tag tone="plain">本机预览</Tag>} />
      <Body><Pane>
        <div className="start-intro">
          <div className="start-symbol"><Icon name="folder" size="lg" /></div>
          <div className="small muted">卷宗 · 专利材料工作室</div>
          <h1>把你的技术，写成中国实用新型申请材料</h1>
          <p>面向中国研发团队和个人发明人。从一份图纸、一段产品结构说明开始，先把事实整理清楚。</p>
        </div>
        {error ? (
          <Callout tone="warn" icon="alert" testId="start-create-error">
            <b>案件没有创建成功</b>
            <p>{error}</p>
            <button type="button" className="btn sm" onClick={create}>重试</button>
          </Callout>
        ) : null}
        <div className="entry">
          <button type="button" className="entry-card" data-testid="entry-self" disabled={busy} onClick={create}>
            <span className="ec-i"><Icon name="doc" /></span>
            <span className="ec-t">准备我的中国实用新型申请</span>
            <span className="ec-d">上传产品资料，回答五个问题，查看和修改中文准备材料。没有专利经验也可以开始。</span>
            <span className="ec-m">本机保存 · 不收费</span>
            <span className="ec-go">{busy ? "正在创建…" : "开始准备"} <Icon name="arrow" size="sm" /></span>
          </button>
          <Link className="entry-card" to={v6Path({ kind: "matters" })} data-testid="entry-pro">
            <span className="ec-i"><Icon name="folder" /></span>
            <span className="ec-t">进入专业工作台</span>
            <span className="ec-d">在同一个案件中控制目标、事实、草稿、版本、检查和交付。</span>
            <span className="ec-m">同一案件，可继续处理</span>
            <span className="ec-go">打开案件列表 <Icon name="arrow" size="sm" /></span>
          </Link>
          <Link className="entry-card" to={v6Path({ kind: "section", key: "services" })} data-testid="entry-service">
            <span className="ec-i"><Icon name="users" /></span>
            <span className="ec-t">我想先问专业人员</span>
            <span className="ec-d">申请路线拿不准、已经公开过，或需要人工复核？先说清问题，再确定委托。</span>
            <span className="ec-m">咨询 · 复核 · 代理对接（暂未开放）</span>
            <span className="ec-go">查看服务范围 <Icon name="arrow" size="sm" /></span>
          </Link>
        </div>
        <div className="recent">
          <span className="rc-i"><Icon name="shield" /></span>
          <div className="grow">
            <div className="rc-t">你决定哪些内容可以交给 AI</div>
            <div className="rc-d">生成前查看实际处理方、区域与材料范围，由你确认后才外发；服务不可用时会说明原因。</div>
          </div>
          <Link className="btn" to={v6Path({ kind: "section", key: "ai" })}>了解 AI 设置</Link>
        </div>
        <div className="start-bottom">
          <Link to={v6Path({ kind: "section", key: "pricing" })}>查看套餐</Link>
          <span>自助与专业共用同一案件和本机存储</span>
          <Link to={v6Path({ kind: "section", key: "settings" })}>设置</Link>
        </div>
        <Callout tone="info" icon="info">
          当前为本地材料准备功能：不收费、不自动递交。真实 AI 草稿需人工核对；标有「测试输出」的结果仅用于验证流程。
        </Callout>
      </Pane></Body>
    </main>
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
  return <ProfessionalWorkbench repository={repository} actor={LOCAL_ACTOR} matterId={matterId} targetId={targetId} tab={tab} rulePack={R1_RULE_PACK} rulePackVersion={R1_ACTIVE_RULE_PACK_VERSION} />;
}

function SectionPage({ sectionKey, repository }: { sectionKey: SectionKey; repository: LocalRepository }) {
  if (sectionKey === "settings") return <SettingsPage repository={repository} />;
  if (sectionKey === "activity") return <ActivityFeedPage repository={repository} actor={LOCAL_ACTOR} currentMatterId="" />;
  if (sectionKey === "services") return <ServicesPage />;
  if (sectionKey === "pricing") return <PricingPage />;
  if (sectionKey === "billing") return <BillingPage />;
  const item = GLOBAL_NAV.find((candidate) => candidate.key === sectionKey)!;
  return (
    <main className="main" data-testid="section">
      <Toolbar title={item.label} subtitle="本地版能力范围" />
      <Body><Pane>
        <Callout tone="info" icon="info">{item.capability.reason ?? "本地版本的能力范围有限。"}</Callout>
      </Pane></Body>
    </main>
  );
}

function ServicesPage() {
  const services = [
    { key: "consult", icon: "chat" as const, title: "申请路线咨询", description: "梳理申请目标、公开历史与申请路线，约定咨询时间。", output: "30 分钟咨询 + 书面要点", scope: "提供路线建议，不包含文件起草或代理递交" },
    { key: "review", icon: "eye" as const, title: "申请材料复核", description: "由拟匹配的专业人员复核权利要求、说明书支持和已知风险。", output: "带批注的审阅稿 + 问题清单", scope: "先确认法域、资质、利益冲突和报价，再成立委托" },
    { key: "agent", icon: "scale" as const, title: "联系申请代理", description: "将准备好的材料交给适格代理人员，确认手续与服务范围。", output: "需求确认与正式报价", scope: "代理递交和官费另行约定，不包含在软件套餐里" },
  ];
  return (
    <main className="main" data-testid="section-services">
      <Toolbar title="人工服务" subtitle="软件套餐之外，可单独选择" back={{ to: v6Path({ kind: "start" }), label: "返回首页" }} />
      <Body><Pane>
        <h1 className="wiz-h1">需要时，请专业人员一起看</h1>
        <p className="wiz-sub">从一个问题开始，或把准备好的材料交给对方复核。先确认人、范围和费用，再分享材料。</p>
        <div className="svc-grid">
          {services.map((service) => (
            <article className="svc-card" key={service.key} data-testid={`service-${service.key}`}>
              <span className="sc-i"><Icon name={service.icon} /></span>
              <h2 className="sc-t">{service.title}</h2>
              <p className="sc-d">{service.description}</p>
              <div className="sc-p">暂未开放 <small>/ 当前不报价</small></div>
              <div className="sc-m">当前无法预约、分享材料或付款</div>
              <button type="button" className="btn" disabled>暂未开放</button>
            </article>
          ))}
        </div>
        <SectionHeader title="一次清楚的服务流程" />
        <div className="svc-flow">
          <div className="sf"><b>描述需求</b>选择法域和希望解决的问题</div>
          <div className="sf"><b>确认服务</b>核对人员资格、利益冲突、范围与报价</div>
          <div className="sf"><b>授权材料</b>选择最少必要的文件和版本</div>
          <div className="sf"><b>收取结果</b>查看咨询要点或带批注材料</div>
        </div>
        <Callout tone="info" icon="shield">
          <b>服务边界。</b>平台会员不代表已建立律师或代理委托关系；当前本地版未开放预约、报价、付款或资料分享，页面说明不构成法律意见。
        </Callout>
      </Pane></Body>
    </main>
  );
}

function PricingPage() {
  const plans = [
    {
      key: "free",
      name: "免费体验",
      description: "了解材料准备过程",
      price: "未定价",
      unit: "当前本地版不收费",
      features: ["本机保存材料与答案", "本机测试生成与预览", "风险提示与人工确认"],
      action: <Button to={v6Path({ kind: "start" })}>免费开始</Button>,
    },
    {
      key: "self",
      name: "单案解锁",
      description: "只准备这一件申请",
      price: "未定价",
      unit: "未来能力，尚未开放",
      features: ["完整材料查看与下载", "重新生成（未来）", "材料与导出清单"],
      action: <Button disabled>尚未开放</Button>,
    },
    {
      key: "pro",
      name: "专业版",
      description: "面向持续撰写与审阅",
      price: "未定价",
      unit: "未来能力，尚未开放",
      features: ["多法域目标", "修订、检查与审阅", "平台额度（未开放）"],
      action: <Button disabled>尚未开放</Button>,
    },
  ];
  return (
    <main className="main" data-testid="section-pricing">
      <Toolbar title="套餐与价格" subtitle="金额与套餐尚未形成商业报价" back={{ to: v6Path({ kind: "start" }), label: "返回首页" }} />
      <Body><Pane>
        <h1 className="wiz-h1">按当前需要选择</h1>
        <p className="wiz-sub">先试材料准备；复杂案件再使用完整工作台。风险提示、资料权限和内容确认不因套餐而改变。</p>
        <div className="price-grid">
          {plans.map((plan) => (
            <article className="price-card" key={plan.key} data-testid={`price-${plan.key}`}>
              <div className="pc-name">{plan.name}</div>
              <p className="pc-desc">{plan.description}</p>
              <div className="pc-price">{plan.price}</div>
              <div className="pc-unit">{plan.unit}</div>
              <ul>{plan.features.map((feature) => <li key={feature}><Icon name="check" size="sm" />{feature}</li>)}</ul>
              {plan.action}
            </article>
          ))}
        </div>
        <SectionHeader title="服务和使用边界" />
        <div className="group">
          <div className="row"><span className="grow">人工咨询、复核与代理对接</span><span className="small muted">当前未开放</span><Link className="btn sm" to={v6Path({ kind: "section", key: "services" })}>查看</Link></div>
          <div className="row"><span className="grow">官费、代理费</span><span className="small muted">不包含在软件费中</span></div>
          <div className="row"><span className="grow">本机测试引擎</span><span className="small muted">不消耗平台额度，也不发送材料</span></div>
        </div>
        <Callout tone="info" icon="info">
          本地版不收费，也不提供套餐、解锁、平台额度或支付流程。未来收费范围尚未开放，页面不展示未确认的价格。
        </Callout>
      </Pane></Body>
    </main>
  );
}

function BillingPage() {
  return (
    <main className="main" data-testid="section-billing">
      <Toolbar title="套餐与账单" subtitle="本地版没有账户套餐、订单或额度" back={{ to: v6Path({ kind: "start" }), label: "返回首页" }} />
      <Body><Pane>
        <div className="card">
          <div className="spread">
            <div>
              <h2 style={{ fontSize: 20 }}>本地版</h2>
              <p className="q-help">可以随时使用本机准备功能；人工服务独立于软件，当前未开放。</p>
            </div>
            <Button to={v6Path({ kind: "section", key: "pricing" })}>管理套餐</Button>
          </div>
          <div className="divider" />
          <div className="kv"><span>真实扣款</span><span>¥0</span></div>
          <div className="kv"><span>自动续费</span><span>未开启</span></div>
          <div className="kv"><span>本案解锁</span><span>不适用（本地版不收费）</span></div>
        </div>
        <SectionHeader title="平台 AI 额度" />
        <div className="card">
          <p className="muted">当前自助流程使用本机测试引擎，不使用平台额度；真实模型外发门保持关闭。</p>
        </div>
        <SectionHeader title="账单记录" />
        <div className="card">
          <p className="muted">没有真实账单。本地版不生成模拟付款、续费或额度记录。</p>
        </div>
      </Pane></Body>
    </main>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
