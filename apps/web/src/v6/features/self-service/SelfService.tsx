import { useCallback, useEffect, useReducer, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { DeliveryWorkspace, PreviewWorkspace } from "../delivery/Workspace.tsx";
import { TestOutputNotice } from "../workbench/TestOutputNotice.tsx";
import { GenerationPanel } from "../generation/Generation.tsx";
import { createGenerationRevisionStore } from "../generation/generation.ts";
import { LOCAL_TEST_GENERATION_OPTIONS } from "../generation/local-runtime.ts";
import { readIntake, type IntakeView } from "../intake/intake.ts";
import { loadTargetsView, type TargetView, type TargetsView } from "../targets/targets.ts";
import { describeUploadRows, ingestFiles, type IngestFile } from "../sources/ingest.ts";
import { Parse } from "../sources/Parse.tsx";
import {
  UploadPanel,
  initialUploadState,
  newFileId,
  pendingForSave,
  rowsFromItems,
  uploadReducer,
} from "../sources/Upload.tsx";
import type { Actor, LocalRepository, MatterRecord, TargetRecord } from "../../lib/repository.ts";
import { R1_ACTIVE_RULE_PACK_VERSION, R1_RULE_PACK } from "../checks/rule-pack.vite.ts";
import { v6Path, type SelfServiceStep } from "../../routes/navigation.ts";
export type { SelfServiceStep };
import { QuestionsStep } from "./QuestionsStep.tsx";
import { RouteStep } from "./RouteStep.tsx";
import { requiredSelfServiceStep, resolveQuestionIndex } from "./route-state.ts";
import { selfServicePath } from "./paths.ts";
import "./self-service.css";

interface LoadedSelfService {
  matter: MatterRecord;
  intake: IntakeView;
  targets: TargetsView;
  target: TargetView | null;
  targetRecord: TargetRecord | null;
  /** Whether the adopted head revision is a persisted local test revision. */
  headTestOutput: boolean;
}

type LoadState = { phase: "loading" } | { phase: "unavailable" } | { phase: "failed"; message: string } | { phase: "ready"; data: LoadedSelfService };

const STEPS: readonly { key: SelfServiceStep; label: string }[] = [
  { key: "upload", label: "上传材料" },
  { key: "questions", label: "补充信息" },
  { key: "route", label: "选择路线" },
  { key: "generate", label: "生成材料" },
  { key: "preview", label: "预览与下载" },
];

async function loadSelfService(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  requestedTargetId: string | null,
): Promise<{ ok: true; data: LoadedSelfService } | { ok: false; kind: "unavailable" | "failed"; message?: string }> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok || loaded.data.data.matter.status === "deletion_pending") return { ok: false, kind: "unavailable" };
  const [intake, targets] = await Promise.all([
    readIntake(repository, actor, matterId),
    loadTargetsView(repository, actor, matterId),
  ]);
  if (!intake.ok) return { ok: false, kind: "failed", message: intake.message };
  if (!targets.ok) return { ok: false, kind: "failed", message: targets.error.message };
  const activeTargets = targets.view.targets.filter((target) => target.status === "active");
  const target = requestedTargetId === null
    ? activeTargets[0] ?? null
    : activeTargets.find((candidate) => candidate.id === requestedTargetId) ?? activeTargets[0] ?? null;
  const targetRecord = target === null
    ? null
    : loaded.data.data.targets.find((candidate) => candidate.id === target.id) ?? null;
  const head = target === null
    ? null
    : await createGenerationRevisionStore({ repository, actor }).loadHeadRevision(matterId, target.id);
  const headTestOutput = head?.ok === true && head.data?.revision.testOutput === true;
  return {
    ok: true,
    data: {
      matter: loaded.data.data.matter,
      intake: intake.view,
      targets: targets.view,
      target,
      targetRecord,
      headTestOutput,
    },
  };
}

function targetQuery(targetId: string | null): string {
  return targetId === null ? "" : `?target=${encodeURIComponent(targetId)}`;
}

