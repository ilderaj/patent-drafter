import React, { useEffect, useMemo, useState } from "react";
import {
  SECTION_KINDS,
  sourceSnapshotSchema,
  type DraftAST,
  type DraftRevision,
  type Paragraph,
  type SectionKind,
} from "../../../../../../packages/contracts/src/index.ts";
import type { Fact, TargetConfig } from "../../../../../../packages/contracts/src/matter.ts";
import {
  createGenerationRevisionStore,
  type GenerationRevisionStore,
  type GenerationRevisionView,
} from "../generation/generation.ts";
import { loadTargetsView } from "../targets/targets.ts";
import { readFigureLibrary } from "../sources/drawings.ts";
import {
  buildSupportTable,
  deleteParagraph,
  draftAstToEditorModel,
  editClaim,
  editParagraph,
  editorModelToDraftAst,
  insertParagraph,
  projectDraftExport,
  projectDraftPreview,
  validateEditorModel,
  validateFigureReferences,
  type DraftAstIssue,
  type DraftEditorModel,
  type ParagraphLocation,
  type SupportTableRow,
} from "./ast-adapter.ts";
import type { Actor, LocalRepository, StorageBackend } from "../../lib/repository.ts";
import { STORES } from "../../lib/repository.ts";

const SECTION_LABELS: Readonly<Record<SectionKind, string>> = Object.freeze({
  technical_field: "技术领域",
  background: "背景技术",
  summary: "发明内容",
  figures_description: "附图说明",
  embodiments: "具体实施方式",
  abstract: "摘要",
});

export function pendingAiParagraphIds(
  paragraphs: readonly Paragraph[],
  currentRevisionId: string | null,
  confirmationRevisionId: string | null | undefined,
  confirmedParagraphIds: readonly string[] = [],
  hasUnsavedEdits = false,
): string[] {
  const validForCurrentRevision = currentRevisionId !== null
    && confirmationRevisionId === currentRevisionId
    && !hasUnsavedEdits;
  const confirmed = new Set(validForCurrentRevision ? confirmedParagraphIds : []);
  return paragraphs
    .filter((paragraph) => (paragraph.origin === "ai" || paragraph.origin === "mixed") && !confirmed.has(paragraph.id))
    .map((paragraph) => paragraph.id);
}

export interface DraftEditorEmptyStateProps {
  matterId: string;
  targetId: string;
  onGenerateDraft?: () => void;
  onManualWrite: () => void;
}

export function DraftEditorEmptyState(props: DraftEditorEmptyStateProps) {
  return <section className="card stack-3" data-testid="draft-editor" data-state="empty">
    <h2 className="card-title">专业草稿</h2>
    <p className="muted">此目标还没有草稿。可以生成候选稿，或直接手工撰写。</p>
    <div className="row" style={{ flexWrap: "wrap" }}>
      <button type="button" className="btn btn-default" data-testid="draft-generate" onClick={() => {
        if (props.onGenerateDraft) props.onGenerateDraft();
        else if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("v6:draft-generate", { detail: { matterId: props.matterId, targetId: props.targetId } }));
      }}>生成草稿</button>
      <button type="button" className="btn btn-outline" data-testid="draft-manual" onClick={props.onManualWrite}>手工撰写</button>
    </div>
  </section>;
}

export interface DraftEditorBuffer {
  kind: "draft-editor.buffer";
  matterId: string;
  targetId: string;
  baseRevisionId: string | null;
  model: DraftEditorModel;
  preservedModel?: DraftEditorModel;
  preservedBaseRevisionId?: string | null;
  updatedAt: string;
}

/** IndexedDB buffer surface. Rows are keyed by targetId and baseRevisionId. */
export interface DraftBufferStore {
  loadActive(matterId: string, targetId: string): Promise<DraftEditorBuffer | null>;
  save(buffer: DraftEditorBuffer): Promise<void>;
  delete(matterId: string, targetId: string, baseRevisionId: string | null): Promise<void>;
}

/** Stores unsaved editor models in LocalRepository's existing IndexedDB blobs store. */
export class IndexedDbDraftBufferStore implements DraftBufferStore {
  private readonly backend: StorageBackend;
  private readonly ownerPrefix: string;

  constructor(backend: StorageBackend, actor: Actor) {
    this.backend = backend;
    this.ownerPrefix = `draft-editor/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/`;
  }

  async loadActive(matterId: string, targetId: string): Promise<DraftEditorBuffer | null> {
    return this.backend.transaction("readonly", async (tx) => {
      const activeKey = this.activeKey(targetId);
      const pointer = await tx.get(STORES.blobs, activeKey);
      if (!isRecord(pointer) || pointer.kind !== "draft-editor.active" || typeof pointer.baseRevisionId !== "string" && pointer.baseRevisionId !== null) {
        return null;
      }
      const row = await tx.get(STORES.blobs, this.bufferKey(targetId, pointer.baseRevisionId as string | null));
      if (!isRecord(row) || row.kind !== "draft-editor.buffer" || row.matterId !== matterId || row.targetId !== targetId) return null;
      if (row.baseRevisionId !== pointer.baseRevisionId || !isEditorModel(row.model)) return null;
      if (row.preservedModel !== undefined && !isEditorModel(row.preservedModel)) return null;
      return structuredClone(row as unknown as DraftEditorBuffer);
    });
  }

