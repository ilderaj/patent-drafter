import React, { useEffect, useMemo, useState } from "react";
import {
  activitySchema,
  confirmationSchema,
  revocationSchema,
  riskSchema,
  sourceSnapshotSchema,
  type DraftAST,
  type DraftRevision,
  type Fact,
  type Paragraph,
  type RiskDTO,
  type SnapshotRef,
  type SourceRef,
} from "../../../../../../packages/contracts/src/index.ts";
import {
  confirm,
  confirmationStatus,
  currentConfirmations,
  isConfirmationCurrent,
  isRevoked,
  revokeConfirmation,
  type Confirmation,
  type ConfirmationLedger,
  type Revocation,
} from "../../../../../../packages/domain/src/v6/confirmation.ts";
import { isCurrent } from "../../../../../../packages/domain/src/v6/revision.ts";
import {
  buildSupportTable,
  projectDraftRevision,
  type SupportTableRow,
} from "./ast-adapter.ts";
import {
  createGenerationRevisionStore,
  type GenerationRevisionStore,
  type GenerationRevisionView,
} from "../generation/generation.ts";
import { readChunkSets, readMatterSources, sourceIdFor, type ChunkSet, type ParseSourceRecord } from "../sources/parse.ts";
import { sha256Hex, STORES, type Actor, type ActivityRecord, type LocalRepository } from "../../lib/repository.ts";

const EMPTY_LEDGER = (matterId: string): ConfirmationLedger => ({ matterId, confirmations: [], revocations: [] });

export interface DraftReviewLocator {
  key: string;
  ref: SourceRef;
  status: "located" | "unlocatable";
  reason: string | null;
  sourceName: string | null;
  chunkText: string | null;
}

export interface DraftReviewState {
  phase: "loading" | "empty" | "ready" | "error" | "stale";
  revision: GenerationRevisionView | null;
  snapshot: SnapshotRef | null;
  currentSnapshot: SnapshotRef | null;
  isCurrent: boolean;
  supportRows: SupportTableRow[];
  locators: DraftReviewLocator[];
  ledger: ConfirmationLedger;
  error: { code: string; message: string } | null;
}

export interface DraftReviewSessionOptions {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string;
  /** Uses the accepted V6-17 revision persistence seam by default. */
  revisions?: GenerationRevisionStore;
  /** Injected ID and time sources keep ledger transitions deterministic. */
  newId?: (label: string) => string;
  now?: () => string;
}

export type DraftReviewAction =
  | { ok: true; created?: boolean; confirmation?: Confirmation; revocation?: Revocation }
  | { ok: false; error: { code: string; message: string } };

type ConfirmTransactionSuccess = {
  ok: true;
  created: boolean;
  confirmation: Confirmation;
  ledger: ConfirmationLedger;
};
type RevokeTransactionSuccess = {
  ok: true;
  ledger: ConfirmationLedger;
  revocation: Revocation;
  confirmation: Confirmation;
};

interface StoredLedgerRow {
  kind: "draft-review.confirmations";
  tenantId: string;
  actorId: string;
  matterId: string;
  ledger: ConfirmationLedger;
}

/**
 * Public review seam for the editor orchestrator. It reads the current
 * DraftRevision, validates SourceRefs against persisted chunks, and uses the
 * V6-05 ledger transitions for confirmation validity and revocation.
 */
export class DraftReviewSession {
  private readonly repository: LocalRepository;
  private readonly actor: Actor;
  private readonly matterId: string;
  private readonly targetId: string;
  private readonly revisions: GenerationRevisionStore;
  private readonly newId: (label: string) => string;
  private readonly now: () => string;
  private state: DraftReviewState;
  private readonly listeners = new Set<(state: DraftReviewState) => void>();

  constructor(options: DraftReviewSessionOptions) {
    this.repository = options.repository;
    this.actor = options.actor;
    this.matterId = options.matterId;
    this.targetId = options.targetId;
    this.revisions = options.revisions ?? createGenerationRevisionStore({
      repository: options.repository,
      actor: options.actor,
    });
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.state = initialState(options.matterId);
  }

  getSnapshot(): DraftReviewState {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: DraftReviewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    await this.readState();
  }

  async refresh(): Promise<void> {
    await this.readState();
  }

