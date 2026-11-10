import React, { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent, CSSProperties } from "react";
import type { RiskDTO, SectionKind } from "../../../../../../packages/contracts/src/index.ts";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import {
  confirmLocalFullRead,
  loadLocalPreview,
  PREVIEW_SECTION_LABELS,
  riskPresentation,
  LOCKED_SECTION_KINDS,
  type LocalPreviewLoad,
  type PreviewLoadReady,
} from "./preview.ts";
import { v6Path } from "../../routes/navigation.ts";
import { TestOutputNotice } from "../../components/TestOutputNotice.tsx";

export interface PreviewProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string;
  /** The content access decision made by the caller for this matter. */
  access: "preview" | "full" | "local_unmetered";
  /** Risks from the current check; locked anchors carry no paragraph body. */
  risks?: readonly RiskDTO[];
  onModifyMaterials?: (matterId: string) => void;
  onOpenDraft?: (matterId: string, targetId: string) => void;
  /** Render the test-output callout; set false when an outer wizard already shows it. */
  showTestOutputNotice?: boolean;
  /** Hide the in-page material/draft action row when an outer toolbar owns these actions. */
  hideActions?: boolean;
  onGenerateDraft?: (matterId: string, targetId: string) => void;
  onRegenerate?: (matterId: string, targetId: string) => void;
  onAdoptInputs?: (matterId: string, targetId: string) => void;
}

const NO_RISKS: readonly RiskDTO[] = Object.freeze([]);
const LOADING_SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

/**
 * Read-only preview for one existing matter target. The component never edits
 * the AST; route links and callbacks always retain the supplied matter/target.
 */