  async save(buffer: DraftEditorBuffer): Promise<void> {
    await this.backend.transaction("readwrite", async (tx) => {
      await tx.put(STORES.blobs, this.bufferKey(buffer.targetId, buffer.baseRevisionId), structuredClone(buffer));
      await tx.put(STORES.blobs, this.activeKey(buffer.targetId), {
        kind: "draft-editor.active",
        baseRevisionId: buffer.baseRevisionId,
        updatedAt: buffer.updatedAt,
      });
    });
  }

  async delete(matterId: string, targetId: string, baseRevisionId: string | null): Promise<void> {
    await this.backend.transaction("readwrite", async (tx) => {
      await tx.delete(STORES.blobs, this.bufferKey(targetId, baseRevisionId));
      const activeKey = this.activeKey(targetId);
      const pointer = await tx.get(STORES.blobs, activeKey);
      if (isRecord(pointer) && pointer.baseRevisionId === baseRevisionId) await tx.delete(STORES.blobs, activeKey);
      void matterId;
    });
  }

  private activeKey(targetId: string): string {
    return `${this.ownerPrefix}active/${encodeURIComponent(targetId)}`;
  }

  private bufferKey(targetId: string, baseRevisionId: string | null): string {
    return `${this.ownerPrefix}buffer/${encodeURIComponent(targetId)}/${encodeURIComponent(baseRevisionId ?? "empty")}`;
  }
}

export interface DraftEditorError {
  code: string;
  message: string;
  issues: DraftAstIssue[];
}

export interface DraftEditorState {
  phase: "loading" | "ready" | "error";
  error: DraftEditorError | null;
  baseRevision: GenerationRevisionView | null;
  latestRevision: GenerationRevisionView | null;
  baseRevisionId: string | null;
  model: DraftEditorModel | null;
  preservedLocalModel: DraftEditorModel | null;
  preservedBufferBaseRevisionId: string | null | undefined;
  dirty: boolean;
  conflict: boolean;
  saving: boolean;
  notice: string | null;
  inputStale: boolean;
  matterTitle: string;
  facts: Fact[];
  targetConfig: TargetConfig | null;
  currentFigureIds: string[];
  supportRows: SupportTableRow[];
}

export interface DraftEditorSessionOptions {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string;
  revisions?: GenerationRevisionStore;
  bufferStore?: DraftBufferStore;
  newId?: () => string;
  now?: () => string;
}

/**
 * Stateful editor seam used by the component and integration scenarios. It owns
 * buffer recovery, revision CAS, conflict preservation, and schema validation.
 */
export class DraftEditorSession {
  private readonly repository: LocalRepository;
  private readonly actor: Actor;
  private readonly matterId: string;
  private readonly targetId: string;
  private readonly revisions: GenerationRevisionStore;
  private readonly buffers: DraftBufferStore;
  private readonly newId: () => string;
  private readonly now: () => string;
  private state: DraftEditorState;
  private readonly listeners = new Set<(state: DraftEditorState) => void>();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(options: DraftEditorSessionOptions) {
    this.repository = options.repository;
    this.actor = options.actor;
    this.matterId = options.matterId;
    this.targetId = options.targetId;
    this.revisions = options.revisions ?? createGenerationRevisionStore({ repository: options.repository, actor: options.actor });
    this.buffers = options.bufferStore ?? new IndexedDbDraftBufferStore(options.repository.backend, options.actor);
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.state = emptyState();
  }

  getSnapshot(): DraftEditorState {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: DraftEditorState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    await this.loadState();
  }

  async refresh(): Promise<void> {
    await this.persistQueue;
    await this.loadState();
  }

  beginManualDraft(): void {
    if (this.state.latestRevision !== null || this.state.model !== null) return;
    const model: DraftEditorModel = {
      schemaVersion: "draft.v1",
      language: this.state.targetConfig?.language ?? "zh-CN",
      title: this.state.matterTitle,
      claims: [],
      sections: SECTION_KINDS.map((kind) => ({ kind, present: true, paragraphs: [] })),
    };
    this.setState({
      ...this.state,
      phase: "ready",
      model,
      dirty: true,
      conflict: false,
      error: null,
      notice: "手工草稿保存在本机缓冲中；保存后会创建新修订。",
    });
    this.enqueueBuffer(model, null, null, undefined);
  }

  updateModel(model: DraftEditorModel): Promise<void> {
    if (this.state.model === null) return Promise.resolve();
    const baseAst = this.state.baseRevision?.ast ?? null;
    const dirty = baseAst === null
      ? this.state.latestRevision === null
      : JSON.stringify(editorModelToDraftAst(model)) !== JSON.stringify(baseAst);
    this.setState({ ...this.state, model: structuredClone(model), dirty, error: null, notice: null });
    return this.enqueueBuffer(
      model,
      this.state.baseRevisionId,
      this.state.preservedLocalModel,
      this.state.preservedBufferBaseRevisionId,
    );
  }

  updateParagraph(location: ParagraphLocation, paragraphIndex: number, text: string): Promise<void> {
    if (!this.state.model) return Promise.resolve();
    return this.updateModel(editParagraph(this.state.model, location, paragraphIndex, text));
  }