  async confirmParagraph(paragraphId: string): Promise<DraftReviewAction> {
    const revision = this.state.revision?.revision;
    const snapshot = this.state.snapshot;
    if (!revision || !snapshot) return actionFailure("RESOURCE_NOT_FOUND", "没有可确认的草稿修订。");
    const paragraphs = allParagraphs(revision.ast);
    const paragraph = paragraphs.find((item) => item.id === paragraphId);
    if (!paragraph || (paragraph.origin !== "ai" && paragraph.origin !== "mixed")) {
      return actionFailure("INVALID_INPUT", "只有当前修订中的 AI/混合段落可以确认。");
    }
    const aiParagraphIds = paragraphs
      .filter((item) => item.origin === "ai" || item.origin === "mixed")
      .map((item) => item.id);
    const versionRead = await currentMatterVersion(this.repository, this.actor, this.matterId);
    if (!versionRead.ok) return versionReadFailure(versionRead);
    const expectedVersion = versionRead.version;

    try {
      const outcome = await this.repository.backend.transaction("readonly", async (tx) => {
        const current = await currentSnapshotInTransaction(tx, this.actor, this.matterId, this.targetId);
        if (!current || !isCurrent(snapshot, current) || current.draftRevisionId !== revision.id) {
          return actionFailure("STALE_BINDING", "修订或输入已变化；请刷新后再确认。");
        }
        const ledger = await readLedger(tx, this.actor, this.matterId);
        const result = confirm(ledger, {
          kind: "ai_paragraph",
          snapshot,
          actorId: this.actor.userId,
          identity: "local_self_reported",
          paragraphId,
          aiParagraphIds,
        }, { newId: this.newId, now: this.now });
        if (!result.ok) return actionFailure(result.error.code, result.error.message);
        return {
          ok: true as const,
          created: result.created,
          confirmation: result.confirmation,
          ledger: result.state,
        } satisfies ConfirmTransactionSuccess | DraftReviewAction;
      }) as ConfirmTransactionSuccess | DraftReviewAction;
      if (!outcome.ok) {
        await this.refresh();
        return outcome;
      }
      if (!("ledger" in outcome)) {
        await this.refresh();
        return outcome;
      }
      if (outcome.created) {
        const event = confirmationEvent(
          this.actor, snapshot, "confirmation.created", outcome.confirmation.createdAt,
          this.newId("confirmation-event"), outcome.confirmation.id,
        );
        const written = await this.repository.writeConfirmationLedger(
          this.actor,
          this.matterId,
          expectedVersion,
          outcome.ledger,
          event,
          event.occurredAt,
        );
        await this.refresh();
        if (!written.ok) return actionFailure(written.error.code, written.error.message);
      } else {
        await this.refresh();
      }
      return { ok: true, created: outcome.created, confirmation: outcome.confirmation };
    } catch {
      return actionFailure("STORAGE_UNAVAILABLE", "确认记录读取或保存失败，请重试。");
    }
  }

  async revokeParagraphConfirmation(confirmationId: string, reason: string): Promise<DraftReviewAction> {
    if (reason.trim().length === 0) return actionFailure("INVALID_INPUT", "撤销原因不能为空。");
    try {
      const versionRead = await currentMatterVersion(this.repository, this.actor, this.matterId);
      if (!versionRead.ok) return versionReadFailure(versionRead);
      const expectedVersion = versionRead.version;
      const transition = await this.repository.backend.transaction("readonly", async (tx) => {
        const ledger = await readLedger(tx, this.actor, this.matterId);
        const confirmation = ledger.confirmations.find((item) => item.id === confirmationId);
        if (!confirmation) return actionFailure("RESOURCE_NOT_FOUND", "确认记录不可用。");
        if (confirmation.actorId !== this.actor.userId) {
          return actionFailure("ACTION_FORBIDDEN", "只能撤销由当前本地用户记录的确认。");
        }
        const result = revokeConfirmation(ledger, {
          confirmationId,
          actorId: this.actor.userId,
          reason: reason.trim(),
        }, { newId: this.newId, now: this.now });
        if (!result.ok) return actionFailure(result.error.code, result.error.message);
        return { ok: true as const, ledger: result.state, revocation: result.revocation, confirmation };
      }) as RevokeTransactionSuccess | DraftReviewAction;
      if (!transition.ok) {
        await this.refresh();
        return transition;
      }
      if (!("ledger" in transition)) {
        await this.refresh();
        return transition;
      }
      const event = confirmationEvent(this.actor, transition.confirmation.snapshot,
        "confirmation.revoked", transition.revocation.createdAt,
        this.newId("confirmation-revoke-event"), transition.confirmation.id);
      const written = await this.repository.writeConfirmationLedger(
        this.actor,
        this.matterId,
        expectedVersion,
        transition.ledger,
        event,
        transition.revocation.createdAt,
      );
      await this.refresh();
      if (!written.ok) return actionFailure(written.error.code, written.error.message);
      return { ok: true, revocation: transition.revocation };
    } catch {
      // A rejected IndexedDB read/write must not escape an event handler. The
      // read-only ledger transaction and the write seam both abort without
      // side effects, so report a retryable action failure.
      return actionFailure("STORAGE_UNAVAILABLE", "撤销记录读取或保存失败，请重试。");
    }
  }

