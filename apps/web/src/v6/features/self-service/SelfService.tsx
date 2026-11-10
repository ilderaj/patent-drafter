import { useCallback, useEffect, useReducer, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { DeliveryWorkspace } from "../delivery/Workspace.tsx";
import { Preview } from "../preview/Preview.tsx";
import { ErrorBoundary } from "../../components/ErrorBoundary.tsx";
import { GenerationPanel } from "../generation/Generation.tsx";
import { LOCAL_TEST_GENERATION_OPTIONS } from "../generation/local-runtime.ts";
import { readIntake, type IntakeView } from "../intake/intake.ts";
import { loadTargetsView, type TargetView, type TargetsView } from "../targets/targets.ts";
import { describeUploadRows, ingestFiles, type IngestFile } from "../sources/ingest.ts";
import { Parse } from "../sources/Parse.tsx";
import {
  initialUploadState,
  newFileId,
  pendingForSave,
  rowsFromItems,
  uploadReducer,
} from "../sources/Upload.tsx";
import type { Actor, LocalRepository, MatterRecord, TargetRecord } from "../../lib/repository.ts";
import { R1_ACTIVE_RULE_PACK_VERSION, R1_RULE_PACK } from "../checks/rule-pack.vite.ts";
import { loadWorkspace } from "../delivery/workspace-data.ts";
import { riskPresentation } from "../preview/preview.ts";
import type { RiskDTO } from "../../../../../../packages/contracts/src/index.ts";
import { v6Path, type SelfServiceStep } from "../../routes/navigation.ts";
export type { SelfServiceStep };
import { QuestionsStep } from "./QuestionsStep.tsx";
import { RouteStep } from "./RouteStep.tsx";
import { requiredSelfServiceStep, resolveQuestionIndex } from "./route-state.ts";
import { selfServicePath } from "./paths.ts";
import { Body, Button, Callout, Icon, Pane, Sheet, Tag, Toolbar } from "../../components/ui/index.ts";
import "./self-service.css";

interface LoadedSelfService {
  matter: MatterRecord;
  intake: IntakeView;
  targets: TargetsView;
  target: TargetView | null;
  targetRecord: TargetRecord | null;
  risks: readonly RiskDTO[];
}

type LoadState = { phase: "loading" } | { phase: "unavailable" } | { phase: "failed"; message: string } | { phase: "ready"; data: LoadedSelfService };

const STEPS: readonly { key: SelfServiceStep; label: string; note: string }[] = [
  { key: "upload", label: "上传材料", note: "约 2 分钟" },
  { key: "questions", label: "补充信息", note: "5 个问题" },
  { key: "route", label: "选择路线", note: "对照能力范围" },
  { key: "generate", label: "生成材料", note: "本机测试引擎" },
  { key: "preview", label: "预览与下载", note: "通读后导出" },
];

const STEP_META: Readonly<Record<SelfServiceStep, { title: string; subtitle: string; number: number }>> = Object.freeze({
  upload: { title: "新建申请", subtitle: "材料越多，生成的草稿越具体", number: 1 },
  questions: { title: "补充信息", subtitle: "5 个问题，大多数可以点选", number: 2 },
  route: { title: "选择申请路线", subtitle: "一个案件可以之后增加目标", number: 3 },
  generate: { title: "生成材料", subtitle: "生成结果经你确认后才会进入导出", number: 4 },
  preview: { title: "材料预览", subtitle: "通读确认后进入导出", number: 5 },
  done: { title: "材料已生成", subtitle: "申请准备材料，不是递交回执", number: 5 },
});

async function loadSelfService(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  requestedTargetId: string | null,
  step: SelfServiceStep,
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
  let risks: readonly RiskDTO[] = [];
  if (target !== null && step === "preview") {
    const workspace = await loadWorkspace(
      repository,
      actor,
      matterId,
      target.id,
      R1_RULE_PACK,
      R1_ACTIVE_RULE_PACK_VERSION,
      () => new Date().toISOString(),
    );
    if (workspace.ok) risks = workspace.data.risks;
  }
  return {
    ok: true,
    data: { matter: loaded.data.data.matter, intake: intake.view, targets: targets.view, target, targetRecord, risks },
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
  const [riskSheetOpen, setRiskSheetOpen] = useState(false);
  const refreshAfterAdoption = useCallback(() => setRefreshToken((value) => value + 1), []);
  const targetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    // A refresh keeps the current panel mounted; only the first load blanks it.
    setState((previous) => (previous.phase === "ready" ? previous : { phase: "loading" }));
    void loadSelfService(repository, actor, matterId, requestedTargetId, step).then((result) => {
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

  if (state.phase === "loading") return <SelfServiceLoading message="正在读取本机案件和已保存进度…" />;
  if (state.phase === "unavailable") return <SelfServiceUnavailable />;
  if (state.phase === "failed") {
    return (
      <main className="main" data-testid="self-service-error">
        <Body><Pane>
          <Callout tone="warn" icon="alert"><b>案件没有保存成功</b><p>{state.message}</p></Callout>
        </Pane></Body>
      </main>
    );
  }

  const { data } = state;
  const allowedStep = requiredSelfServiceStep(step, data);
  if (allowedStep !== step) {
    const next = `${selfServicePath(matterId, allowedStep)}${targetQuery(data.target?.id ?? null)}`;
    return <SelfServiceLoading redirectTo={next} replace message="正在回到需要的步骤…" />;
  }
  const questionIndex = resolveQuestionIndex(data.intake, questionParam);
  const meta = STEP_META[step];
  const routeLabel = data.target?.config
    ? data.targets.routeCards.find((card) => card.route === data.target!.config!.route)?.label ?? "已选择路线"
    : null;

  if (step === "preview" && data.target) {
    const riskCount = data.risks.filter((risk) => risk.category === "risk" || risk.category === "blocker").length;
    return (
      <main className="main" data-testid="self-service" data-step="preview" data-matter-id={matterId}>
        <Toolbar
          title="材料预览"
          subtitle={`${routeLabel ?? "未选择路线"} · 草稿修订`}
          right={<>
            <Button icon="alert" onClick={() => setRiskSheetOpen(true)} data-testid="self-preview-risks">
              风险与建议{riskCount > 0 ? <span className="badge">{riskCount}</span> : null}
            </Button>
            <Button onClick={() => goToStep("questions", data.target!.id)} data-testid="self-preview-modify">
              修改材料
            </Button>
            <Button to={v6Path({ kind: "matter", matterId, targetId: data.target.id, tab: "draft" })} data-testid="self-preview-draft">
              进入专业草稿
            </Button>
            <Button variant="primary" icon="download" onClick={() => goToStep("done", data.target!.id)} data-testid="self-preview-download">
              下载材料
            </Button>
          </>}
        />
        <Body><Pane width="wide">
          <div data-testid="self-preview-step">
          <ErrorBoundary area="预览" resetKey={`${matterId}/preview`}>
            <Preview
              repository={repository}
              actor={actor}
              matterId={matterId}
              targetId={data.target.id}
              access="local_unmetered"
              risks={data.risks}
              hideActions
              onModifyMaterials={() => goToStep("questions", data.target!.id)}
              onOpenDraft={() => navigate(v6Path({ kind: "matter", matterId, targetId: data.target!.id, tab: "draft" }))}
            />
          </ErrorBoundary>
          </div>
        </Pane></Body>
        {riskSheetOpen ? (
          <Sheet
            title="风险与建议"
            subtitle={riskCount > 0 ? `当前 ${riskCount} 项，需要你判断；阻断只用于产品能确定的情形。` : "当前没有已记录风险。"}
            onClose={() => setRiskSheetOpen(false)}
            footer={<Button onClick={() => setRiskSheetOpen(false)}>知道了</Button>}
          >
            {riskCount === 0 ? <p className="muted">没有已记录的风险。</p> : (
              <div className="risklist">
                {data.risks.map((risk) => {
                  const presentation = riskPresentation(risk.category);
                  return (
                    <div className="riskitem" key={risk.id} data-testid={`self-preview-risk-${risk.id}`}>
                      <span className="stx"><span className={`st st-${riskTone(risk.category)}`} aria-hidden="true">{presentation.shape}</span></span>
                      <div>
                        <div className="ri-t">{presentation.label} · {risk.title}</div>
                        <div className="ri-d">{risk.explanation}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Sheet>
        ) : null}
      </main>
    );
  }

  if (step === "done" && data.target?.config) {
    return (
      <main className="main" data-testid="self-service" data-step="done" data-matter-id={matterId}>
        <Toolbar
          title="材料已生成"
          subtitle="准备下载"
          right={<>
            <Button to={`${selfServicePath(matterId, "preview")}${targetQuery(data.target.id)}`}>返回预览</Button>
            <Button to={v6Path({ kind: "start" })}>回到首页</Button>
          </>}
        />
        <Body><Pane width="narrow">
          <div data-testid="self-done-step">
          <ErrorBoundary area="完成" resetKey={`${matterId}/done`}>
            <DeliveryWorkspace
              repository={repository}
              actor={actor}
              matterId={matterId}
              targetId={data.target.id}
              rulePack={R1_RULE_PACK}
              rulePackVersion={R1_ACTIVE_RULE_PACK_VERSION}
              confirmationMode="self_read"
            />
          </ErrorBoundary>
          </div>
        </Pane></Body>
      </main>
    );
  }

  return (
    <main className="main" data-testid="self-service" data-step={step} data-matter-id={matterId}>
      <Toolbar
        title={meta.title}
        subtitle={meta.subtitle}
        back={{ to: v6Path({ kind: "start" }), label: "返回首页" }}
        right={<span className="small muted">第 {meta.number} 步，共 5 步</span>}
      />
      <div className="wizard">
        <aside className="wiz-rail" aria-label="自助申请步骤">
          <div className="wr-title">自助申请</div>
          {STEPS.map((item, index) => {
            const number = index + 1;
            const className = number < meta.number ? "wiz-step done" : number === meta.number ? "wiz-step cur" : "wiz-step";
            return (
              <div key={item.key} className={className} aria-current={number === meta.number ? "step" : undefined}>
                <span className="n">{number < meta.number ? "✓" : number}</span>
                <div>{item.label}<div className="small muted">{item.note}</div></div>
              </div>
            );
          })}
          <div className="wr-case">
            <b>正在准备</b>
            {data.matter.title}
            <br />
            {routeLabel ?? "尚未选择路线"}
          </div>
        </aside>
        <div className="wiz-main">
          <div className="wiz-card" onClickCapture={(event) => interceptProductLink(event, navigate)}>
            <ErrorBoundary area="自助步骤" resetKey={`${matterId}/${step}/${questionIndex}`}>
              {step === "upload" ? (
                <UploadStep
                  repository={repository}
                  actor={actor}
                  matterId={matterId}
                  intake={data.intake}
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
                <section className="gen-wrap" data-testid="self-generation">
                  <GenerationPanel
                    repository={repository}
                    actor={actor}
                    matterId={matterId}
                    targetId={data.target.id}
                    engineOptions={LOCAL_TEST_GENERATION_OPTIONS}
                    onAdopted={refreshAfterAdoption}
                  />
                  <div className="wiz-foot">
                    <Button to={`${selfServicePath(matterId, "route")}${targetQuery(data.target.id)}`}>上一步</Button>
                    <span className="hint">{data.targetRecord?.draftRevisionId == null
                      ? "只有采纳草稿修订后才能查看材料。"
                      : "已采纳修订；预览和导出会使用这份修订。"}</span>
                    <Button
                      variant="primary"
                      size="lg"
                      disabled={data.targetRecord?.draftRevisionId == null}
                      onClick={() => goToStep("preview", data.target!.id)}
                      data-testid="self-view-draft"
                    >
                      查看材料<Icon name="arrow" size="sm" />
                    </Button>
                  </div>
                </section>
              ) : null}
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </main>
  );
}

function UploadStep({
  repository,
  actor,
  matterId,
  intake,
  parseRefresh,
  onSaved,
  onQuestions,
}: {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  intake: IntakeView;
  parseRefresh: number;
  onSaved: () => void;
  onQuestions: () => void;
}) {
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [noDocumentNotice, setNoDocumentNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = state.phase === "saving";
  const pendingCount = pendingForSave(state).length;
  const view = describeUploadRows(rowsFromItems(state.items));

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
      setNoDocumentNotice("已选择文件。先保存文件，或使用下方主按钮保留当前案件材料。");
      return;
    }
    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) {
      setNoDocumentNotice("无法确认本案材料状态。请重试读取，或使用下方主按钮。");
      return;
    }
    if (loaded.data.data.assets.some((asset) => asset.purpose === "source")) {
      setNoDocumentNotice("本案已有材料。使用下方主按钮进入问答；已有文件会保留，不会生成虚拟附件。");
      return;
    }
    onQuestions();
  };

  return (
    <div data-testid="self-upload-step">
      <h1 className="wiz-h1">先把资料放进来</h1>
      <p className="wiz-sub">有什么传什么：技术交底、产品说明、图纸、照片、实验记录都行。缺的部分后面用问题补。</p>
      <div className="wiz-sec">
        <label
          className="dropzone"
          data-testid="upload-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            addFiles(Array.from(event.dataTransfer?.files ?? []));
          }}
        >
          <input
            type="file"
            multiple
            data-testid="upload-input"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
            onChange={(event) => {
              const picked = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              addFiles(picked);
            }}
          />
          <span className="dz-i"><Icon name="upload" size="lg" /></span>
          <span className="dz-1">拖入文件，或点击选择</span>
          <span className="dz-2">PDF、Word、图片、表格、纯文本，单个不超过 50 MB</span>
          <span className="dz-3">
            <span><Icon name="lock" size="sm" /> 文件只在本机保存</span>
            <span><Icon name="spark" size="sm" /> 扫描件会先检查文字层</span>
          </span>
        </label>
        <div className="rowgap" style={{ marginTop: 10 }}>
          <button type="button" className="link small" data-testid="answer-without-documents" onClick={() => void answerWithoutDocuments()}>
            没有现成文档，直接回答问题
          </button>
          <span className="small muted">或先保存已选择的文件</span>
        </div>

        {view.rows.length > 0 ? (
          <div className="card pad0" style={{ marginTop: 12 }} data-testid="upload-rows">
            <div style={{ padding: "4px 14px" }}>
              {view.rows.map((row) => (
                <div className="filerow" key={row.fileId} data-testid={`upload-row-${row.fileId}`} data-stage={row.stage} data-saved={row.saved ? "true" : "false"}>
                  <span className="file-ic"><Icon name={fileIcon(row.name)} /></span>
                  <div className="grow">
                    <div className="fr-n">{row.name}</div>
                    <div className="fr-m">{row.label}</div>
                    {!row.saved ? (
                      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.fraction * 100)} aria-label={`${row.name}：${row.label}`}>
                        <div className="bar" style={{ width: `${Math.round(row.fraction * 100)}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <span data-testid={`upload-status-${row.fileId}`} className={row.error !== null ? "tag risk" : row.saved ? "tag ok" : "tag plain"}>
                    {row.label}
                  </span>
                  {row.canRemove ? (
                    <span className="fr-x">
                      <button
                        type="button"
                        className="btn ghost icon"
                        data-testid={`upload-remove-${row.fileId}`}
                        disabled={busy}
                        aria-label={`移除 ${row.name}`}
                        onClick={() => dispatch({ type: "remove", fileId: row.fileId })}
                      >
                        <Icon name="x" size="sm" />
                      </button>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {view.hasProblems ? (
          <Callout tone="warn" icon="alert" testId="upload-problems">
            有文件没有保存，它们不会成为案件材料；请移除后换一个文件。
          </Callout>
        ) : null}
        {state.batchError ? <Callout tone="warn" icon="alert" testId="upload-batch-error">{state.batchError}</Callout> : null}
        {view.allSaved ? <p className="small muted" role="status" aria-live="polite" data-testid="upload-all-saved">材料已保存在本机。可以继续添加，或进入下一步整理。</p> : null}
      </div>

      <Callout tone="info" icon="shield">
        <b>关于保密。</b>文件只保存在这台设备，不会上传到服务器；解析也在本机完成。
      </Callout>

      <div className="wiz-sec">
        <Parse repository={repository} actor={actor} matterId={matterId} refreshToken={parseRefresh} onAddDocuments={() => document.querySelector<HTMLInputElement>("[data-testid='upload-input']")?.click()} />
      </div>

      {intake.chunks.length > 0 ? (
        <div className="extract" data-testid="upload-extract">
          <div className="ex"><div className="n">{intake.chunks.length}</div><div className="l">材料段落</div><div className="d">本机解析出的可引用段落</div></div>
          <div className="ex"><div className="n">{intake.facts.length}</div><div className="l">已保存事实</div><div className="d">答案和确认会写入事实版本</div></div>
          <div className="ex"><div className="n">{intake.missing.length}</div><div className="l">待补充</div><div className="d">五题中还缺的回答</div></div>
        </div>
      ) : null}

      {noDocumentNotice ? <Callout tone="info" icon="info">{noDocumentNotice}</Callout> : null}

      <div className="wiz-foot">
        <span className="hint">{pendingCount > 0 ? `已添加 ${view.rows.length} 个文件，先保存再继续` : view.rows.length > 0 ? `已保存 ${view.rows.length} 个文件` : "没有文档也可以直接回答问题"}</span>
        {pendingCount > 0 ? (
          <button type="button" className="btn primary lg" data-testid="upload-save" disabled={busy} onClick={() => void save()}>
            {busy ? "正在保存…" : `保存 ${pendingCount} 个文件`}
          </button>
        ) : (
          <button type="button" className="btn primary lg" data-testid="upload-continue" disabled={busy} onClick={onQuestions}>
            回答问题<Icon name="arrow" size="sm" />
          </button>
        )}
        {busy ? (
          <button type="button" className="btn ghost" data-testid="upload-cancel" onClick={() => abortRef.current?.abort()}>取消</button>
        ) : null}
      </div>
    </div>
  );
}

function fileIcon(name: string): "doc" | "img" {
  return /\.(png|jpe?g|webp)$/i.test(name) ? "img" : "doc";
}

function SelfServiceLoading({ message, redirectTo, replace = false }: { message: string; redirectTo?: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (redirectTo) navigate(redirectTo, { replace });
  }, [navigate, redirectTo, replace]);
  return (
    <main className="main" aria-busy="true" data-testid="self-service-loading">
      <Body><Pane>
        <p className="muted">{message}</p>
        <div className="skeleton v6-skeleton" />
      </Pane></Body>
    </main>
  );
}

function SelfServiceUnavailable() {
  return (
    <main className="main" data-testid="self-service-unavailable">
      <Body><Pane>
        <Callout tone="warn" icon="alert">
          <b>案件不可用</b>
          <p>案件不存在，或当前本机用户无权查看。</p>
          <Button to={v6Path({ kind: "matters" })}>返回案件列表</Button>
        </Callout>
      </Pane></Body>
    </main>
  );
}

function riskTone(category: RiskDTO["category"]): "risk" | "warn" | "idle" | "ai" {
  return category === "blocker" ? "risk" : category === "risk" ? "warn" : category === "unverified" ? "idle" : "ai";
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