  addParagraph(location: ParagraphLocation, afterIndex: number): Promise<void> {
    if (!this.state.model) return Promise.resolve();
    return this.updateModel(insertParagraph(this.state.model, location, afterIndex, this.newId));
  }

  removeParagraph(location: ParagraphLocation, paragraphIndex: number): Promise<void> {
    if (!this.state.model) return Promise.resolve();
    return this.updateModel(deleteParagraph(this.state.model, location, paragraphIndex));
  }

  updateClaimField(claimId: string, change: Partial<Pick<DraftAST["claims"][number], "number" | "dependsOn">>): Promise<void> {
    if (!this.state.model) return Promise.resolve();
    return this.updateModel(editClaim(this.state.model, claimId, change));
  }

  /** Start a manual merge on the latest head while keeping the old local buffer visible. */
  async startMerge(): Promise<void> {
    const latest = this.state.latestRevision;
    const local = this.state.model;
    if (!latest || !local || !this.state.conflict) return;
    const previousBaseId = this.state.baseRevisionId;
    const latestModel = draftAstToEditorModel(latest.ast);
    this.setState({
      ...this.state,
      phase: "ready",
      baseRevision: latest,
      baseRevisionId: latest.revision.id,
      model: latestModel,
      preservedLocalModel: local,
      preservedBufferBaseRevisionId: previousBaseId,
      dirty: false,
      conflict: false,
      error: null,
      notice: "最新修订已作为合并基准；本机草稿仍显示在下方，请手工合并后保存。",
    });
    await this.enqueueBuffer(latestModel, latest.revision.id, local, previousBaseId);
  }

  async save(): Promise<DraftRevision | null> {
    await this.persistQueue;
    if (!this.state.model || !this.state.dirty || this.state.conflict || this.state.saving) {
      return this.state.baseRevision?.revision as DraftRevision | null;
    }
    if (this.state.inputStale) {
      this.setState({
        ...this.state,
        error: {
          code: "INPUT_STALE",
          message: "草稿依据的输入已变化。核对后采纳新输入的操作不属于本编辑器；本机缓冲已保留，尚未保存。",
          issues: [],
        },
      });
      return null;
    }
    const context = await this.refreshValidationContext();
    if (context.error) {
      this.setState({ ...this.state, phase: "ready", error: context.error, notice: null });
      return null;
    }
    const validation = validateEditorModel(this.state.model);
    if (!validation.ok) {
      this.setState({
        ...this.state,
        phase: "ready",
        error: { code: "INVALID_AST", message: "编辑内容不符合 DraftAST 结构，请修复标记的节点。", issues: validation.issues },
        notice: null,
      });
      return null;
    }

    const figureIssues = validateFigureReferences(validation.ast, context.figureIds);
    if (figureIssues.length > 0) {
      this.setState({
        ...this.state,
        phase: "ready",
        error: { code: "INVALID_AST", message: "正文引用了不属于当前图集的图号。", issues: figureIssues },
        notice: null,
      });
      return null;
    }

    const baseRevisionId = this.state.baseRevisionId;
    this.setState({ ...this.state, saving: true, error: null, notice: null });
    const saved = await this.revisions.saveEditedRevision(this.matterId, this.targetId, baseRevisionId, validation.ast);
    if (!saved.ok) {
      if (saved.error.code === "VERSION_CONFLICT") {
        const latest = await this.revisions.loadHeadRevision(this.matterId, this.targetId);
        this.setState({
          ...this.state,
          phase: latest.ok ? "ready" : "error",
          saving: false,
          conflict: true,
          latestRevision: latest.ok ? latest.data : this.state.latestRevision,
          error: {
            code: "VERSION_CONFLICT",
            message: latest.ok
              ? "基础修订已变化。本机缓冲已保留，请比较两份稿件并手工合并。"
              : latest.error.message,
            issues: [],
          },
        });
        return null;
      }
      const refusedValidation = saved.error.code === "INVALID_AST" && this.state.model
        ? validateEditorModel(this.state.model)
        : null;
      this.setState({
        ...this.state,
        phase: "ready",
        saving: false,
        error: {
          code: saved.error.code,
          message: saved.error.message,
          issues: refusedValidation && !refusedValidation.ok ? refusedValidation.issues : [],
        },
      });
      return null;
    }

    const priorBufferBaseId = this.state.preservedBufferBaseRevisionId;
    const view: GenerationRevisionView = { revision: saved.data, ast: structuredClone(saved.data.ast) };
    this.setState({
      ...this.state,
      phase: "ready",
      error: null,
      baseRevision: view,
      latestRevision: view,
      baseRevisionId: saved.data.id,
      model: draftAstToEditorModel(saved.data.ast),
      preservedLocalModel: null,
      preservedBufferBaseRevisionId: undefined,
      dirty: false,
      conflict: false,
      saving: false,
      inputStale: false,
      notice: `已保存新修订 ${saved.data.id}。`,
      supportRows: buildSupportTable(saved.data.ast, this.state.facts, this.state.targetConfig?.priorityClaims ?? []),
    });
    try {
      await this.buffers.delete(this.matterId, this.targetId, baseRevisionId);
      if (priorBufferBaseId !== undefined && priorBufferBaseId !== baseRevisionId) {
        await this.buffers.delete(this.matterId, this.targetId, priorBufferBaseId);
      }
    } catch {
      this.setState({ ...this.state, notice: "修订已保存；本机旧缓冲未能清理。" });
    }
    return saved.data as DraftRevision;
  }

