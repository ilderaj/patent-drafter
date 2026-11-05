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
  const regenerate = () => {
    if (props.onRegenerate) props.onRegenerate(props.matterId, props.targetId);
    else emit("v6:draft-generate", { matterId: props.matterId, targetId: props.targetId });
  };
  const adoptInputs = () => {
    if (props.onAdoptInputs) props.onAdoptInputs(props.matterId, props.targetId);
    else emit("v6:draft-adopt-inputs", { matterId: props.matterId, targetId: props.targetId });
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
      <header className="stack-2">
        <p className="muted">{ready.projection.preview.title}</p>
        <h1 className="v6-title">草稿预览</h1>
        {props.access === "local_unmetered" ? (
          <p className="field-hint" data-testid="preview-local-label">本地预览，未接入付费</p>
        ) : null}
      </header>

      {ready.projection.preview.inputStale ? (
        <div className="notice" role="status" data-testid="preview-stale" data-stale-kind="input">
          <strong>材料已更新</strong>
          <p>草稿基于事实版本 {ready.revision.revision.input.sourceVersion}，当前为 {ready.currentSourceVersion}。{ready.revision.revision.input.targetConfigVersion !== ready.currentTargetConfigVersion || ready.revision.revision.input.figureRevisionId !== ready.currentFigureRevisionId ? "目标配置或附图版本也已变化。" : ""}</p>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={regenerate}>重新生成</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={adoptInputs}>核对后采纳新输入</button>
          </div>
        </div>
      ) : !ready.isCurrent ? (
        <div className="notice" role="status" data-testid="preview-stale" data-stale-kind="revision">
          <strong>有更新修订</strong>
          <p>当前预览对应的修订已变化，请重新读取后核对。</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setReloadKey((key) => key + 1)}>重新读取</button>
        </div>
      ) : null}

      <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }} data-testid="preview-actions">
        <a className="btn btn-outline btn-sm" href={v6Path({ kind: "matter", matterId: props.matterId, targetId: null, tab: "facts" })} onClick={onModifyMaterials}>
          修改材料
        </a>
        <a className="btn btn-default btn-sm" href={v6Path({ kind: "matter", matterId: props.matterId, targetId: props.targetId, tab: "draft" })} onClick={onOpenDraft}>
          进入专业草稿
        </a>
      </div>

      <PreviewContents
        ready={ready}
        highlightedAnchor={highlightedAnchor}
        onLocate={(risk) => locateRisk(risk, props.access, setHighlightedAnchor)}
      />

      <section className="card stack-3" aria-labelledby="preview-risks-title" data-testid="preview-risks">
        <h2 className="card-title" id="preview-risks-title">风险提示</h2>
        {ready.projection.preview.risks.length === 0 ? (
          <p className="muted">当前没有已记录风险。</p>
        ) : (
          <ul className="stack-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ready.projection.preview.risks.map((risk) => {
              const category = riskPresentation(risk.category);
              const anchorLabel = risk.anchor.section === null
                ? "未指定章节"
                : PREVIEW_SECTION_LABELS[risk.anchor.section];
              return (
                <li key={risk.id}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-testid={`preview-risk-${risk.id}`}
                    onClick={() => locateRisk(risk, props.access, setHighlightedAnchor)}
                    style={{ display: "block", textAlign: "left", whiteSpace: "normal", width: "100%" }}
                  >
                    <span>{category.shape} {category.label}</span>
                    <strong style={{ display: "block", marginTop: "0.25rem" }}>{risk.title}</strong>
                    <span style={{ display: "block", marginTop: "0.25rem" }}>{anchorLabel} · {risk.explanation}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {ready.confirmation ? (
        <p className="notice" role="status" data-testid="preview-confirmed">
          已通读确认 · 本机自报身份 {ready.confirmation.actorId} · {formatTime(ready.confirmation.createdAt)}
        </p>
      ) : ready.projection.fullDraft !== null && ready.isCurrent ? (
        <section className="card stack-3" aria-labelledby="preview-confirm-title" data-testid="preview-confirmation">
          <h2 className="card-title" id="preview-confirm-title">通读确认</h2>
          <label className="row" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
            <input type="checkbox" checked={confirmedRead} onChange={(event) => setConfirmedRead(event.currentTarget.checked)} />
            <span>已通读权利要求书和说明书，内容与发明一致</span>
          </label>
          <button type="button" className="btn btn-default" disabled={!confirmedRead || confirming} onClick={() => void confirmRead()}>
            {confirming ? "正在保存…" : "确认通读"}
          </button>
          {confirmError ? <p role="alert" data-testid="preview-confirm-error">{confirmError}</p> : null}
        </section>
      ) : null}
    </main>
  );
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
  const generate = () => {
    if (props.onGenerateDraft) props.onGenerateDraft(props.matterId, props.targetId);
    else emit("v6:draft-generate", { matterId: props.matterId, targetId: props.targetId });
  };
  return (
    <main className="v6-page" data-testid="preview-empty" data-preview-state="empty">
      <h1 className="v6-title">草稿预览</h1>
      <section className="card stack-3">
        <h2 className="card-title">还没有草稿</h2>
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <button type="button" className="btn btn-default" onClick={generate}>生成草稿</button>
          <a className="btn btn-outline" href={v6Path({ kind: "matter", matterId: props.matterId, targetId: props.targetId, tab: "draft" })} onClick={(event) => {
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
  const renderParagraph = (paragraph: (typeof dto.technicalField)[number]) => {
    const annotations = riskByNode.get(paragraph.id) ?? [];
    const highlighted = highlightedAnchor === `preview-node-${paragraph.id}`;
    return (
      <article
        id={`preview-node-${paragraph.id}`}
        key={paragraph.id}
        data-testid={`preview-paragraph-${paragraph.id}`}
        data-highlighted={highlighted ? "true" : undefined}
        style={highlighted ? highlightStyle : paragraphStyle}
      >
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span>{paragraph.origin === "ai" || paragraph.origin === "mixed" ? <span aria-label="AI 段落" title="AI 段落">◇</span> : null}</span>
          {annotations.length ? <RiskAnnotations risks={annotations} onLocate={onLocate} /> : null}
        </div>
        <p style={{ whiteSpace: "pre-wrap" }}>{paragraph.text}</p>
      </article>
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

  return (
    <div className="stack-3" data-testid="preview-content">
      <section id="preview-section-claims" className="card stack-2" data-testid="preview-section-claims">
        <h2 className="card-title">{PREVIEW_SECTION_LABELS.claims}</h2>
        {dto.claims.map((claim) => (
          <div key={claim.id} data-testid={`preview-claim-${claim.number}`}>
            <h3>权利要求 {claim.number}</h3>
            {claim.paragraphs.map(renderParagraph)}
            {claim.features.map((feature) => <p key={feature.id}>{feature.text}</p>)}
          </div>
        ))}
      </section>
      {sectionOrder.map((kind) => {
        const sectionLocked = locked.has(kind);
        const sectionRisks = dto.risks.filter((risk) => risk.anchor.section === kind && risk.anchor.locked);
        const anchor = `preview-section-${kind}`;
        const highlighted = highlightedAnchor === anchor;
        return (
          <section
            id={anchor}
            key={kind}
            className="card stack-2"
            data-testid={`preview-section-${kind}`}
            data-locked={sectionLocked ? "true" : undefined}
            data-highlighted={highlighted ? "true" : undefined}
            style={highlighted ? highlightStyle : undefined}
            aria-label={sectionLocked ? `${PREVIEW_SECTION_LABELS[kind]}（锁定）` : PREVIEW_SECTION_LABELS[kind]}
          >
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <h2 className="card-title">{PREVIEW_SECTION_LABELS[kind]}</h2>
              {sectionLocked ? <span className="field-hint">锁定</span> : null}
            </div>
            {!sectionLocked ? (sectionParagraphs.get(kind) ?? []).map(renderParagraph) : null}
            {sectionRisks.length ? <RiskAnnotations risks={sectionRisks} onLocate={onLocate} /> : null}
          </section>
        );
      })}
    </div>
  );
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

function emit(name: string, detail: { matterId: string; targetId: string }) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