  private async readState(): Promise<void> {
    const previousRevisionId = this.state.revision?.revision.id ?? null;
    this.setState({ ...this.state, phase: "loading", error: null });
    try {
      const [head, matter, ledger] = await Promise.all([
        this.revisions.loadHeadRevision(this.matterId, this.targetId),
        this.repository.loadMatter(this.actor, this.matterId),
        this.repository.backend.transaction("readonly", (tx) => readLedger(tx, this.actor, this.matterId)),
      ]);
      if (!head.ok) throw new ReviewFailure(head.error.code, head.error.message);
      if (!matter.ok) throw new ReviewFailure(matter.error.code, matter.error.message);
      const aggregate = matter.data.data;
      const target = aggregate.targets.find((item) => item.id === this.targetId);
      if (!target) throw new ReviewFailure("RESOURCE_NOT_FOUND", "目标不可用。");
      if (!head.data) {
        this.setState({ ...initialState(this.matterId), phase: "empty", ledger });
        return;
      }

      const revision = head.data;
      const projection = projectDraftRevision(revision.revision as DraftRevision);
      const currentSnapshot: SnapshotRef = {
        matterId: this.matterId,
        targetId: this.targetId,
        sourceVersion: aggregate.matter.sourceVersion,
        targetConfigVersion: target.configVersion,
        draftRevisionId: target.draftRevisionId ?? revision.revision.id,
        figureRevisionId: target.figureRevisionId,
      };
      const current = target.draftRevisionId === revision.revision.id && isCurrent(projection.snapshot, currentSnapshot);
      const facts = await this.readFacts(revision.revision.input.sourceVersion);
      const supportRows = buildSupportTable(revision.ast, facts);
      const locatorInputIsCurrent = revision.revision.input.sourceVersion === aggregate.matter.sourceVersion
        && revision.revision.input.targetConfigVersion === target.configVersion
        && revision.revision.input.figureRevisionId === target.figureRevisionId;
      const locators = await this.readLocators(revision.ast, facts, aggregate.assets, locatorInputIsCurrent);
      const hasOlderConfirmation = ledger.confirmations.some((item) => item.kind === "ai_paragraph"
        && item.snapshot.matterId === this.matterId
        && item.snapshot.targetId === this.targetId
        && item.snapshot.draftRevisionId !== currentSnapshot.draftRevisionId);
      const changedRevision = previousRevisionId !== null && previousRevisionId !== revision.revision.id;
      this.setState({
        phase: current && !changedRevision && !hasOlderConfirmation ? "ready" : "stale",
        revision,
        snapshot: projection.snapshot,
        currentSnapshot,
        isCurrent: current,
        supportRows,
        locators,
        ledger,
        error: null,
      });
    } catch (error) {
      this.setState({
        ...this.state,
        phase: "error",
        error: error instanceof ReviewFailure
          ? { code: error.code, message: error.message }
          : { code: "STORAGE_UNAVAILABLE", message: errorMessage(error, "草稿审阅数据读取失败。") },
      });
    }
  }

  private async readFacts(sourceVersion: number): Promise<Fact[]> {
    const raw = await this.repository.backend.transaction("readonly", (tx) =>
      tx.get(STORES.blobs, `intake/snapshot/${this.matterId}/${sourceVersion}`),
    );
    if (!isRecord(raw) || raw.kind !== "intake.snapshot") return [];
    const parsed = sourceSnapshotSchema.safeParse(raw.snapshot);
    if (!parsed.success || parsed.data.matterId !== this.matterId || parsed.data.version !== sourceVersion) return [];
    return parsed.data.facts;
  }

  private async readLocators(
    ast: DraftAST,
    facts: readonly Fact[],
    assets: readonly { id: string; originalName: string; matterId: string | null; tenantId: string; purpose: "source" | "drawing" | "receipt" | "review_attachment" | "service_attachment" | "export" }[],
    revisionSourceIsCurrent: boolean,
  ): Promise<DraftReviewLocator[]> {
    const refs = collectSourceRefs(ast, facts);
    if (refs.length === 0) return [];
    const sources = await readMatterSources(this.repository, this.actor, this.matterId);
    if (!sources.ok) throw new ReviewFailure("STORAGE_UNAVAILABLE", "来源记录读取失败，无法验证定位信息。");
    const sourceById = new Map<string, ParseSourceRecord>();
    for (const source of sources.data.sources.values()) {
      if (source.source.matterId === this.matterId) sourceById.set(source.source.id, source);
    }
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const sourceIdByAssetId = new Map<string, string>();
    for (const asset of assets) {
      if (asset.purpose === "source" && asset.matterId === this.matterId) {
        sourceIdByAssetId.set(asset.id, await sourceIdFor(asset.id));
      }
    }
    const chunkSets = new Map<string, ChunkSet[]>();
    const locators: DraftReviewLocator[] = [];
    for (const ref of refs) {
      const key = sourceRefKey(ref);
      if (!revisionSourceIsCurrent) {
        locators.push(unlocatable(ref, key, "草稿基于旧事实版本；来源不可定位。", null));
        continue;
      }
      const source = sourceById.get(ref.sourceId);
      if (!source) {
        locators.push(unlocatable(ref, key, "来源或解析记录不存在。", null));
        continue;
      }
      const asset = assetById.get(source.source.assetId);
      const sourceName = asset?.originalName ?? null;
      if (source.source.matterId !== this.matterId || asset?.matterId !== this.matterId
        || asset?.tenantId !== this.actor.tenantId || asset?.purpose !== "source"
        || sourceIdByAssetId.get(source.source.assetId) !== ref.sourceId) {
        locators.push(unlocatable(ref, key, "来源案件或材料归属不匹配。", sourceName));
        continue;
      }
      if (source.source.retiredAt !== null) {
        locators.push(unlocatable(ref, key, "来源已退役。", sourceName));
        continue;
      }
      let sets = chunkSets.get(ref.sourceId);
      if (!sets) {
        sets = await readChunkSets(this.repository, ref.sourceId);
        chunkSets.set(ref.sourceId, sets);
      }
      const chunk = sets.flatMap((set) => set.chunks).find((item) => item.id === ref.chunkId);
      if (!chunk) {
        locators.push(unlocatable(ref, key, "chunk 不存在。", sourceName));
        continue;
      }
      const codePoints = Array.from(chunk.text.normalize("NFC"));
      const quote = Array.from(ref.quote.normalize("NFC"));
      const quoteMatches = quote.length > 0 && ref.start >= 0 && ref.end > ref.start
        && ref.end <= codePoints.length
        && codePoints.slice(ref.start, ref.end).join("") === quote.join("");
      const actualHash = await sha256Hex(new TextEncoder().encode(chunk.text));
      if (chunk.sourceId !== ref.sourceId || chunk.hash !== ref.chunkHash || actualHash !== chunk.hash) {
        locators.push(unlocatable(ref, key, "sourceId 或 chunkHash/内容哈希不匹配。", sourceName));
        continue;
      }
      if (chunk.page !== ref.page || !quoteMatches) {
        locators.push(unlocatable(ref, key, "页码、偏移或原文引用不匹配。", sourceName));
        continue;
      }
      locators.push({ key, ref: structuredClone(ref), status: "located", reason: null, sourceName, chunkText: chunk.text });
    }
    return locators;
  }