  private async loadState(): Promise<void> {
    this.setState({ ...this.state, phase: "loading", error: null, notice: null });
    try {
      const [headResult, matterResult, targetsResult, activeBuffer] = await Promise.all([
        this.revisions.loadHeadRevision(this.matterId, this.targetId),
        this.repository.loadMatter(this.actor, this.matterId),
        loadTargetsView(this.repository, this.actor, this.matterId),
        this.buffers.loadActive(this.matterId, this.targetId),
      ]);
      if (!headResult.ok) throw Object.assign(new Error(headResult.error.message), { code: headResult.error.code });
      if (!matterResult.ok) throw Object.assign(new Error(matterResult.error.message), { code: matterResult.error.code });
      if (!targetsResult.ok) throw Object.assign(new Error(targetsResult.error.message), { code: targetsResult.error.code });
      const aggregate = matterResult.data.data;
      const target = aggregate.targets.find((item) => item.id === this.targetId);
      if (!target) throw Object.assign(new Error("目标不可用。"), { code: "RESOURCE_NOT_FOUND" });
      const targetConfig = targetsResult.view.targets.find((item) => item.id === this.targetId)?.config ?? null;
      const figureRead = await readFigureLibrary(this.repository, this.actor, this.matterId);
      if (!figureRead.ok) throw Object.assign(new Error(figureRead.error.message), { code: figureRead.error.code });
      const currentFigureIds = figureRead.data.current.get(this.targetId)?.entries.map((entry) => entry.figureId) ?? [];
      const latest = headResult.data;
      let base: GenerationRevisionView | null = latest;
      let baseRevisionId = latest?.revision.id ?? null;
      let model = latest ? draftAstToEditorModel(latest.ast) : null;
      let preservedLocalModel: DraftEditorModel | null = null;
      let preservedBufferBaseRevisionId: string | null | undefined;
      let dirty = false;
      let conflict = false;

      if (activeBuffer) {
        baseRevisionId = activeBuffer.baseRevisionId;
        if (baseRevisionId === null) base = null;
        else if (latest?.revision.id === baseRevisionId) base = latest;
        else {
          const loadedBase = await this.revisions.loadRevision(this.matterId, this.targetId, baseRevisionId);
          base = loadedBase.ok ? loadedBase.data : null;
        }
        model = structuredClone(activeBuffer.model);
        preservedLocalModel = activeBuffer.preservedModel ? structuredClone(activeBuffer.preservedModel) : null;
        preservedBufferBaseRevisionId = activeBuffer.preservedBaseRevisionId;
        conflict = (latest?.revision.id ?? null) !== baseRevisionId;
        dirty = conflict || base === null
          ? model !== null
          : JSON.stringify(editorModelToDraftAst(model as DraftEditorModel)) !== JSON.stringify(base.ast);
      }

      const inputSourceVersion = base?.revision.input.sourceVersion ?? aggregate.matter.sourceVersion;
      const rawSnapshot = await this.repository.backend.transaction("readonly", (tx) =>
        tx.get(STORES.blobs, `intake/snapshot/${this.matterId}/${inputSourceVersion}`),
      );
      let facts: Fact[] = [];
      if (isRecord(rawSnapshot) && rawSnapshot.kind === "intake.snapshot") {
        const parsedSnapshot = sourceSnapshotSchema.safeParse(rawSnapshot.snapshot);
        if (parsedSnapshot.success && parsedSnapshot.data.matterId === this.matterId
          && parsedSnapshot.data.version === inputSourceVersion) facts = parsedSnapshot.data.facts;
      }
      const revisionInput = base?.revision.input;
      const inputStale = revisionInput !== undefined && (
        revisionInput.sourceVersion !== aggregate.matter.sourceVersion
        || revisionInput.targetConfigVersion !== target.configVersion
        || revisionInput.figureRevisionId !== target.figureRevisionId
      );
      const supportAst = model ? editorModelToDraftAst(model) : latest?.ast;
      this.setState({
        phase: "ready",
        error: conflict ? {
          code: "VERSION_CONFLICT",
          message: "发现比本机草稿更新的修订。本机缓冲已保留，请比较并合并。",
          issues: [],
        } : null,
        baseRevision: base,
        latestRevision: latest,
        baseRevisionId,
        model,
        preservedLocalModel,
        preservedBufferBaseRevisionId,
        dirty,
        conflict,
        saving: false,
        notice: null,
        inputStale,
        matterTitle: aggregate.matter.title,
        facts,
        targetConfig,
        currentFigureIds,
        supportRows: supportAst ? buildSupportTable(supportAst, facts, targetConfig?.priorityClaims ?? []) : [],
      });
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : "STORAGE_UNAVAILABLE";
      const message = error instanceof Error ? error.message : "草稿读取失败。";
      this.setState({ ...this.state, phase: "error", error: { code, message, issues: [] }, saving: false });
    }
  }