export function SelfService({
  repository,
  actor,
  matterId,
  step,
}: {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  step: SelfServiceStep;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedTargetId = searchParams.get("target");
  const questionParam = searchParams.get("q");
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [parseRefresh, setParseRefresh] = useState(0);
  // Bumped after a successful adoption so the wizard re-reads the target's head
  // revision without a full page reload; the guard then lets preview through.
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshAfterAdoption = useCallback(() => setRefreshToken((value) => value + 1), []);
  const targetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    // A refresh keeps the current panel mounted; only the first load blanks it.
    setState((previous) => (previous.phase === "ready" ? previous : { phase: "loading" }));
    void loadSelfService(repository, actor, matterId, requestedTargetId).then((result) => {
      if (!live) return;
      if (result.ok) setState({ phase: "ready", data: result.data });
      else if (result.kind === "unavailable") setState({ phase: "unavailable" });
      else setState({ phase: "failed", message: result.message ?? "无法读取本机案件。" });
    });
    return () => { live = false; };
  }, [repository, actor, matterId, requestedTargetId, questionParam, step, refreshToken]);

  useEffect(() => {
    // GenerationPanel's compare action is an event seam owned by its feature;
    // route it to the real draft comparison page of this same matter/target.
    const onCompare = () => {
      const targetId = targetIdRef.current;
      if (targetId === null) return;
      navigate(v6Path({ kind: "matter", matterId, targetId, tab: "draft" }));
    };
    window.addEventListener("v6:generation-compare", onCompare);
    return () => window.removeEventListener("v6:generation-compare", onCompare);
  }, [matterId, navigate]);
  useEffect(() => {
    targetIdRef.current = state.phase === "ready" ? (state.data.target?.id ?? null) : null;
  }, [state]);

  const goToQuestion = useCallback((index: number) => {
    const query = new URLSearchParams({ q: String(index) });
    if (requestedTargetId !== null) query.set("target", requestedTargetId);
    navigate(`${selfServicePath(matterId, "questions")}?${query.toString()}`);
  }, [matterId, navigate, requestedTargetId]);
  const refreshParse = useCallback(() => setParseRefresh((value) => value + 1), []);
  const goToStep = useCallback((next: SelfServiceStep, targetId: string | null = requestedTargetId) => {
    navigate(`${selfServicePath(matterId, next)}${targetQuery(targetId)}`);
  }, [matterId, navigate, requestedTargetId]);

  if (state.phase === "loading") return <SelfServiceLoading />;
  if (state.phase === "unavailable") return <SelfServiceUnavailable />;
  if (state.phase === "failed") {
    return <section className="v6-self-page"><div className="notice" role="alert"><strong>案件没有保存成功</strong><p>{state.message}</p></div></section>;
  }

  const { data } = state;
  const allowedStep = requiredSelfServiceStep(step, data);
  if (allowedStep !== step) {
    const next = `${selfServicePath(matterId, allowedStep)}${targetQuery(data.target?.id ?? null)}`;
    return <SelfServiceLoading redirectTo={next} replace />;
  }
  const questionIndex = resolveQuestionIndex(data.intake, questionParam);
  const currentStep = step === "done" ? "preview" : step;

  return (
    <div className="v6-self-page" data-testid="self-service" data-step={step} data-matter-id={matterId}>
      <header className="v6-self-intro">
        <div>
          <p className="v6-self-kicker">自助准备 · 本机保存</p>
          <h1>{data.matter.title}</h1>
        </div>
        <p>先整理材料和真实信息。路线、风险和导出状态会根据本案已保存的内容显示。</p>
      </header>
      <nav className="v6-self-steps" aria-label="自助申请步骤">
        {STEPS.map((item, index) => {
          const active = item.key === currentStep;
          const to = `${selfServicePath(matterId, item.key)}${targetQuery(data.target?.id ?? requestedTargetId)}`;
          return (
            <Link key={item.key} to={to} aria-current={active ? "step" : undefined} data-active={active ? "true" : undefined}>
              <span>{index + 1}</span>{item.label}
            </Link>
          );
        })}
      </nav>
      <div className="v6-self-content" onClickCapture={(event) => interceptProductLink(event, navigate)}>
        {step === "upload" ? (
          <UploadStep
            repository={repository}
            actor={actor}
            matterId={matterId}
            parseRefresh={parseRefresh}
            onSaved={refreshParse}
            onQuestions={() => goToStep("questions", data.target?.id ?? null)}
          />
        ) : null}
        {step === "questions" ? (
          <QuestionsStep
            key={questionIndex}
            repository={repository}
            actor={actor}
            matterId={matterId}
            initialIndex={questionIndex}
            onNavigate={goToStep}
            onQuestion={goToQuestion}
          />
        ) : null}
        {step === "route" ? (
          <RouteStep
            repository={repository}
            actor={actor}
            matterId={matterId}
            intake={data.intake}
            targets={data.targets}
            target={data.target}
            onSaved={(targetId) => goToStep("generate", targetId)}
            onBack={() => goToStep("questions", data.target?.id ?? null)}
          />
        ) : null}
        {step === "generate" && data.target ? (
          <section className="v6-self-step" data-testid="self-generation">
            <div className="v6-self-step-heading">
              <div><p className="v6-self-kicker">第 4 步</p><h2>生成材料</h2></div>
              <Link className="btn btn-outline btn-sm" to={`${selfServicePath(matterId, "route")}${targetQuery(data.target.id)}`}>返回选择路线</Link>
            </div>
            <p className="notice" data-testid="self-test-output-label">本机固定测试引擎：任务不发送材料、不产生费用。测试结果可采纳为带标记的本地测试修订，用于演练流程，不代表真实 AI 起草能力或正式申请材料。</p>
            <GenerationPanel
              repository={repository}
              actor={actor}
              matterId={matterId}
              targetId={data.target.id}
              engineOptions={LOCAL_TEST_GENERATION_OPTIONS}
              onAdopted={refreshAfterAdoption}
            />
            <div className="v6-self-actions">
              <span>{data.targetRecord?.draftRevisionId == null
                ? "只有明确采纳的草稿修订才能进入预览。"
                : "已采纳修订；预览和导出会使用这份修订，测试标记仍会保留。"}</span>
              <button
                type="button"
                className="btn btn-default"
                data-testid="self-view-draft"
                disabled={data.targetRecord?.draftRevisionId == null}
                onClick={() => goToStep("preview", data.target!.id)}
              >
                查看已采纳的草稿
              </button>
            </div>
          </section>
        ) : null}
        {step === "preview" && data.target ? (
          <section className="v6-self-step" data-testid="self-preview-step">
            <div className="v6-self-step-heading">
              <div><p className="v6-self-kicker">第 5 步</p><h2>预览并通读</h2></div>
              <Link className="btn btn-outline btn-sm" to={`${selfServicePath(matterId, "generate")}${targetQuery(data.target.id)}`}>返回生成</Link>
            </div>
            <TestOutputNotice revision={{ testOutput: data.headTestOutput }} testId="self-preview-test-output" />
            {!data.headTestOutput ? <p className="notice" data-testid="self-preview-test-guidance">本机生成任务使用测试引擎；确认通读只记录你已查看，不会把测试输出转成正式申请材料。</p> : null}
            <PreviewWorkspace repository={repository} actor={actor} matterId={matterId} targetId={data.target.id} rulePack={R1_RULE_PACK} rulePackVersion={R1_ACTIVE_RULE_PACK_VERSION} />
            <div className="v6-self-actions">
              <span>通读确认绑定当前草稿、事实和附图版本；内容变化后需要重新确认。</span>
              <button type="button" className="btn btn-default" onClick={() => goToStep("done", data.target!.id)}>继续到导出</button>
            </div>
          </section>
        ) : null}
        {step === "done" && data.target?.config ? (
          <section className="v6-self-step" data-testid="self-done-step">
            <div className="v6-self-step-heading"><div><p className="v6-self-kicker">导出前确认</p><h2>生成与下载材料</h2></div></div>
            <TestOutputNotice revision={{ testOutput: data.headTestOutput }} testId="self-done-test-output" />
            {!data.headTestOutput ? <p className="notice" data-testid="self-done-test-guidance">本机生成任务使用测试引擎。若修订被标记为测试输出，标记会随修订保留；通读确认和导出都不会将其变为正式申请材料。</p> : null}
            <DeliveryWorkspace
              repository={repository}
              actor={actor}
              matterId={matterId}
              targetId={data.target.id}
              rulePack={R1_RULE_PACK}
              rulePackVersion={R1_ACTIVE_RULE_PACK_VERSION}
              confirmationMode="self_read"
            />
            <aside className="v6-self-next">
              <h3>之后可以继续处理同一案件</h3>
              <p>导出的是申请准备材料，不代表已递交。当前可回到专业工作台继续编辑、检查或处理其他目标。</p>
              <Link className="btn btn-outline" to={selfServicePathForMatter(matterId)}>进入同一案件的专业工作台</Link>
            </aside>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function UploadStep({
  repository,
  actor,
  matterId,
  parseRefresh,
  onSaved,
  onQuestions,
}: {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  parseRefresh: number;
  onSaved: () => void;
  onQuestions: () => void;
}) {
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [noDocumentNotice, setNoDocumentNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = state.phase === "saving";
  const pendingCount = pendingForSave(state).length;

  useEffect(() => () => abortRef.current?.abort(), []);

  const addFiles = useCallback((files: readonly File[]) => {
    if (files.length === 0) return;
    dispatch({
      type: "add",
      entries: files.map((file) => ({ fileId: newFileId(), file: file as IngestFile })),
    });
  }, []);

  const save = useCallback(async () => {
    if (busy) return;
    const items = pendingForSave(state);
    if (items.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "saving" });
    try {
      const outcomes = await ingestFiles(
        repository,
        actor,
        matterId,
        items.map((item) => item.file),
        {
          fileIds: items.map((item) => item.fileId),
          signal: controller.signal,
          onProgress: (progress) => dispatch({ type: "progress", progress }),
        },
      );
      dispatch({ type: "settle", outcomes });
    } catch {
      dispatch({ type: "batch-error", message: "保存过程中发生意外错误；没有显示为已保存的文件都还没有存好。" });
    } finally {
      abortRef.current = null;
      dispatch({ type: "idle" });
      onSaved();
    }
  }, [actor, busy, matterId, onSaved, repository, state]);

  const answerWithoutDocuments = async () => {
    setNoDocumentNotice(null);
    if (state.items.length > 0) {
      setNoDocumentNotice("已选择文件。先保存文件，或使用下方「继续补充信息」保留当前案件材料。");
      return;
    }
    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) {
      setNoDocumentNotice("无法确认本案材料状态。请重试读取，或使用下方「继续补充信息」。");
      return;
    }
    if (loaded.data.data.assets.some((asset) => asset.purpose === "source")) {
      setNoDocumentNotice("本案已有材料。使用下方「继续补充信息」进入问答；已有文件会保留，不会生成虚拟附件。");
      return;
    }
    onQuestions();
  };

  return (
    <section className="v6-self-step" data-testid="self-upload-step">
      <div className="v6-self-step-heading"><div><p className="v6-self-kicker">第 1 步</p><h2>先放入已有材料</h2></div></div>
      <p className="v6-self-copy">可以上传技术说明、图纸、照片或实验记录。文件与解析都在本机处理；没有文档也能继续，不会自动生成附件。</p>
      <UploadPanel
        view={describeUploadRows(rowsFromItems(state.items))}
        busy={busy}
        pendingCount={pendingCount}
        batchError={state.batchError}
        onFiles={addFiles}
        onRemove={(fileId) => dispatch({ type: "remove", fileId })}
        onSave={() => void save()}
        onCancel={() => abortRef.current?.abort()}
        onAnswerWithoutDocuments={() => void answerWithoutDocuments()}
      />
      {noDocumentNotice ? <div className="notice" role="status">{noDocumentNotice}</div> : null}
      <section className="v6-self-parse" aria-labelledby="self-parse-title">
        <div><p className="v6-self-kicker">材料解析</p><h3 id="self-parse-title">检查真实提取状态</h3></div>
        <Parse repository={repository} actor={actor} matterId={matterId} refreshToken={parseRefresh} onAddDocuments={() => document.querySelector<HTMLInputElement>("[data-testid='upload-input']")?.click()} />
      </section>
      <div className="v6-self-actions">
        <span>{pendingCount > 0 ? "先保存已选择的文件，再继续。" : "解析没有写入的内容不会成为事实来源。你可以继续逐题补充。"}</span>
        <button type="button" className="btn btn-default" disabled={busy || pendingCount > 0} onClick={onQuestions}>继续补充信息</button>
      </div>
    </section>
  );
}

function SelfServiceLoading({ redirectTo, replace = false }: { redirectTo?: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (redirectTo) navigate(redirectTo, { replace });
  }, [navigate, redirectTo, replace]);
  return <section className="v6-self-page" aria-busy="true"><p className="muted">正在读取本机案件和已保存进度…</p><div className="skeleton v6-skeleton" /></section>;
}

function SelfServiceUnavailable() {
  return <section className="v6-self-page"><div className="notice" role="alert"><strong>案件不可用</strong><p>案件不存在，或当前本机用户无权查看。</p><Link className="btn btn-outline" to={v6Path({ kind: "matters" })}>返回案件列表</Link></div></section>;
}

function selfServicePathForMatter(matterId: string): string {
  return v6Path({ kind: "matter", matterId, targetId: null, tab: "overview" });
}

function interceptProductLink(event: MouseEvent<HTMLDivElement>, navigate: ReturnType<typeof useNavigate>) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.target || anchor.download) return;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/v6/")) return;
  event.preventDefault();
  navigate(`${url.pathname}${url.search}${url.hash}`);
}