  private setState(state: DraftReviewState): void {
    this.state = state;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}

/** Props for the orchestrator-mounted review panel. */
export interface DraftReviewPanelProps extends DraftReviewSessionOptions {
  /** Return true only when the editor has found and focused the requested node. */
  onLocateNode?: (nodeId: string) => boolean;
  /** Risks from the current check; anchored nodes use the same focus path as claims. */
  risks?: readonly RiskDTO[];
}

/** Mount beside DraftEditor; callbacks keep navigation ownership with the orchestrator. */
export function DraftReviewPanel(props: DraftReviewPanelProps) {
  const session = useMemo(() => new DraftReviewSession(props), [
    props.repository,
    props.actor,
    props.matterId,
    props.targetId,
    props.revisions,
    props.newId,
    props.now,
  ]);
  const [state, setState] = useState(() => session.getSnapshot());
  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    void session.load();
    return unsubscribe;
  }, [session]);
  return <DraftReviewPanelView
    state={state}
    onRefresh={() => session.refresh()}
    onConfirm={(paragraphId) => session.confirmParagraph(paragraphId)}
    onRevoke={(confirmationId, reason) => session.revokeParagraphConfirmation(confirmationId, reason)}
    onLocateNode={props.onLocateNode}
    risks={props.risks}
  />;
}

export interface DraftReviewPanelViewProps {
  state: DraftReviewState;
  onRefresh: () => void | Promise<void>;
  onConfirm: (paragraphId: string) => void | Promise<unknown>;
  onRevoke: (confirmationId: string, reason: string) => void | Promise<unknown>;
  onLocateNode?: (nodeId: string) => boolean;
  risks?: readonly RiskDTO[];
}