  private async refreshValidationContext(): Promise<{ error: DraftEditorError | null; figureIds: Set<string> }> {
    try {
      const [matterResult, figureRead] = await Promise.all([
        this.repository.loadMatter(this.actor, this.matterId),
        readFigureLibrary(this.repository, this.actor, this.matterId),
      ]);
      if (!matterResult.ok) {
        return { error: { code: matterResult.error.code, message: matterResult.error.message, issues: [] }, figureIds: new Set() };
      }
      if (!figureRead.ok) {
        return { error: { code: figureRead.error.code, message: figureRead.error.message, issues: [] }, figureIds: new Set() };
      }
      const aggregate = matterResult.data.data;
      const target = aggregate.targets.find((item) => item.id === this.targetId);
      if (!target) return { error: { code: "RESOURCE_NOT_FOUND", message: "目标不可用。", issues: [] }, figureIds: new Set() };
      const figureIds = new Set(figureRead.data.current.get(this.targetId)?.entries.map((entry) => entry.figureId) ?? []);
      const input = this.state.baseRevision?.revision.input;
      const inputStale = input !== undefined && (
        input.sourceVersion !== aggregate.matter.sourceVersion
        || input.targetConfigVersion !== target.configVersion
        || input.figureRevisionId !== target.figureRevisionId
      );
      this.setState({ ...this.state, currentFigureIds: [...figureIds], inputStale });
      return inputStale
        ? { error: {
            code: "INPUT_STALE",
            message: "草稿依据的事实、目标配置或图集版本已变化。核对后采纳新输入的操作不属于本编辑器；本机缓冲已保留。",
            issues: [],
          }, figureIds }
        : { error: null, figureIds };
    } catch (error) {
      return {
        error: {
          code: "STORAGE_UNAVAILABLE",
          message: error instanceof Error ? error.message : "无法核对当前图集。",
          issues: [],
        },
        figureIds: new Set(),
      };
    }
  }

  private enqueueBuffer(
    model: DraftEditorModel,
    baseRevisionId: string | null,
    preservedModel: DraftEditorModel | null,
    preservedBaseRevisionId: string | null | undefined,
  ): Promise<void> {
    const buffer: DraftEditorBuffer = {
      kind: "draft-editor.buffer",
      matterId: this.matterId,
      targetId: this.targetId,
      baseRevisionId,
      model: structuredClone(model),
      ...(preservedModel ? {
        preservedModel: structuredClone(preservedModel),
        preservedBaseRevisionId: preservedBaseRevisionId ?? null,
      } : {}),
      updatedAt: this.now(),
    };
    this.persistQueue = this.persistQueue.then(async () => {
      try {
        await this.buffers.save(buffer);
      } catch (error) {
        this.setState({
          ...this.state,
          error: {
            code: "STORAGE_UNAVAILABLE",
            message: error instanceof Error ? error.message : "本机草稿缓冲保存失败。",
            issues: [],
          },
        });
      }
    });
    return this.persistQueue;
  }

  private setState(state: DraftEditorState): void {
    this.state = state;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}

function emptyState(): DraftEditorState {
  return {
    phase: "loading",
    error: null,
    baseRevision: null,
    latestRevision: null,
    baseRevisionId: null,
    model: null,
    preservedLocalModel: null,
    preservedBufferBaseRevisionId: undefined,
    dirty: false,
    conflict: false,
    saving: false,
    notice: null,
    inputStale: false,
    matterTitle: "",
    facts: [],
    targetConfig: null,
    currentFigureIds: [],
    supportRows: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEditorModel(value: unknown): value is DraftEditorModel {
  if (!isRecord(value) || value.schemaVersion !== "draft.v1" || typeof value.title !== "string"
    || (value.language !== "zh-CN" && value.language !== "en-US") || !Array.isArray(value.claims) || !Array.isArray(value.sections)) return false;
  if (!value.claims.every((claim) => isRecord(claim) && typeof claim.id === "string" && typeof claim.number === "number"
    && Array.isArray(claim.dependsOn) && Array.isArray(claim.paragraphs) && Array.isArray(claim.features))) return false;
  return value.sections.every((section) => isRecord(section) && typeof section.kind === "string"
    && SECTION_KINDS.includes(section.kind as SectionKind) && typeof section.present === "boolean" && Array.isArray(section.paragraphs));
}

function projectionEvent(name: string, matterId: string, targetId: string, projection: ReturnType<typeof projectDraftPreview>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail: { matterId, targetId, ...projection } }));
}

export interface DraftEditorProps {
  /** Existing local repository and verified local actor; no provider is created. */
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string;
  /** Called by the empty-state generation entry; omitted callback dispatches `v6:draft-generate`. */
  onGenerateDraft?: () => void;
  onPreview?: (projection: ReturnType<typeof projectDraftPreview>) => void;
  onExport?: (projection: ReturnType<typeof projectDraftExport>) => void;
  bufferStore?: DraftBufferStore;
  /** Only IDs confirmed against `confirmationRevisionId` are treated as confirmed. */
  confirmationRevisionId?: string | null;
  confirmedParagraphIds?: readonly string[];
}

/**
 * Unified AST editor. The parent owns route registration and may connect the
 * preview/export callbacks; omitted callbacks emit revision-bound browser events.
 */