export function Preview(props: PreviewProps) {
  const risks = props.risks ?? NO_RISKS;
  const [state, setState] = useState<LocalPreviewLoad>({ kind: "failed", code: "LOADING", message: "" });
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmedRead, setConfirmedRead] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [highlightedAnchor, setHighlightedAnchor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setState({ kind: "failed", code: "LOADING", message: "" });
    void loadLocalPreview(props.repository, props.actor, props.matterId, props.targetId, props.access, risks).then(
      (next) => {
        if (cancelled) return;
        setState(next);
        setLoading(false);
        setConfirmError(null);
      },
      () => {
        if (cancelled) return;
        setState({ kind: "failed", code: "STORAGE_UNAVAILABLE", message: "无法读取本机草稿，请重试。" });
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, [props.repository, props.actor, props.matterId, props.targetId, props.access, risks, reloadKey]);

  if (loading) return <PreviewLoading />;
  if (state.kind === "failed") {
    return <PreviewError code={state.code} message={state.message} onRetry={() => setReloadKey((key) => key + 1)} />;
  }
  if (state.kind === "empty") {
    return <PreviewEmpty {...props} />;
  }

  const ready = state as PreviewLoadReady;
  const snapshot = ready.projection.preview.snapshot;
  const onModifyMaterials = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!props.onModifyMaterials) return;
    event.preventDefault();
    props.onModifyMaterials(props.matterId);
  };
  const onOpenDraft = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!props.onOpenDraft) return;
    event.preventDefault();
    props.onOpenDraft(props.matterId, props.targetId);
  };
  const draftPath = v6Path({ kind: "matter", matterId: props.matterId, targetId: props.targetId, tab: "draft" });
  const regenerate = () => {
    if (props.onRegenerate) props.onRegenerate(props.matterId, props.targetId);
    else navigateToV6(draftPath);
  };
  const adoptInputs = () => {
    if (props.onAdoptInputs) props.onAdoptInputs(props.matterId, props.targetId);
    else navigateToV6(draftPath);
  };
  const confirmRead = async () => {
    if (!confirmedRead || !ready.isCurrent || ready.projection.fullDraft === null || confirming) return;
    setConfirming(true);
    setConfirmError(null);
    const result = await confirmLocalFullRead({
      repository: props.repository,
      actor: props.actor,
      snapshot,
      access: props.access,
    });
    if (!result.ok) {
      setConfirming(false);
      setConfirmError(`${result.error.message}（${result.error.code}）`);
      return;
    }
    const refreshed = await loadLocalPreview(
      props.repository, props.actor, props.matterId, props.targetId, props.access, risks,
    );
    setConfirming(false);
    setConfirmedRead(false);
    setState(refreshed);
    if (refreshed.kind === "ready" && refreshed.confirmation === null) {
      setConfirmError("通读确认已失效，请重新读取并核对当前稿件。");
    }
  };

  return (
    <main className="v6-page" data-testid="preview" data-preview-access={props.access}>
      <div className="preview-head">
        <div>
          <div className="ph-t">{displayDraftTitle(ready)}</div>
          <div className="ph-s">{ready.projection.preview.language === "zh-CN" ? "中文底稿" : "Draft"} · 权利要求 {ready.projection.preview.claims.length} 项
            {props.access === "local_unmetered" ? <span data-testid="preview-local-label"> · 本地完整预览，未接入付费</span> : null}
          </div>
        </div>
        <div className="preview-flag" style={{ marginLeft: "auto" }}>
          <span className="tag ok">只读预览</span>
          <span className="tag plain">未正式递交</span>
        </div>
      </div>
      {props.showTestOutputNotice === false ? null : <TestOutputNotice revision={ready.revision.revision} testId="preview-test-output" />}

      {ready.projection.preview.inputStale ? (
        <div className="notice" role="status" data-testid="preview-stale" data-stale-kind="input">
          <strong>材料已更新</strong>
          <p>草稿基于事实版本 {ready.revision.revision.input.sourceVersion}，当前为 {ready.currentSourceVersion}。{ready.revision.revision.input.targetConfigVersion !== ready.currentTargetConfigVersion || ready.revision.revision.input.figureRevisionId !== ready.currentFigureRevisionId ? "目标配置或附图版本也已变化。" : ""}</p>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={regenerate}>{props.onRegenerate ? "重新生成" : "前往草稿页生成"}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={adoptInputs}>{props.onAdoptInputs ? "核对后采纳新输入" : "前往草稿页核对输入"}</button>
          </div>
        </div>
      ) : !ready.isCurrent ? (
        <div className="notice" role="status" data-testid="preview-stale" data-stale-kind="revision">
          <strong>有更新修订</strong>
          <p>当前预览对应的修订已变化，请重新读取后核对。</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setReloadKey((key) => key + 1)}>重新读取</button>
        </div>
      ) : null}

      {props.hideActions ? null : <PreviewActions
        matterId={props.matterId}
        targetId={props.targetId}
        onModifyMaterials={onModifyMaterials}
        onOpenDraft={onOpenDraft}
      />}

      <PreviewContents
        ready={ready}
        highlightedAnchor={highlightedAnchor}
        onLocate={(risk) => locateRisk(risk, props.access, setHighlightedAnchor)}
      />

      {ready.confirmation ? (
        <div className="callout ok" role="status" data-testid="preview-confirmed">
          已通读确认 · 本机用户 · {formatTime(ready.confirmation.createdAt)}
          <details className="tech"><summary>技术详情</summary><code>actorId：{ready.confirmation.actorId}</code></details>
        </div>
      ) : ready.projection.fullDraft !== null && ready.isCurrent ? (
        <section className="group" aria-labelledby="preview-confirm-title" data-testid="preview-confirmation">
          <div className="row"><div className="r-main"><div className="r-title" id="preview-confirm-title">通读确认</div>
          <div className="r-sub">确认绑定当前草稿、事实和附图版本；内容变化后需要重新确认。</div></div></div>
          <div className="row">
          <label className="row" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
            <input type="checkbox" checked={confirmedRead} onChange={(event) => setConfirmedRead(event.currentTarget.checked)} />
            <span>已通读权利要求书和说明书，内容与发明一致</span>
          </label>
          <button type="button" className="btn btn-default" disabled={!confirmedRead || confirming} onClick={() => void confirmRead()}>
            {confirming ? "正在保存…" : "确认通读"}
          </button>
          {confirmError ? <p role="alert" data-testid="preview-confirm-error">{confirmError}</p> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

/** Material/draft actions the outer toolbar can render when the page hides its own row. */
export function PreviewActions({ matterId, targetId, onModifyMaterials, onOpenDraft }: {
  matterId: string;
  targetId: string;
  onModifyMaterials?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onOpenDraft?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }} data-testid="preview-actions">
    <a className="btn sm" href={v6Path({ kind: "matter", matterId, targetId: null, tab: "facts" })} onClick={onModifyMaterials}>
      修改材料
    </a>
    <a className="btn primary sm" href={v6Path({ kind: "matter", matterId, targetId, tab: "draft" })} onClick={onOpenDraft}>
      进入专业草稿
    </a>
  </div>;
}

export function PreviewLoading() {
  return (
    <main className="v6-page" aria-busy="true" data-testid="preview-loading" data-preview-state="loading">
      <div className="skeleton v6-skeleton" />
      {LOADING_SKELETON_ROWS.map((row) => <div className="skeleton v6-skeleton" key={row} />)}
    </main>
  );
}

export function PreviewError({ code, message, onRetry }: { code: string; message: string; onRetry: () => void }) {
  return (
    <main className="v6-page" data-testid="preview-error" data-preview-state="error">
      <div className="notice" role="alert">
        <strong>无法读取草稿</strong>
        <p>{message || "正在读取本机草稿…"}{message ? `（${code}）` : ""}</p>
        {message ? <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>重试</button> : null}
      </div>
    </main>
  );
}

export function PreviewEmpty(props: PreviewProps) {
  const draftPath = v6Path({ kind: "matter", matterId: props.matterId, targetId: props.targetId, tab: "draft" });
  return (
    <main className="v6-page" data-testid="preview-empty" data-preview-state="empty">
      <h1 className="v6-title">草稿预览</h1>
      <section className="card stack-3">
        <h2 className="card-title">还没有草稿</h2>
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          {props.onGenerateDraft ? <button type="button" className="btn btn-default" onClick={() => props.onGenerateDraft?.(props.matterId, props.targetId)}>生成草稿</button>
            : <a className="btn btn-default" href={draftPath} data-testid="preview-empty-generate">生成草稿</a>}
          <a className="btn btn-outline" href={draftPath} onClick={(event) => {
            if (!props.onOpenDraft) return;
            event.preventDefault();
            props.onOpenDraft(props.matterId, props.targetId);
          }}>手工撰写</a>
        </div>
      </section>
    </main>
  );
}

export function PreviewContents({
  ready,
  highlightedAnchor,
  onLocate,
}: {
  ready: PreviewLoadReady;
  highlightedAnchor: string | null;
  onLocate: (risk: RiskDTO) => void;
}) {
  const dto = ready.projection.preview;
  const full = ready.projection.fullDraft;
  const riskByNode = new Map<string, RiskDTO[]>();
  for (const risk of dto.risks) {
    if (risk.anchor.nodeId === null || risk.anchor.locked) continue;
    const risks = riskByNode.get(risk.anchor.nodeId) ?? [];
    risks.push(risk);
    riskByNode.set(risk.anchor.nodeId, risks);
  }
  const claimParagraphNumber = new Map<string, string>();
  for (const claim of dto.claims) for (const paragraph of claim.paragraphs) claimParagraphNumber.set(paragraph.id, String(claim.number));
  let sequence = 0;
  const nextNumber = () => `[${String(sequence += 1).padStart(4, "0")}]`;
  const renderParagraph = (paragraph: (typeof dto.technicalField)[number], pno?: string) => {
    const annotations = riskByNode.get(paragraph.id) ?? [];
    const highlighted = highlightedAnchor === `preview-node-${paragraph.id}`;
    return (
      <div
        id={`preview-node-${paragraph.id}`}
        key={paragraph.id}
        className={`para${highlighted ? " key" : ""}${annotations.length ? " flag-warn" : ""}`}
        data-testid={`preview-paragraph-${paragraph.id}`}
        data-highlighted={highlighted ? "true" : undefined}
      >
        <div className="pno">{pno ?? claimParagraphNumber.get(paragraph.id) ?? nextNumber()}</div>
        <div className="ptext">
          {paragraph.origin === "ai" || paragraph.origin === "mixed" ? <span className="tag ai" aria-label="AI 段落">◇ AI</span> : null}
          {pno === undefined ? paragraph.text : paragraph.text.replace(/^\s*\d+\s*[、.．]\s*/, "")}
        </div>
        {annotations.length ? <div className="inline-note warn">
          <b>{annotations[0].title}。</b>{annotations[0].explanation}
          <button type="button" className="link" data-testid={`preview-annotation-${annotations[0].id}`} onClick={() => onLocate(annotations[0])}>
            查看批注
          </button>
        </div> : null}
      </div>
    );
  };
  const sectionParagraphs = new Map<SectionKind, readonly (typeof dto.technicalField)[number][]>();
  if (full) {
    for (const section of full.ast.sections) sectionParagraphs.set(section.kind, section.paragraphs);
  } else {
    sectionParagraphs.set("technical_field", dto.technicalField);
    sectionParagraphs.set("background", dto.background);
  }
  const locked = new Set(dto.lockedSections);
  const sectionOrder: readonly SectionKind[] = [
    "technical_field", "background", "summary", "figures_description", "embodiments", "abstract",
  ];
  const stats = full
    ? `权利要求 ${full.ast.claims.length} 项 · 说明书 ${full.ast.sections.reduce((total, section) => total + section.paragraphs.length, 0)} 段`
    : `权利要求 ${dto.claims.length} 项 · 技术领域与背景`;
  const allRisks = [...dto.risks];
  return (
    <div className="doc-wrap" data-testid="preview-content">
      <div>
        <div className="preview-card">
          <div className="doc">
            <div className="doc-inner">
              <div className="doc-head">
                <div className="doc-kicker">{dto.language === "zh-CN" ? "申请文件 · 中文底稿" : "Draft"}</div>
                <div className="doc-title">{displayDraftTitle(ready)}</div>
                <div className="doc-meta"><span>{stats}</span><span>本页只读</span></div>
              </div>
              <h3>{PREVIEW_SECTION_LABELS.claims}</h3>
              <div id="preview-section-claims" data-testid="preview-section-claims">
                <div data-testid="preview-claims">
                  {dto.claims.map((claim) => (
                    <div key={claim.id} data-testid={`preview-claim-${claim.number}`}>
                      {claim.paragraphs.map((paragraph) => renderParagraph(paragraph, String(claim.number)))}
                      {claim.features.map((feature) => <div className="para" key={feature.id}>
                        <div className="pno" />
                        <div className="ptext" style={{ paddingLeft: 8 }}>{feature.text}</div>
                      </div>)}
                    </div>
                  ))}
                </div>
              </div>
              {sectionOrder.map((kind) => {
                const sectionLocked = locked.has(kind);
                const anchor = `preview-section-${kind}`;
                const highlighted = highlightedAnchor === anchor;
                return (
                  <div key={kind}>
                    <h3 id={anchor} data-testid={`preview-section-${kind}`}
                      data-locked={sectionLocked ? "true" : undefined}
                      data-highlighted={highlighted ? "true" : undefined}
                      className={highlighted ? "key" : undefined}>
                      {PREVIEW_SECTION_LABELS[kind]}
                    </h3>
                    {!sectionLocked ? (sectionParagraphs.get(kind) ?? []).map((paragraph) => renderParagraph(paragraph)) : (
                      <div className="doc-lock">
                        <div className="over">
                          <div className="lt">本节在当前访问范围内未解锁</div>
                          <div className="ls">完整内容需要本地完整访问；未解锁不表示内容通过检查。</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="minihint" style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <span>段落编号在左侧；本页只读，不能编辑。导出前会要求你确认已通读。</span>
        </div>
      </div>
      <aside className="doc-aside" aria-label="页边批注" data-testid="preview-risks">
        {annotationGroups(allRisks).length === 0 ? <div className="small muted">当前没有已记录风险。</div> : <>
          {annotationGroups(allRisks).slice(0, 5).map(({ risk, count }) => {
            const category = riskPresentation(risk.category);
            const anchorLabel = risk.anchor.section === null ? "未指定章节" : PREVIEW_SECTION_LABELS[risk.anchor.section];
            return <div key={risk.id} className={`an${risk.category === "risk" ? " warn" : ""}`} role="button" tabIndex={0}
              style={{ position: "relative", left: "auto", right: "auto", display: "block", width: "100%", marginBottom: 18, border: "none", background: "transparent", textAlign: "left", padding: "6px 8px" }}
              data-testid={`preview-risk-${risk.id}`} onClick={() => onLocate(risk)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onLocate(risk); }}>
              <div className="t">{category.shape} {category.label} · {risk.title}{count > 1 ? ` ×${count}` : ""}</div>
              {anchorLabel} · {risk.explanation}
            </div>;
          })}
          {annotationGroups(allRisks).length > 5 ? <div className="small muted" data-testid="preview-risks-more">
            查看全部 {annotationGroups(allRisks).length} 条（右侧风险列表在前面的段落批注中）
          </div> : null}
        </>}
      </aside>
    </div>
  );
}

function displayDraftTitle(ready: PreviewLoadReady): string {
  const draftTitle = ready.projection.fullDraft?.ast.title?.trim() ?? "";
  const title = ready.projection.preview.title.trim();
  if (title && title !== "未命名案件") return title;
  if (draftTitle && draftTitle !== "未命名案件") return draftTitle;
  return "（未填写发明名称）";
}

function annotationGroups(risks: readonly RiskDTO[]): { risk: RiskDTO; count: number }[] {
  const seen = new Map<string, { risk: RiskDTO; count: number }>();
  for (const risk of risks) {
    if (risk.ruleId.startsWith("coverage/") || /本版未自动检查/.test(risk.explanation)) continue;
    const key = `${risk.ruleId}|${risk.anchor.section ?? ""}|${risk.anchor.nodeId ?? ""}|${risk.title}`;
    const existing = seen.get(key);
    if (existing) existing.count += 1;
    else seen.set(key, { risk, count: 1 });
  }
  return [...seen.values()];
}

function RiskAnnotations({ risks, onLocate }: { risks: readonly RiskDTO[]; onLocate: (risk: RiskDTO) => void }) {
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
      {risks.map((risk) => {
        const category = riskPresentation(risk.category);
        return <button key={risk.id} type="button" className="btn btn-ghost btn-sm" data-testid={`preview-annotation-${risk.id}`} onClick={() => onLocate(risk)}>
          {category.shape} {category.label}
        </button>;
      })}
    </div>
  );
}

const paragraphStyle: CSSProperties = { borderBottom: "1px solid #d8d4cc", padding: "0.75rem 0" };
const highlightStyle: CSSProperties = {
  border: "2px solid #805d2c",
  background: "#f5f0e5",
  padding: "0.75rem",
  scrollMarginTop: "1rem",
};

function locateRisk(risk: RiskDTO, access: PreviewProps["access"], update?: (id: string) => void) {
  const locked = risk.anchor.locked || (access === "preview" && risk.anchor.section !== null
    && risk.anchor.section !== "claims" && LOCKED_SECTION_KINDS.includes(risk.anchor.section));
  const paragraphId = risk.anchor.nodeId === null ? null : `preview-node-${risk.anchor.nodeId}`;
  const sectionId = risk.anchor.section === null ? null : `preview-section-${risk.anchor.section}`;
  const candidate = locked ? sectionId : paragraphId ?? sectionId;
  const fallback = sectionId;
  const targetId = candidate && document.getElementById(candidate) ? candidate : fallback;
  if (!targetId) return;
  update?.(targetId);
  requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: "center", behavior: "smooth" }));
}

function navigateToV6(path: string): void {
  if (typeof window === "undefined") return;
  const marker = window.location.pathname.indexOf("/v6");
  const basePath = marker < 0 ? "" : window.location.pathname.slice(0, marker);
  window.location.assign(`${basePath}${path}`);
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