/** Presentational view is exported for shell composition and accessible states. */
export function DraftReviewPanelView(props: DraftReviewPanelViewProps) {
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null);
  const [selectedLocatorKey, setSelectedLocatorKey] = useState<string | null>(null);
  const [unlocatedNode, setUnlocatedNode] = useState<{ id: string; text: string } | null>(null);
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [revokeError, setRevokeError] = useState<{ code: string; message: string } | null>(null);
  const state = props.state;

  const revoke = async (confirmationId: string) => {
    setRevokeError(null);
    try {
      const result = await props.onRevoke(confirmationId, revokeReasons[confirmationId] ?? "");
      if (isActionFailure(result)) setRevokeError(result.error);
    } catch {
      setRevokeError({ code: "STORAGE_UNAVAILABLE", message: "撤销操作失败，请重试。" });
    }
  };

  useEffect(() => {
    if (!selectedLocatorKey || typeof document === "undefined") return;
    const node = document.getElementById(`draft-review-source-${encodeURIComponent(selectedLocatorKey)}`);
    if (!node) return;
    node.setAttribute("tabindex", "-1");
    node.focus({ preventScroll: true });
    node.dataset.reviewHighlight = "true";
    node.style.outline = "3px solid #2563eb";
    node.style.outlineOffset = "3px";
    node.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [selectedLocatorKey]);

  if (state.phase === "loading") return <section className="card" data-testid="draft-review" data-state="loading" aria-busy="true">
    <h2 className="card-title">草稿审阅</h2><p className="muted">正在读取修订、来源和确认记录…</p><div className="skeleton v6-skeleton" />
  </section>;
  if (state.phase === "error") return <section className="card stack-3" data-testid="draft-review" data-state="error">
    <h2 className="card-title">草稿审阅</h2>
    <div className="notice" role="alert" data-testid="draft-review-error" data-code={state.error?.code}>
      <strong>读取失败</strong><p>{state.error?.message}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => void props.onRefresh()}>重试</button>
    </div>
  </section>;
  if (state.phase === "empty" || !state.revision || !state.snapshot || !state.currentSnapshot) {
    return <section className="card stack-3" data-testid="draft-review" data-state="empty">
      <h2 className="card-title">草稿审阅</h2><p className="muted">此目标还没有可审阅的草稿修订。</p>
    </section>;
  }

  const revision = state.revision.revision;
  const currentSnapshot = state.currentSnapshot;
  const paragraphs = allParagraphs(state.revision.ast);
  const aiParagraphs = paragraphs.filter((paragraph) => paragraph.origin === "ai" || paragraph.origin === "mixed");
  const status = confirmationStatus(state.ledger, currentSnapshot, aiParagraphs.map((paragraph) => paragraph.id));
  const current = new Set(currentConfirmations(state.ledger, currentSnapshot).map((item) => item.id));
  const paragraphById = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const locatorByKey = new Map(state.locators.map((locator) => [locator.key, locator]));

  const locateNode = (nodeId: string, originalText: string) => {
    setUnlocatedNode(null);
    const callbackResolved = props.onLocateNode?.(nodeId);
    const node = typeof document === "undefined" ? null : document.getElementById(`draft-node-${nodeId}`);
    if (node) {
      node.setAttribute("tabindex", "-1");
      node.scrollIntoView?.({ behavior: "smooth", block: "center" });
      node.focus({ preventScroll: true });
      node.dataset.reviewHighlight = "true";
      node.style.outline = "3px solid #2563eb";
      node.style.outlineOffset = "3px";
    }
    const focused = typeof document === "undefined" || document.activeElement === node;
    if (callbackResolved === true || node !== null && focused) return;
    setUnlocatedNode({ id: nodeId, text: originalText });
  };
  const toggleParagraph = (paragraphId: string) => {
    setSelectedParagraphId((selected) => selected === paragraphId ? null : paragraphId);
    const paragraph = paragraphById.get(paragraphId);
    if (paragraph) locateNode(paragraphId, paragraph.text);
  };

  return <section className="card stack-3" data-testid="draft-review" data-state={state.phase}>
    <div className="row-between" style={{ flexWrap: "wrap" }}>
      <h2 className="card-title">草稿审阅</h2>
      <span className="field-hint" data-testid="draft-review-revision">修订 {revision.id}</span>
    </div>
    {state.phase === "stale" || !state.isCurrent ? <div className="notice" role="status" data-testid="draft-review-stale">
      草稿修订或其输入已变化。旧确认对当前修订无效；请刷新并核对当前内容。
    </div> : null}
    <button type="button" className="btn btn-outline btn-sm" data-testid="draft-review-refresh" onClick={() => void props.onRefresh()}>刷新审阅</button>

    <section className="stack-3" data-testid="draft-review-support">
      <h3 className="card-title">要素支持与来源定位</h3>
      {state.supportRows.length === 0 ? <p className="muted">此修订没有权利要求特征映射。</p> : state.supportRows.map((row) => {
        const relatedParagraphs = row.supportParagraphIds
          .map((id) => paragraphById.get(id))
          .filter((paragraph): paragraph is Paragraph => paragraph !== undefined);
        const refs = mergeRefs([
          ...row.sourceRefs,
          ...relatedParagraphs.flatMap((paragraph) => paragraph.sourceRefs),
        ]);
        const claim = state.revision?.ast.claims.find((item) => item.id === row.claimId);
        return <article className="v6-entry stack-3" key={row.featureId} data-testid={`draft-review-feature-${row.featureId}`}>
          <h4>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => locateNode(row.claimId, claim?.paragraphs.map((p) => p.text).join(" ") ?? row.featureText)}>
              定位权利要求 {row.claimNumber}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => locateNode(row.featureId, row.featureText)}>{row.featureText}</button>
          </h4>
          <p>支持状态：{row.featureStatus}</p>
          <p>事实 ID：{row.factIds.length ? row.factIds.join("、") : "无"}</p>
          <ul>{row.facts.map((fact) => <li key={fact.id}>{fact.statement ?? `事实 ${fact.id}`} · {fact.status ?? "事实不可用"}</li>)}</ul>
          <p>支持段落：{row.supportParagraphIds.length ? row.supportParagraphIds.map((id) => {
            const paragraph = paragraphById.get(id);
            return <button key={id} type="button" className="btn btn-outline btn-sm" onClick={() => locateNode(id, paragraph?.text ?? id)}>{id}</button>;
          }) : "无"}</p>
          <SourceRefTable refs={refs} locatorByKey={locatorByKey} onLocate={(locator) => setSelectedLocatorKey(locator.key)} />
        </article>;
      })}
    </section>

    {props.risks?.length ? <section className="stack-3" data-testid="draft-review-risks">
      <h3 className="card-title">风险定位</h3>
      {props.risks.map((risk) => <RiskLocator key={risk.id} risk={risk} onLocate={(nodeId) => locateNode(nodeId, risk.explanation)} />)}
    </section> : null}

    {unlocatedNode ? <div className="notice" role="status" data-testid="draft-review-node-unlocatable">
      <strong>不可定位</strong><p>编辑器节点 {unlocatedNode.id} 当前未显示。原文：{unlocatedNode.text}</p>
    </div> : null}

    {selectedLocatorKey ? <SourceChunkView locator={locatorByKey.get(selectedLocatorKey) ?? null} /> : null}

    <section className="stack-3" data-testid="draft-review-confirmations">
      <h3 className="card-title">AI/混合段落确认</h3>
      {revokeError ? <div className="notice" role="alert" data-testid="draft-review-revoke-error" data-code={revokeError.code}>
        <strong>未能撤销确认</strong><p>{revokeError.message}（{revokeError.code}）</p>
      </div> : null}
      {aiParagraphs.length === 0 ? <p className="muted">此修订没有需要逐段确认的 AI/混合段落。</p> : aiParagraphs.map((paragraph) => {
        const records = state.ledger.confirmations.filter((item) => item.kind === "ai_paragraph" && item.paragraphId === paragraph.id);
        const live = records.find((item) => current.has(item.id) && isConfirmationCurrent(state.ledger, item, currentSnapshot));
        const expanded = selectedParagraphId === paragraph.id;
        const confirmed = status.confirmedAiParagraphIds.includes(paragraph.id);
        const revokedForCurrentRevision = records.some((item) => isCurrent(item.snapshot, currentSnapshot) && isRevoked(state.ledger, item.id));
        return <article className="v6-entry stack-3" key={paragraph.id} data-testid={`draft-review-paragraph-${paragraph.id}`} data-confirmed={confirmed ? "true" : "false"}>
          <button type="button" className="btn btn-outline" aria-expanded={expanded} onClick={() => toggleParagraph(paragraph.id)}>
            {confirmed ? "已确认" : "待确认"} · {paragraph.origin} · {paragraph.id} · 定位段落
          </button>
          <p>{paragraph.text}</p>
          {paragraph.sourceRefs.map((ref) => {
            const locator = locatorByKey.get(sourceRefKey(ref));
            return <button key={sourceRefKey(ref)} type="button" className="btn btn-outline btn-sm"
              onClick={() => locator && setSelectedLocatorKey(locator.key)}>
              来源标记 · {ref.sourceId} / {ref.chunkId}
            </button>;
          })}
          {!confirmed && !revokedForCurrentRevision ? <button type="button" className="btn btn-default btn-sm" disabled={!state.isCurrent}
            data-testid={`draft-review-confirm-${paragraph.id}`} onClick={() => void props.onConfirm(paragraph.id)}>确认已阅读本段</button> : null}
          {!confirmed && revokedForCurrentRevision ? <p role="status" data-testid={`draft-review-reconfirm-blocked-${paragraph.id}`}>
            此修订的确认已撤销。相同修订的重试会复用原记录；保存新修订后可重新确认。
          </p> : null}
          {expanded ? <ConfirmationHistory
            records={records}
            ledger={state.ledger}
            liveId={live?.id ?? null}
            currentSnapshot={currentSnapshot}
            reasons={revokeReasons}
            onReason={(id, value) => setRevokeReasons((values) => ({ ...values, [id]: value }))}
            onRevoke={(id) => void revoke(id)}
          /> : null}
        </article>;
      })}
    </section>
  </section>;
}