export function DraftEditor(props: DraftEditorProps) {
  const session = useMemo(() => new DraftEditorSession({
    repository: props.repository,
    actor: props.actor,
    matterId: props.matterId,
    targetId: props.targetId,
    bufferStore: props.bufferStore,
  }), [props.repository, props.actor, props.matterId, props.targetId, props.bufferStore]);
  const [state, setState] = useState(() => session.getSnapshot());

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    void session.load();
    return unsubscribe;
  }, [session]);

  useEffect(() => {
    if (typeof window === "undefined" || !(state.dirty || state.conflict || state.preservedLocalModel)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.dirty, state.conflict, state.preservedLocalModel]);

  useEffect(() => {
    if (!state.error || state.error.code !== "INVALID_AST" || typeof document === "undefined") return;
    const first = state.error.issues.find((issue) => issue.nodeId !== null || issue.sectionKind !== null);
    const nodeId = first?.nodeId ? `draft-node-${first.nodeId}` : first?.sectionKind ? `draft-section-${first.sectionKind}` : null;
    if (nodeId) {
      const node = document.getElementById(nodeId);
      node?.scrollIntoView?.({ block: "center" });
      node?.focus?.();
    }
  }, [state.error]);

  if (state.phase === "loading") {
    return <section className="card" data-testid="draft-editor" data-state="loading" aria-busy="true">
      <h2 className="card-title">专业草稿</h2><p className="muted">正在读取修订和本机缓冲…</p><div className="skeleton v6-skeleton" />
    </section>;
  }
  if (state.phase === "error" && !state.model) {
    return <section className="card" data-testid="draft-editor" data-state="error">
      <h2 className="card-title">专业草稿</h2>
      <div className="notice" role="alert" data-testid="draft-editor-error" data-code={state.error?.code}>
        <strong>读取失败</strong><p>{state.error?.message}</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void session.refresh()}>重试</button>
      </div>
    </section>;
  }
  if (!state.model) {
    return <DraftEditorEmptyState
      matterId={props.matterId}
      targetId={props.targetId}
      onGenerateDraft={props.onGenerateDraft}
      onManualWrite={() => session.beginManualDraft()}
    />;
  }

  const model = state.model;
  const confirmedIds = props.confirmationRevisionId === state.baseRevisionId && !state.dirty && !state.conflict
    ? new Set(props.confirmedParagraphIds ?? [])
    : new Set<string>();
  const allParagraphs = [
    ...model.claims.flatMap((claim) => claim.paragraphs),
    ...model.sections.flatMap((section) => section.paragraphs),
  ];
  const pendingIds = new Set(pendingAiParagraphIds(
    allParagraphs,
    state.baseRevisionId,
    props.confirmationRevisionId,
    props.confirmedParagraphIds,
    state.dirty || state.conflict,
  ));
  const pendingAi = pendingIds.size;

  const update = (next: DraftEditorModel) => { void session.updateModel(next); };
  const project = (kind: "preview" | "export") => {
    const revision = state.baseRevision?.revision as DraftRevision | undefined;
    if (!revision) return;
    if (kind === "preview") {
      const projection = projectDraftPreview(revision);
      if (props.onPreview) props.onPreview(projection);
      else projectionEvent("v6:draft-preview", props.matterId, props.targetId, projection);
    } else {
      const projection = projectDraftExport(revision);
      if (props.onExport) props.onExport(projection);
      else projectionEvent("v6:draft-export", props.matterId, props.targetId, projection);
    }
  };

  return <section className="card stack-3" data-testid="draft-editor" data-state={state.phase === "error" ? "error" : state.inputStale ? "stale" : "ready"}>
    <div className="row-between" style={{ flexWrap: "wrap" }}>
      <h2 className="card-title">专业草稿</h2>
      <span className="field-hint" data-testid="draft-revision">{state.baseRevisionId ? `修订 ${state.baseRevisionId}` : "未保存的手工草稿"}</span>
    </div>

    {state.inputStale ? <div className="notice" role="status" data-testid="draft-input-stale">
      草稿所依据的事实、目标配置或图集版本已变化。核对输入后再决定是否继续编辑。
    </div> : null}
    {state.conflict && state.latestRevision ? <div className="notice" role="alert" data-testid="draft-version-conflict" data-code="VERSION_CONFLICT">
      <strong>有更新修订，本机内容没有覆盖它</strong>
      <p>本机缓冲依据 {state.baseRevisionId ?? "空目标"}；当前最新为 {state.latestRevision.revision.id}。比较后请手工合并。</p>
      <DraftMergeView local={model} latest={state.latestRevision.ast} latestRevisionId={state.latestRevision.revision.id} />
      <button type="button" className="btn btn-outline btn-sm" onClick={() => void session.startMerge()}>以最新修订为合并基准</button>
    </div> : null}

    {state.preservedLocalModel ? <div className="notice" data-testid="draft-preserved-local">
      <strong>待合并的本机缓冲</strong>
      <p>此内容仍保存在本机。请从下方本机版本比较并手工合并到当前编辑区。</p>
      <DraftMergeView local={state.preservedLocalModel} latest={state.baseRevision?.ast ?? modelToAst(model)} latestRevisionId={state.baseRevisionId ?? ""} />
    </div> : null}

    {state.error ? <div className="notice" role="alert" data-testid="draft-editor-action-error" data-code={state.error.code}>
      <strong>{state.error.code}</strong><p>{state.error.message}</p>
      {state.error.issues.length ? <ul>{state.error.issues.map((issue, index) => <li key={`${issue.path}/${index}`} data-invalid-node={issue.nodeId ?? ""}>
        {issue.claimNumber !== null ? `权利要求 ${issue.claimNumber}` : issue.sectionKind ? SECTION_LABELS[issue.sectionKind] : issue.nodeId ?? issue.path}：{issue.reason}
      </li>)}</ul> : null}
    </div> : null}

    <label className="field">
      <span className="field-label">稿件标题</span>
      <input className="input" value={model.title} onChange={(event) => update({ ...model, title: event.currentTarget.value })} data-testid="draft-title" />
    </label>

    <div className="stack-3" data-testid="draft-claims">
      <h3 className="card-title">权利要求</h3>
      {model.claims.length === 0 ? <p className="muted">暂无权利要求。</p> : model.claims.map((claim) => {
        const issue = state.error?.issues.find((item) => item.nodeId === claim.id);
        return <article className="card stack-3" key={claim.id} id={`draft-node-${claim.id}`} data-node-id={claim.id} data-invalid={issue ? "true" : undefined}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <strong>权利要求</strong>
            <input aria-label={`权利要求 ${claim.number} 编号`} type="number" min={1} value={claim.number} onChange={(event) => {
              const number = Number(event.currentTarget.value);
              update(editClaim(model, claim.id, { number: Number.isFinite(number) ? number : 0 }));
            }} style={{ width: "7rem" }} />
            <label className="field" style={{ minWidth: "14rem" }}>
              <span className="field-label">前置权利要求 ID（逗号分隔）</span>
              <input className="input" aria-label={`权利要求 ${claim.number} 依赖`} value={claim.dependsOn.join(", ")} onChange={(event) => update(editClaim(model, claim.id, {
                dependsOn: event.currentTarget.value.split(",").map((id) => id.trim()).filter(Boolean),
              }))} />
            </label>
          </div>
          {claim.features.length ? <ul className="v6-list">{claim.features.map((feature) => <li key={feature.id} id={`draft-node-${feature.id}`} data-node-id={feature.id}>{feature.text}</li>)}</ul> : null}
          <ParagraphList
            paragraphs={claim.paragraphs}
            location={{ claimId: claim.id }}
            confirmedIds={confirmedIds}
            onEdit={(index, text) => { void session.updateParagraph({ claimId: claim.id }, index, text); }}
            onInsert={(index) => { void session.addParagraph({ claimId: claim.id }, index); }}
            onDelete={(index) => { void session.removeParagraph({ claimId: claim.id }, index); }}
            issues={state.error?.issues ?? []}
          />
        </article>;
      })}
    </div>

    <div className="stack-3" data-testid="draft-sections">
      <h3 className="card-title">说明书分区</h3>
      {SECTION_KINDS.map((kind) => {
        const section = model.sections.find((item) => item.kind === kind);
        const paragraphs = section?.paragraphs ?? [];
        return <section className="stack-3" key={kind} id={`draft-section-${kind}`} data-testid={`draft-section-${kind}`}>
          <h4 className="card-title">{SECTION_LABELS[kind]}</h4>
          <ParagraphList
            paragraphs={paragraphs}
            location={{ sectionKind: kind }}
            confirmedIds={confirmedIds}
            onEdit={(index, text) => { void session.updateParagraph({ sectionKind: kind }, index, text); }}
            onInsert={(index) => { void session.addParagraph({ sectionKind: kind }, index); }}
            onDelete={(index) => { void session.removeParagraph({ sectionKind: kind }, index); }}
            issues={state.error?.issues ?? []}
          />
        </section>;
      })}
    </div>

    {state.supportRows.length ? <section className="stack-3" data-testid="draft-support-table">
      <h3 className="card-title">要素支持表</h3>
      {state.supportRows.map((row) => <SupportRow key={row.featureId} row={row} onJump={jumpToParagraph} />)}
    </section> : null}
    {pendingAi > 0 ? <p className="field-hint" data-testid="draft-pending-ai">◇ {pendingAi} 段 AI/混合内容待确认</p> : null}

    <div className="row" style={{ flexWrap: "wrap" }}>
      <button type="button" className="btn btn-default" data-testid="draft-save" disabled={!state.dirty || state.conflict || state.saving} onClick={() => void session.save()}>
        {state.saving ? "正在保存…" : "保存修订"}
      </button>
      <button type="button" className="btn btn-outline btn-sm" data-testid="draft-refresh" disabled={state.saving} onClick={() => void session.refresh()}>刷新</button>
      <button type="button" className="btn btn-outline btn-sm" data-testid="draft-preview" disabled={!state.baseRevision} onClick={() => project("preview")}>预览此修订</button>
      <button type="button" className="btn btn-outline btn-sm" data-testid="draft-export" disabled={!state.baseRevision} onClick={() => project("export")}>导出此修订</button>
    </div>
    {state.notice ? <p role="status" aria-live="polite" data-testid="draft-editor-notice">{state.notice}</p> : null}
  </section>;
}

function modelToAst(model: DraftEditorModel): DraftAST {
  return editorModelToDraftAst(model);
}

interface ParagraphListProps {
  paragraphs: readonly Paragraph[];
  location: ParagraphLocation;
  confirmedIds: ReadonlySet<string>;
  onEdit: (index: number, text: string) => void;
  onInsert: (index: number) => void;
  onDelete: (index: number) => void;
  issues: readonly DraftAstIssue[];
}

function ParagraphList(props: ParagraphListProps) {
  const { paragraphs, location, confirmedIds, onEdit, onInsert, onDelete, issues } = props;
  const labelPrefix = location.claimId ? "权利要求段落" : SECTION_LABELS[location.sectionKind as SectionKind];
  return <div className="stack-3">
    {paragraphs.map((paragraph, index) => {
      const issue = issues.find((item) => item.nodeId === paragraph.id);
      const needsConfirmation = (paragraph.origin === "ai" || paragraph.origin === "mixed") && !confirmedIds.has(paragraph.id);
      return <div className="v6-entry stack-3" key={paragraph.id} id={`draft-node-${paragraph.id}`} data-node-id={paragraph.id} data-origin={paragraph.origin} data-invalid={issue ? "true" : undefined}>
        <label className="field">
          <span className="field-label">{labelPrefix} {index + 1} · {paragraph.origin}{needsConfirmation ? " · ◇ 待确认" : ""}</span>
          <textarea className="textarea" rows={4} value={paragraph.text} aria-invalid={issue ? "true" : undefined}
            aria-label={`${labelPrefix} ${index + 1}`} onChange={(event) => onEdit(index, event.currentTarget.value)} />
        </label>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onInsert(index)} aria-label={`在${labelPrefix} ${index + 1} 后插入段落`}>插入段落</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onDelete(index)} aria-label={`删除${labelPrefix} ${index + 1}`}>删除段落</button>
          {needsConfirmation ? <span className="field-hint">◇ 待确认</span> : null}
        </div>
      </div>;
    })}
    <button type="button" className="btn btn-outline btn-sm" onClick={() => onInsert(paragraphs.length - 1)}>添加段落</button>
  </div>;
}