function SourceRefTable(props: {
  refs: readonly SourceRef[];
  locatorByKey: ReadonlyMap<string, DraftReviewLocator>;
  onLocate: (locator: DraftReviewLocator) => void;
}) {
  if (props.refs.length === 0) return <p className="muted">没有来源引用。</p>;
  return <div className="table-wrap" data-testid="draft-review-source-refs">
    <table className="table">
      <thead><tr><th>来源</th><th>chunk</th><th>页码</th><th>start</th><th>end</th><th>原文</th><th>定位</th></tr></thead>
      <tbody>{props.refs.map((ref) => {
        const locator = props.locatorByKey.get(sourceRefKey(ref));
        const key = sourceRefKey(ref);
        return <tr key={key}>
          <td>{ref.sourceId}</td><td>{ref.chunkId}</td><td>{ref.page ?? "—"}</td><td>{ref.start}</td><td>{ref.end}</td><td>{ref.quote}</td>
          <td>{locator?.status === "located"
            ? <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onLocate(locator)}>定位来源片段</button>
            : <span role="status" data-testid={`draft-review-unlocatable-${ref.chunkId}`}>不可定位 · {locator?.reason ?? "定位记录不可用"}；原引用：{ref.quote}</span>}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function SourceChunkView({ locator }: { locator: DraftReviewLocator | null }) {
  if (!locator) return null;
  if (locator.status !== "located" || locator.chunkText === null) return <div className="notice" role="status" data-testid="draft-review-source-unlocatable">
    <strong>不可定位</strong><p>{locator.reason} 原引用：{locator.ref.quote}</p>
  </div>;
  const points = Array.from(locator.chunkText.normalize("NFC"));
  const before = points.slice(0, locator.ref.start).join("");
  const quote = points.slice(locator.ref.start, locator.ref.end).join("");
  const after = points.slice(locator.ref.end).join("");
  return <article className="notice" tabIndex={-1} data-testid="draft-review-source-chunk"
    id={`draft-review-source-${encodeURIComponent(locator.key)}`}>
    <h4>来源片段 · {locator.sourceName ?? locator.ref.sourceId} · {locator.ref.page ?? "页码未知"} 页</h4>
    <p>{before}<mark>{quote}</mark>{after}</p>
  </article>;
}

function RiskLocator({ risk, onLocate }: { risk: RiskDTO; onLocate: (nodeId: string) => void }) {
  const label = risk.anchor.section === "claims" ? "权利要求" : risk.anchor.section ?? "未指定章节";
  return <article className="v6-entry stack-2" data-testid={`draft-review-risk-${risk.id}`}>
    <p><strong>{risk.category}</strong> · {risk.title}</p>
    <p>{risk.explanation}</p>
    {risk.anchor.nodeId !== null
      ? <button type="button" className="btn btn-outline btn-sm" data-testid={`draft-review-risk-locate-${risk.id}`}
        onClick={() => onLocate(risk.anchor.nodeId as string)}>定位风险锚点 · {label}</button>
      : <p className="field-hint">风险没有可定位的段落锚点。</p>}
  </article>;
}

function ConfirmationHistory(props: {
  records: readonly Confirmation[];
  ledger: ConfirmationLedger;
  liveId: string | null;
  currentSnapshot: SnapshotRef;
  reasons: Readonly<Record<string, string>>;
  onReason: (id: string, value: string) => void;
  onRevoke: (id: string) => void;
}) {
  if (props.records.length === 0) return <p className="muted">没有确认记录。</p>;
  return <div className="stack-3" data-testid="draft-review-confirmation-history">
    {props.records.map((confirmation) => {
      const revocation = props.ledger.revocations.find((item) => item.objectId === confirmation.id);
      const current = props.liveId === confirmation.id && isConfirmationCurrent(props.ledger, confirmation, props.currentSnapshot);
      return <section className="notice" key={confirmation.id} data-testid={`draft-review-confirmation-${confirmation.id}`}>
        <h4>{current ? "当前修订确认" : revocation ? "已撤销的确认" : "历史确认（当前修订无效）"}</h4>
        <p>确认人：{confirmation.actorId} · 身份：{confirmation.identity} · 时间：{confirmation.createdAt}</p>
        <p>SnapshotRef：{snapshotLabel(confirmation.snapshot)}</p>
        {revocation ? <p data-testid={`draft-review-revocation-${revocation.id}`}>撤销人：{revocation.actorId} · 时间：{revocation.createdAt} · 原因：{revocation.reason}</p> : null}
        {!isRevoked(props.ledger, confirmation.id) ? <div className="row" style={{ flexWrap: "wrap" }}>
          <label className="field">
            <span className="field-label">撤销原因</span>
            <input className="input" value={props.reasons[confirmation.id] ?? ""}
              onChange={(event) => props.onReason(confirmation.id, event.currentTarget.value)}
              data-testid={`draft-review-revoke-reason-${confirmation.id}`} />
          </label>
          <button type="button" className="btn btn-outline btn-sm" disabled={(props.reasons[confirmation.id] ?? "").trim().length === 0}
            data-testid={`draft-review-revoke-${confirmation.id}`} onClick={() => props.onRevoke(confirmation.id)}>撤销确认</button>
        </div> : null}
      </section>;
    })}
  </div>;
}

function initialState(matterId: string): DraftReviewState {
  return {
    phase: "loading",
    revision: null,
    snapshot: null,
    currentSnapshot: null,
    isCurrent: false,
    supportRows: [],
    locators: [],
    ledger: EMPTY_LEDGER(matterId),
    error: null,
  };
}

function allParagraphs(ast: DraftAST): Paragraph[] {
  return [
    ...ast.claims.flatMap((claim) => claim.paragraphs),
    ...ast.sections.flatMap((section) => section.paragraphs),
  ];
}

function collectSourceRefs(ast: DraftAST, facts: readonly Fact[]): SourceRef[] {
  const refs = [
    ...allParagraphs(ast).flatMap((paragraph) => paragraph.sourceRefs),
    ...buildSupportTable(ast, facts).flatMap((row) => row.sourceRefs),
  ];
  return mergeRefs(refs);
}

function mergeRefs(refs: readonly SourceRef[]): SourceRef[] {
  const unique = new Map<string, SourceRef>();
  for (const ref of refs) unique.set(sourceRefKey(ref), structuredClone(ref));
  return [...unique.values()];
}

function sourceRefKey(ref: SourceRef): string {
  return `${ref.sourceId}/${ref.chunkId}/${ref.chunkHash}/${ref.page ?? "null"}/${ref.start}/${ref.end}/${ref.quote}`;
}

function unlocatable(ref: SourceRef, key: string, reason: string, sourceName: string | null): DraftReviewLocator {
  return { key, ref: structuredClone(ref), status: "unlocatable", reason, sourceName, chunkText: null };
}

async function readLedger(tx: {
  get(store: "blobs", key: string): Promise<unknown>;
}, actor: Actor, matterId: string): Promise<ConfirmationLedger> {
  const raw = await tx.get(STORES.blobs, ledgerKey(actor, matterId));
  if (raw === undefined) return EMPTY_LEDGER(matterId);
  if (!isRecord(raw) || raw.kind !== "draft-review.confirmations" || raw.tenantId !== actor.tenantId
    || raw.actorId !== actor.userId || raw.matterId !== matterId || !isRecord(raw.ledger)
    || raw.ledger.matterId !== matterId || !Array.isArray(raw.ledger.confirmations) || !Array.isArray(raw.ledger.revocations)) {
    throw new Error("确认记录格式或归属无效。");
  }
  const confirmations = raw.ledger.confirmations.map((item) => confirmationSchema.parse(item));
  const revocations = raw.ledger.revocations.map((item) => {
    const parsed = revocationSchema.parse(item);
    if (parsed.objectType !== "confirmation") throw new Error("确认记录包含其他对象类型的撤销。");
    return parsed;
  }) as Revocation[];
  return { matterId, confirmations, revocations };
}

async function writeLedger(
  tx: { put(store: "blobs", key: string, value: unknown): Promise<void> },
  actor: Actor,
  ledger: ConfirmationLedger,
): Promise<void> {
  await tx.put(STORES.blobs, ledgerKey(actor, ledger.matterId), {
    kind: "draft-review.confirmations",
    tenantId: actor.tenantId,
    actorId: actor.userId,
    matterId: ledger.matterId,
    ledger: structuredClone(ledger),
  } satisfies StoredLedgerRow);
}

function ledgerKey(actor: Actor, matterId: string): string {
  return `draft-review/confirmations/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}`;
}

type MatterVersionRead =
  | { ok: true; version: number }
  | { ok: false; code: string; message: string };

async function currentMatterVersion(repository: LocalRepository, actor: Actor, matterId: string): Promise<MatterVersionRead> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return { ok: false, code: loaded.error.code, message: loaded.error.message };
  return { ok: true, version: loaded.data.data.matter.version };
}

function versionReadFailure(read: Extract<MatterVersionRead, { ok: false }>): DraftReviewAction {
  // Only a real missing/unauthorized matter is not-found; every other
  // repository/storage failure is retryable and must not masquerade as 404.
  if (read.code === "RESOURCE_NOT_FOUND") {
    return actionFailure("RESOURCE_NOT_FOUND", "案件不可用。");
  }
  return actionFailure("STORAGE_UNAVAILABLE", "无法读取案件版本，请重试。");
}

function confirmationEvent(
  actor: Actor,
  snapshot: SnapshotRef,
  action: "confirmation.created" | "confirmation.revoked",
  occurredAt: string,
  eventId: string,
  confirmationId: string,
): ActivityRecord {
  return activitySchema.parse({
    id: eventId,
    tenantId: actor.tenantId,
    matterId: snapshot.matterId,
    targetId: snapshot.targetId,
    actorId: actor.userId,
    actorKind: "user",
    action,
    snapshot,
    jobId: null,
    resourceId: confirmationId,
    occurredAt,
    metadata: { count: 1 },
  });
}

async function currentSnapshotInTransaction(
  tx: { get(store: "matters", key: string): Promise<unknown> },
  actor: Actor,
  matterId: string,
  targetId: string,
): Promise<SnapshotRef | null> {
  const aggregate = await readOwnedAggregate(tx, actor, matterId);
  if (!aggregate) return null;
  const target = aggregate.targets.find((item) => item.id === targetId);
  if (!target || typeof target.draftRevisionId !== "string" || typeof target.configVersion !== "number"
    || typeof target.figureRevisionId !== "string") return null;
  return {
    matterId,
    targetId,
    sourceVersion: aggregate.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: target.draftRevisionId,
    figureRevisionId: target.figureRevisionId,
  };
}

async function readOwnedAggregate(
  tx: { get(store: "matters", key: string): Promise<unknown> },
  actor: Actor,
  matterId: string,
): Promise<{ matter: { tenantId: string; createdBy: string; sourceVersion: number }; targets: readonly Record<string, unknown>[]; assets: readonly { id: string; originalName: string }[] } | null> {
  const value = await tx.get(STORES.matters, matterId);
  if (!isRecord(value) || !isRecord(value.matter) || !Array.isArray(value.targets) || !Array.isArray(value.assets)) return null;
  if (value.matter.tenantId !== actor.tenantId || value.matter.createdBy !== actor.userId
    || typeof value.matter.sourceVersion !== "number") return null;
  return value as unknown as {
    matter: { tenantId: string; createdBy: string; sourceVersion: number };
    targets: readonly Record<string, unknown>[];
    assets: readonly { id: string; originalName: string }[];
  };
}

function actionFailure(code: string, message: string): DraftReviewAction {
  return { ok: false, error: { code, message } };
}

function isActionFailure(value: unknown): value is { ok: false; error: { code: string; message: string } } {
  return isRecord(value) && value.ok === false && isRecord(value.error)
    && typeof value.error.code === "string" && typeof value.error.message === "string";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function snapshotLabel(snapshot: SnapshotRef): string {
  return `matter=${snapshot.matterId}; target=${snapshot.targetId}; source=${snapshot.sourceVersion}; config=${snapshot.targetConfigVersion}; draft=${snapshot.draftRevisionId}; figures=${snapshot.figureRevisionId}`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ReviewFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