function jumpToParagraph(nodeId: string): void {
  if (typeof document === "undefined") return;
  const node = document.getElementById(`draft-node-${nodeId}`);
  node?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  node?.focus?.();
}

function SupportRow({ row, onJump }: { row: SupportTableRow; onJump: (nodeId: string) => void }) {
  return <article className="v6-entry" data-testid={`draft-support-${row.featureId}`}>
    <h4>权利要求 {row.claimNumber} · {row.featureText}</h4>
    <p>状态：{row.featureStatus}</p>
    <p>关联事实：{row.factIds.length ? row.factIds.join("、") : "无"}</p>
    <p>支持段落：{row.supportParagraphIds.length ? row.supportParagraphIds.map((id) => <button key={id} type="button" className="btn btn-outline btn-sm" onClick={() => onJump(id)}>{id}</button>) : "无"}</p>
    {row.facts.map((fact) => <div key={fact.id}>
      <span>{fact.statement ?? `事实 ${fact.id}`} · {fact.status ?? "当前事实不可用"}</span>
      {fact.sourceRefs.length ? <ul>{fact.sourceRefs.map((ref, index) => <li key={`${ref.chunkId}/${index}`}>
        来源 {ref.sourceId} · chunk {ref.chunkId}{ref.page === null ? "" : ` · 第 ${ref.page} 页`} · {ref.quote}
      </li>)}</ul> : <p>没有可用来源引用。</p>}
    </div>)}
    {row.priorityClaims.length ? <p>优先权核实：{row.priorityClaims.map((claim) => `${claim.country} ${claim.applicationNumber}（${claim.verification}）`).join("；")}</p> : <p>优先权：未配置</p>}
  </article>;
}

export function DraftMergeView(props: { local: DraftEditorModel; latest: DraftAST; latestRevisionId: string }) {
  const localAst = editorModelToDraftAst(props.local);
  return <div className="row" style={{ alignItems: "stretch", flexWrap: "wrap" }} data-testid="draft-merge-view" data-latest-revision={props.latestRevisionId}>
    <section className="card stack-3" style={{ flex: "1 1 20rem" }} data-testid="draft-merge-local">
      <h4>本机缓冲</h4><p>{localAst.title}</p>
      {localAst.claims.map((claim) => <p key={claim.id}>权利要求 {claim.number}：{claim.paragraphs.map((paragraph) => paragraph.text).join(" / ")}</p>)}
      {localAst.sections.map((section) => <p key={section.kind}>{SECTION_LABELS[section.kind]}：{section.paragraphs.map((paragraph) => paragraph.text).join(" / ")}</p>)}
    </section>
    <section className="card stack-3" style={{ flex: "1 1 20rem" }} data-testid="draft-merge-latest">
      <h4>最新修订 {props.latestRevisionId}</h4><p>{props.latest.title}</p>
      {props.latest.claims.map((claim) => <p key={claim.id}>权利要求 {claim.number}：{claim.paragraphs.map((paragraph) => paragraph.text).join(" / ")}</p>)}
      {props.latest.sections.map((section) => <p key={section.kind}>{SECTION_LABELS[section.kind]}：{section.paragraphs.map((paragraph) => paragraph.text).join(" / ")}</p>)}
    </section>
  </div>;
}

export default DraftEditor;
