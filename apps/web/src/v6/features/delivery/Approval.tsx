import React, { useEffect, useMemo, useState } from "react";
import {
  activitySchema,
  approvalSchema,
  confirmationSchema,
  revocationSchema,
  type Approval,
  type Confirmation,
  type FigureSetRevision,
  type Revocation,
  type SnapshotRef,
} from "../../../../../../packages/contracts/src/index.ts";
import {
  confirmationStatus,
  currentConfirmations,
  type ConfirmationLedger,
} from "../../../../../../packages/domain/src/v6/confirmation.js";
import { evaluateGate, type GateDecision, type GateErrorCode } from "../../../../../../packages/domain/src/v6/gate.js";
import { isCurrent } from "../../../../../../packages/domain/src/v6/revision.js";
import { isCurrentCheckRun, type CheckRunResult } from "../../../../../../packages/domain/src/v6/checks.js";
import {
  createGenerationRevisionStore,
  type GenerationRevisionStore,
  type GenerationRevisionView,
} from "../generation/generation.ts";
import { readFigureLibrary } from "../sources/drawings.ts";
import { migrateLegacyConfirmationLedger } from "../preview/preview.ts";
import {
  ACTIVITY_METADATA_KEYS_BY_ACTION,
  STORES,
  type ActivityRecord,
  type Actor,
  type LocalRepository,
  type MatterAggregate,
} from "../../lib/repository.ts";

export type ApprovalRole = "owner" | "admin" | "reviewer" | "editor" | "viewer";
export type ApprovalConfirmationMode = "self_read" | "professional_paragraphs";

export interface ApprovalPanelProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string;
  /** Membership role supplied by the shell. Local R1 identity remains self-reported. */
  role: ApprovalRole;
  /** The live V6-23 result and the active rule-pack version supplied by the host. */
  checkResult: CheckRunResult | null;
  activeRulePackVersion: string;
  /** Availability of the current source and other referenced files, resolved by the host. */
  filesAvailable: boolean;
  confirmationMode?: ApprovalConfirmationMode;
  onSettled?: () => void;
  revisions?: GenerationRevisionStore;
  newId?: (label: string) => string;
  now?: () => string;
}

export interface ApprovalLedger {
  matterId: string;
  approvals: readonly Approval[];
  revocations: readonly Revocation[];
}

export interface ApprovalPanelState {
  phase: "loading" | "empty" | "ready" | "stale" | "error";
  snapshot: SnapshotRef | null;
  snapshotCurrent: boolean;
  inputStale: boolean;
  revision: GenerationRevisionView | null;
  figureSet: FigureSetRevision | null;
  figureAssetsAvailable: boolean;
  ledger: ApprovalLedger;
  confirmations: ConfirmationLedger;
  matterVersion: number | null;
  error: { code: string; message: string } | null;
}

export type ApprovalActionResult =
  | { ok: true; created: boolean; approval: Approval }
  | { ok: false; error: { code: string; message: string } };

export type ApprovalRevokeResult =
  | { ok: true; revocation: Revocation }
  | { ok: false; error: { code: string; message: string } };

interface StoredApprovalLedger {
  kind: "delivery.approvals";
  tenantId: string;
  actorId: string;
  matterId: string;
  ledger: ApprovalLedger;
}

interface StoredConfirmationLedger {
  kind: "draft-review.confirmations";
  tenantId: string;
  actorId: string;
  matterId: string;
  ledger: ConfirmationLedger;
}

interface TransactionFailure {
  ok: false;
  error: { code: string; message: string };
}

interface TransactionSuccess<T> {
  ok: true;
  value: T;
}

type TransactionResult<T> = TransactionSuccess<T> | TransactionFailure;

const EMPTY_APPROVAL_LEDGER = (matterId: string): ApprovalLedger => ({ matterId, approvals: [], revocations: [] });
const EMPTY_CONFIRMATION_LEDGER = (matterId: string): ConfirmationLedger => ({ matterId, confirmations: [], revocations: [] });
const ROLE_CAN_APPROVE: ReadonlySet<ApprovalRole> = new Set(["owner", "admin", "reviewer"]);
const ROLE_LABELS: Readonly<Record<ApprovalRole, string>> = Object.freeze({
  owner: "负责人",
  admin: "管理员",
  reviewer: "审阅者",
  editor: "编辑者",
  viewer: "查看者",
});

function defaultId(_label: string): string {
  return globalThis.crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function approvalLedgerKey(actor: Actor, matterId: string): string {
  return `delivery/approvals/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}`;
}

function confirmationLedgerKey(actor: Actor, matterId: string): string {
  return `draft-review/confirmations/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}`;
}

function sameSnapshot(a: SnapshotRef, b: SnapshotRef): boolean {
  return isCurrent(a, b);
}

function snapshotFrom(aggregate: MatterAggregate, targetId: string): SnapshotRef | null {
  const target = aggregate.targets.find((item) => item.id === targetId && item.matterId === aggregate.matter.id);
  if (!target || target.draftRevisionId === null) return null;
  return {
    matterId: aggregate.matter.id,
    targetId,
    sourceVersion: aggregate.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: target.draftRevisionId,
    figureRevisionId: target.figureRevisionId,
  };
}

function sameDraftInput(revision: GenerationRevisionView, snapshot: SnapshotRef): boolean {
  const input = revision.revision.input;
  return input.matterId === snapshot.matterId
    && input.targetId === snapshot.targetId
    && input.sourceVersion === snapshot.sourceVersion
    && input.targetConfigVersion === snapshot.targetConfigVersion
    && input.figureRevisionId === snapshot.figureRevisionId;
}

function liveApprovalLedger(value: unknown, actor: Actor, matterId: string): ApprovalLedger {
  if (value === undefined) return EMPTY_APPROVAL_LEDGER(matterId);
  if (!isRecord(value) || value.kind !== "delivery.approvals" || value.tenantId !== actor.tenantId
    || value.actorId !== actor.userId || value.matterId !== matterId || !isRecord(value.ledger)
    || value.ledger.matterId !== matterId || !Array.isArray(value.ledger.approvals) || !Array.isArray(value.ledger.revocations)) {
    throw new Error("批准记录格式或归属无效。");
  }
  const approvals = value.ledger.approvals.map((item) => approvalSchema.parse(item));
  const revocations = value.ledger.revocations.map((item) => {
    const parsed = revocationSchema.parse(item);
    if (parsed.objectType !== "approval") throw new Error("批准记录包含其他对象类型的撤销。");
    return parsed;
  });
  return { matterId, approvals, revocations };
}

function liveConfirmationLedger(value: unknown, actor: Actor, matterId: string): ConfirmationLedger {
  if (value === undefined) return EMPTY_CONFIRMATION_LEDGER(matterId);
  if (!isRecord(value) || value.kind !== "draft-review.confirmations" || value.tenantId !== actor.tenantId
    || value.actorId !== actor.userId || value.matterId !== matterId || !isRecord(value.ledger)
    || value.ledger.matterId !== matterId || !Array.isArray(value.ledger.confirmations) || !Array.isArray(value.ledger.revocations)) {
    throw new Error("确认记录格式或归属无效。");
  }
  const confirmations = value.ledger.confirmations.map((item) => confirmationSchema.parse(item));
  const revocations = value.ledger.revocations.map((item) => {
    const parsed = revocationSchema.parse(item);
    if (parsed.objectType !== "confirmation") throw new Error("确认记录包含其他对象类型的撤销。");
    return { ...parsed, objectType: "confirmation" as const };
  });
  return { matterId, confirmations, revocations };
}

function isRevoked(ledger: ApprovalLedger, approvalId: string): boolean {
  return ledger.revocations.some((item) => item.objectId === approvalId);
}

function failure(code: string, message: string): TransactionFailure {
  return { ok: false, error: { code, message } };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * The approval panel's public command seam. It persists append-only records in
 * the LocalRepository backend and delegates every gate decision to V6-05.
 */
export class ApprovalSession {
  private readonly repository: LocalRepository;
  private readonly actor: Actor;
  private readonly matterId: string;
  private readonly targetId: string;
  private readonly role: ApprovalRole;
  private readonly checkResult: CheckRunResult | null;
  private readonly activeRulePackVersion: string;
  private readonly filesAvailable: boolean;
  private readonly confirmationMode: ApprovalConfirmationMode;
  private readonly revisions: GenerationRevisionStore;
  private readonly newId: (label: string) => string;
  private readonly now: () => string;
  private state: ApprovalPanelState;
  private readonly listeners = new Set<(state: ApprovalPanelState) => void>();

  constructor(options: ApprovalPanelProps) {
    this.repository = options.repository;
    this.actor = options.actor;
    this.matterId = options.matterId;
    this.targetId = options.targetId;
    this.role = options.role;
    this.checkResult = options.checkResult;
    this.activeRulePackVersion = options.activeRulePackVersion;
    this.filesAvailable = options.filesAvailable;
    this.confirmationMode = options.confirmationMode ?? "professional_paragraphs";
    this.revisions = options.revisions ?? createGenerationRevisionStore({
      repository: options.repository,
      actor: options.actor,
    });
    this.newId = options.newId ?? defaultId;
    this.now = options.now ?? (() => new Date().toISOString());
    this.state = initialState(options.matterId);
  }

  getSnapshot(): ApprovalPanelState {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: ApprovalPanelState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    await this.readState();
  }

  async refresh(): Promise<void> {
    await this.readState();
  }

  getGateDecision(action: "approve" | "export", approval?: Approval | null): GateDecision | null {
    if (action === "export" && approval) return this.getGateDecisionForRecord(approval);
    const state = this.state;
    const snapshot = state.snapshot;
    if (!snapshot || !state.revision || !state.figureSet) return null;
    return this.evaluate(action, snapshot, state.snapshotCurrent, state.inputStale, state.figureAssetsAvailable, state.confirmations, approval ?? null);
  }

  getGateDecisionForRecord(approval: Approval): GateDecision | null {
    const state = this.state;
    const currentSnapshot = state.snapshot;
    if (!currentSnapshot || !state.revision || !state.figureSet) return null;
    const bindingIsCurrent = state.snapshotCurrent && sameSnapshot(approval.snapshot, currentSnapshot);
    const decision = this.evaluate(
      "export",
      approval.snapshot,
      bindingIsCurrent,
      state.inputStale,
      state.figureAssetsAvailable,
      state.confirmations,
      approval,
    );
    const currentConfirmationIds = currentConfirmations(state.confirmations, currentSnapshot).map((item) => item.id);
    if (sameStrings(approval.confirmationIds, currentConfirmationIds)) return decision;
    const reasons = decision.reasons.some((item) => item.code === "APPROVAL_REQUIRED" && item.resourceId === approval.id)
      ? decision.reasons
      : [...decision.reasons, { code: "APPROVAL_REQUIRED" as const, resourceId: approval.id }];
    return { ...decision, allowed: false, reasons };
  }

  async createApproval(note: string): Promise<ApprovalActionResult> {
    if (!ROLE_CAN_APPROVE.has(this.role)) {
      return actionFailure("ACTION_FORBIDDEN", this.role === "editor"
        ? "编辑者不能通过此操作提升自己的审批权限。"
        : "当前角色不能创建内部批准记录。");
    }
    const state = this.state;
    const snapshot = state.snapshot;
    const checkRun = this.checkResult?.checkRun ?? null;
    if (state.phase === "loading" || state.phase === "error" || state.phase === "empty" || !snapshot || !state.revision || !state.figureSet) {
      return actionFailure("STALE_BINDING", "当前目标没有可批准的稳定草稿；请刷新后再试。");
    }
    const gate = this.getGateDecision("approve");
    if (!gate?.allowed) {
      return actionFailure("GATE_BLOCKED", gate ? describeReasons(gate.reasons) : "批准门禁尚未完成评估。");
    }
    if (!checkRun) return actionFailure("CHECK_REQUIRED", "当前没有可用的检查结果。");

    const loaded = await this.repository.loadMatter(this.actor, this.matterId);
    if (!loaded.ok) return actionFailure(loaded.error.code, loaded.error.message);
    const expectedVersion = loaded.data.version;
    let transactionResult: TransactionResult<{ approval: Approval; created: boolean }>;
    try {
      transactionResult = await this.repository.backend.transaction("readwrite", async (tx) => {
        const rawAggregate = await tx.get(STORES.matters, this.matterId);
        const aggregate = ownedAggregate(rawAggregate, this.actor, this.matterId);
        if (!aggregate) return failure("RESOURCE_NOT_FOUND", "案件不可用。");
        if (aggregate.matter.version !== expectedVersion) return failure("VERSION_CONFLICT", "案件版本已变化；请刷新后重试。");
        if (aggregate.matter.status !== "active") return failure("INVALID_TRANSITION", "当前案件不可写入批准记录。");
        const target = aggregate.targets.find((item) => item.id === this.targetId && item.matterId === this.matterId);
        if (!target) return failure("RESOURCE_NOT_FOUND", "目标不可用。");
        const currentSnapshot = snapshotFrom(aggregate, this.targetId);
        if (!currentSnapshot || !sameSnapshot(currentSnapshot, snapshot)) {
          return failure("STALE_BINDING", "SnapshotRef 已变化；请刷新后重新检查。");
        }
        const currentConfirmation = liveConfirmationLedger(
          await tx.get(STORES.blobs, confirmationLedgerKey(this.actor, this.matterId)),
          this.actor,
          this.matterId,
        );
        const decision = this.evaluate(
          "approve",
          currentSnapshot,
          true,
          state.inputStale,
          state.figureAssetsAvailable,
          currentConfirmation,
          null,
        );
        if (!decision.allowed) return failure("GATE_BLOCKED", describeReasons(decision.reasons));
        const confirmationIds = currentConfirmations(currentConfirmation, currentSnapshot).map((item) => item.id);
        const ledger = liveApprovalLedger(
          await tx.get(STORES.blobs, approvalLedgerKey(this.actor, this.matterId)),
          this.actor,
          this.matterId,
        );
        const existing = [...ledger.approvals].reverse().find((item) => !isRevoked(ledger, item.id)
          && item.actorId === this.actor.userId
          && sameSnapshot(item.snapshot, currentSnapshot)
          && item.checkRunId === checkRun.id
          && sameStrings(item.confirmationIds, confirmationIds));
        if (existing) return { ok: true, value: { approval: existing, created: false } };

        const at = this.now();
        const approval = approvalSchema.parse({
          id: this.newId("approval"),
          snapshot: currentSnapshot,
          checkRunId: checkRun.id,
          confirmationIds,
          actorId: this.actor.userId,
          purpose: "internal_release",
          note: note.trim(),
          createdAt: at,
        });
        const nextLedger: ApprovalLedger = { ...ledger, approvals: [...ledger.approvals, approval] };
        const event = approvalEvent(this.actor, currentSnapshot, "approval.created", at, this.newId("approval-event"), approval.id, { count: 1 });
        const eventExists = await tx.get(STORES.events, event.id);
        if (eventExists !== undefined) return failure("INVALID_INPUT", "活动事件 ID 已存在；请重新尝试。");
        const nextMatter = { ...aggregate.matter, version: expectedVersion + 1, updatedAt: at };
        await tx.put(STORES.matters, this.matterId, {
          matter: nextMatter,
          targets: structuredClone(aggregate.targets),
          assets: structuredClone(aggregate.assets),
        });
        await tx.put(STORES.events, event.id, event);
        await tx.put(STORES.blobs, approvalLedgerKey(this.actor, this.matterId), approvalLedgerRow(this.actor, nextLedger));
        return { ok: true, value: { approval, created: true } };
      });
    } catch (error) {
      transactionResult = failure("STORAGE_UNAVAILABLE", errorMessage(error, "批准记录保存失败。"));
    }
    if (!transactionResult.ok) {
      await this.refresh();
      return { ok: false, error: transactionResult.error };
    }
    await this.refresh();
    return { ok: true, ...transactionResult.value };
  }

  async revokeApproval(approvalId: string, reason: string): Promise<ApprovalRevokeResult> {
    if (!ROLE_CAN_APPROVE.has(this.role)) return actionFailure("ACTION_FORBIDDEN", "当前角色不能撤销内部批准记录。");
    const trimmedReason = reason.trim();
    if (trimmedReason.length === 0) return actionFailure("INVALID_INPUT", "撤销原因不能为空。");
    const loaded = await this.repository.loadMatter(this.actor, this.matterId);
    if (!loaded.ok) return actionFailure(loaded.error.code, loaded.error.message);
    const expectedVersion = loaded.data.version;
    let transactionResult: TransactionResult<Revocation>;
    try {
      transactionResult = await this.repository.backend.transaction("readwrite", async (tx) => {
        const rawAggregate = await tx.get(STORES.matters, this.matterId);
        const aggregate = ownedAggregate(rawAggregate, this.actor, this.matterId);
        if (!aggregate) return failure("RESOURCE_NOT_FOUND", "案件不可用。");
        if (aggregate.matter.version !== expectedVersion) return failure("VERSION_CONFLICT", "案件版本已变化；请刷新后重试。");
        if (aggregate.matter.status !== "active") return failure("INVALID_TRANSITION", "当前案件不可写入撤销记录。");
        const ledger = liveApprovalLedger(
          await tx.get(STORES.blobs, approvalLedgerKey(this.actor, this.matterId)),
          this.actor,
          this.matterId,
        );
        const approval = ledger.approvals.find((item) => item.id === approvalId);
        if (!approval) return failure("RESOURCE_NOT_FOUND", "批准记录不可用。");
        if (isRevoked(ledger, approval.id)) return failure("INVALID_TRANSITION", "此批准记录已撤销。");
        const at = this.now();
        const revocation = revocationSchema.parse({
          id: this.newId("approval-revocation"),
          objectType: "approval",
          objectId: approval.id,
          actorId: this.actor.userId,
          reason: trimmedReason,
          createdAt: at,
        });
        const nextLedger: ApprovalLedger = { ...ledger, revocations: [...ledger.revocations, revocation] };
        const event = approvalEvent(this.actor, approval.snapshot, "approval.revoked", at, this.newId("approval-revoke-event"), approval.id, {});
        if (await tx.get(STORES.events, event.id) !== undefined) return failure("INVALID_INPUT", "活动事件 ID 已存在；请重新尝试。");
        const nextMatter = { ...aggregate.matter, version: expectedVersion + 1, updatedAt: at };
        await tx.put(STORES.matters, this.matterId, {
          matter: nextMatter,
          targets: structuredClone(aggregate.targets),
          assets: structuredClone(aggregate.assets),
        });
        await tx.put(STORES.events, event.id, event);
        await tx.put(STORES.blobs, approvalLedgerKey(this.actor, this.matterId), approvalLedgerRow(this.actor, nextLedger));
        return { ok: true, value: revocation };
      });
    } catch (error) {
      transactionResult = failure("STORAGE_UNAVAILABLE", errorMessage(error, "撤销记录保存失败。"));
    }
    if (!transactionResult.ok) {
      await this.refresh();
      return { ok: false, error: transactionResult.error };
    }
    await this.refresh();
    return { ok: true, revocation: transactionResult.value };
  }

  private async readState(): Promise<void> {
    this.setState({ ...this.state, phase: "loading", error: null });
    try {
      const loaded = await this.repository.loadMatter(this.actor, this.matterId);
      if (!loaded.ok) throw new ApprovalReadFailure(loaded.error.code, loaded.error.message);
      const aggregate = loaded.data.data;
      const target = aggregate.targets.find((item) => item.id === this.targetId);
      if (!target) throw new ApprovalReadFailure("RESOURCE_NOT_FOUND", "目标不可用。");
      await migrateLegacyConfirmationLedger(this.repository, this.actor, this.matterId);
      const [head, figureRead, records] = await Promise.all([
        this.revisions.loadHeadRevision(this.matterId, this.targetId),
        readFigureLibrary(this.repository, this.actor, this.matterId),
        this.repository.backend.transaction("readonly", async (tx) => ({
          approval: await tx.get(STORES.blobs, approvalLedgerKey(this.actor, this.matterId)),
          confirmation: await tx.get(STORES.blobs, confirmationLedgerKey(this.actor, this.matterId)),
        })),
      ]);
      if (!head.ok) throw new ApprovalReadFailure(head.error.code, head.error.message);
      if (!figureRead.ok) throw new ApprovalReadFailure(figureRead.error.code, figureRead.error.message);
      const ledger = liveApprovalLedger(records.approval, this.actor, this.matterId);
      const confirmations = liveConfirmationLedger(records.confirmation, this.actor, this.matterId);
      if (target.draftRevisionId === null) {
        this.setState({
          ...initialState(this.matterId),
          phase: "empty",
          ledger,
          confirmations,
          matterVersion: aggregate.matter.version,
        });
        return;
      }
      if (head.data === null) throw new ApprovalReadFailure("RESOURCE_NOT_FOUND", "目标指向的草稿修订不可读取。");
      const revision = head.data;
      const snapshot = snapshotFrom(aggregate, this.targetId);
      const snapshotCurrent = snapshot !== null && revision.revision.id === target.draftRevisionId;
      if (!snapshot) throw new ApprovalReadFailure("STALE_BINDING", "目标快照尚未绑定可批准的修订。");
      const figureSet = figureRead.data.current.get(this.targetId) ?? null;
      if (!figureSet) throw new ApprovalReadFailure("MISSING_BYTES", "当前目标的附图集不可读取；批准已阻止。");
      const drawingById = new Map(figureRead.data.drawings.map((item) => [item.drawing.id, item]));
      let figureAssetsAvailable = figureSet.id === snapshot.figureRevisionId;
      for (const entry of figureSet.entries) {
        if (entry.drawingId === null) {
          figureAssetsAvailable = false;
          continue;
        }
        const drawing = drawingById.get(entry.drawingId);
        if (!drawing || drawing.asset.state !== "available") {
          figureAssetsAvailable = false;
          continue;
        }
        const bytes = await this.repository.readBlob(this.actor, drawing.asset.id);
        if (!bytes.ok) figureAssetsAvailable = false;
      }
      const inputStale = !sameDraftInput(revision, snapshot);
      const checkStale = this.checkResult !== null
        && !isCurrentCheckRun(this.checkResult.checkRun, snapshot, this.activeRulePackVersion);
      const phase = !snapshotCurrent || inputStale || checkStale ? "stale" : "ready";
      this.setState({
        phase,
        snapshot,
        snapshotCurrent,
        inputStale,
        revision,
        figureSet,
        figureAssetsAvailable,
        ledger,
        confirmations,
        matterVersion: aggregate.matter.version,
        error: null,
      });
    } catch (error) {
      this.setState({
        ...this.state,
        phase: "error",
        error: error instanceof ApprovalReadFailure
          ? { code: error.code, message: error.message }
          : { code: "STORAGE_UNAVAILABLE", message: errorMessage(error, "批准数据读取失败。") },
      });
    }
  }

  private evaluate(
    action: "approve" | "export",
    snapshot: SnapshotRef,
    snapshotCurrent: boolean,
    inputStale: boolean,
    figureAssetsAvailable: boolean,
    ledger: ConfirmationLedger,
    approval: Approval | null,
  ): GateDecision {
    const checkRun = this.checkResult?.checkRun ?? null;
    const live = currentConfirmations(ledger, snapshot);
    const aiParagraphIds = this.state.revision ? allParagraphs(this.state.revision.ast)
      .filter((paragraph) => paragraph.origin === "ai" || paragraph.origin === "mixed")
      .map((paragraph) => paragraph.id) : [];
    const evaluated = evaluateGate({
      action,
      snapshot,
      snapshotCurrent,
      filesAvailable: this.filesAvailable && figureAssetsAvailable,
      rulePackVersion: checkRun?.rulePackVersion ?? this.activeRulePackVersion,
      activeRulePackVersion: this.activeRulePackVersion,
      checkRun,
      approval,
      confirmations: live,
      risks: checkRun?.findings ?? [],
      now: this.now(),
    }, {
      packageKind: "internally_approved",
      confirmationMode: this.confirmationMode,
      inputStale,
      aiParagraphIds,
      blockingPolicyRuleIds: this.checkResult?.blockingPolicyRuleIds[action] ?? [],
    });
    return evaluated;
  }

  private setState(state: ApprovalPanelState): void {
    this.state = state;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}

/** Small public panel. The route owner supplies current checks, file state and membership role. */
export function ApprovalPanel(props: ApprovalPanelProps) {
  const session = useMemo(() => new ApprovalSession(props), [
    props.repository,
    props.actor,
    props.matterId,
    props.targetId,
    props.role,
    props.checkResult,
    props.activeRulePackVersion,
    props.filesAvailable,
    props.confirmationMode,
    props.onSettled,
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

  const model = useMemo(() => buildModel(state, props, session), [state, props, session]);
  return <ApprovalPanelView
    model={model}
    role={props.role}
    onRefresh={() => session.refresh()}
    onCreate={async (note) => {
      const result = await session.createApproval(note);
      if (result.ok) props.onSettled?.();
      return result;
    }}
    onRevoke={async (id, reason) => {
      const result = await session.revokeApproval(id, reason);
      if (result.ok) props.onSettled?.();
      return result;
    }}
  />;
}

interface ApprovalRecordView {
  approval: Approval;
  revocation: Revocation | null;
  decision: GateDecision | null;
}

interface ApprovalPanelModel {
  state: ApprovalPanelState;
  approveDecision: GateDecision | null;
  exportDecision: GateDecision | null;
  checkStatus: string;
  rulePackStatus: string;
  checkValid: boolean;
  aiParagraphIds: readonly string[];
  confirmedAiParagraphIds: readonly string[];
  fullReadConfirmed: boolean;
  risks: readonly { id: string; title: string; acknowledged: boolean; requiresAcknowledgement: boolean }[];
  records: readonly ApprovalRecordView[];
  filesAvailable: boolean;
  roleCanApprove: boolean;
}

function buildModel(state: ApprovalPanelState, props: ApprovalPanelProps, session: ApprovalSession): ApprovalPanelModel {
  const snapshot = state.snapshot;
  const checkRun = props.checkResult?.checkRun ?? null;
  const aiParagraphIds = state.revision ? allParagraphs(state.revision.ast)
    .filter((paragraph) => paragraph.origin === "ai" || paragraph.origin === "mixed")
    .map((paragraph) => paragraph.id) : [];
  const validCheck = snapshot !== null && checkRun !== null
    && isCurrentCheckRun(checkRun, snapshot, props.activeRulePackVersion);
  const coverage = snapshot ? confirmationStatus(
    state.confirmations,
    snapshot,
    aiParagraphIds,
    checkRun?.id ?? null,
  ) : { fullRead: false, confirmedAiParagraphIds: [], pendingAiParagraphIds: [], acknowledgedRiskIds: [] };
  const records: ApprovalRecordView[] = [...state.ledger.approvals].reverse().map((approval) => {
    const revocation = state.ledger.revocations.find((item) => item.objectId === approval.id) ?? null;
    const decision = revocation || !snapshot || !state.figureSet
      ? null
      : session.getGateDecisionForRecord(approval);
    return { approval, revocation, decision };
  });
  const currentApproval = [...state.ledger.approvals].reverse().find((item) => !isRevoked(state.ledger, item.id)) ?? null;
  return {
    state,
    approveDecision: session.getGateDecision("approve"),
    exportDecision: session.getGateDecision("export", currentApproval),
    checkStatus: checkStatus(checkRun, snapshot, props.activeRulePackVersion),
    rulePackStatus: checkRun
      ? `检查 ${checkRun.rulePackVersion} · 当前启用 ${props.activeRulePackVersion}`
      : `尚无检查 · 当前启用 ${props.activeRulePackVersion}`,
    checkValid: validCheck,
    aiParagraphIds,
    confirmedAiParagraphIds: coverage.confirmedAiParagraphIds,
    fullReadConfirmed: coverage.fullRead,
    risks: (checkRun?.findings ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      acknowledged: coverage.acknowledgedRiskIds.includes(item.id),
      requiresAcknowledgement: item.requiresAcknowledgement,
    })),
    records,
    filesAvailable: props.filesAvailable && state.figureAssetsAvailable,
    roleCanApprove: ROLE_CAN_APPROVE.has(props.role),
  };
}

export interface ApprovalPanelViewProps {
  model: ApprovalPanelModel;
  role: ApprovalRole;
  onRefresh: () => void | Promise<void>;
  onCreate: (note: string) => ApprovalActionResult | Promise<ApprovalActionResult>;
  onRevoke: (approvalId: string, reason: string) => ApprovalRevokeResult | Promise<ApprovalRevokeResult>;
}

/** Exported for standalone shell composition and accessible state verification. */
export function ApprovalPanelView({ model, role, onRefresh, onCreate, onRevoke }: ApprovalPanelViewProps) {
  const [note, setNote] = useState("");
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);
  const state = model.state;

  if (state.phase === "loading") return <section className="card" data-testid="approval-panel" data-state="loading" aria-busy="true">
    <h2 className="card-title">内部交付批准</h2><p className="muted">正在读取当前快照、检查和记录…</p><div className="skeleton v6-skeleton" />
  </section>;
  if (state.phase === "error") return <section className="card stack-3" data-testid="approval-panel" data-state="error">
    <h2 className="card-title">内部交付批准</h2>
    <div className="notice" role="alert" data-testid="approval-error" data-code={state.error?.code}>
      <strong>批准数据读取失败（{state.error?.code}）</strong><p>{state.error?.message}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => void onRefresh()}>重试读取</button>
    </div>
  </section>;
  if (state.phase === "empty" || !state.snapshot || !state.revision || !state.figureSet) return <section className="card stack-3" data-testid="approval-panel" data-state="empty">
    <h2 className="card-title">内部交付批准</h2><p className="muted">当前目标没有可批准的草稿修订。</p>
    {state.ledger.approvals.length === 0 ? <p className="field-hint">尚无内部批准记录。</p> : <div className="stack-2" data-testid="approval-history-empty">
      <h3 className="card-title">历史批准记录</h3>
      {state.ledger.approvals.map((approval) => {
        const revocation = state.ledger.revocations.find((item) => item.objectId === approval.id);
        return <p key={approval.id} data-testid={`approval-record-${approval.id}`}>
          {revocation ? `已撤销 · ${revocation.reason}` : "无当前草稿绑定 · STALE_BINDING"} · {approval.id}
        </p>;
      })}
    </div>}
  </section>;

  const approveAllowed = model.approveDecision?.allowed === true && model.roleCanApprove;
  const create = async () => {
    if (!approveAllowed || pending) return;
    setPending("create");
    setActionError(null);
    const result = await onCreate(note);
    if (!result.ok) setActionError(result.error);
    setPending(null);
  };
  const revoke = async (approvalId: string) => {
    if (pending) return;
    setPending(approvalId);
    setActionError(null);
    const result = await onRevoke(approvalId, revokeReasons[approvalId] ?? "");
    if (!result.ok) setActionError(result.error);
    else setRevokeReasons((previous) => ({ ...previous, [approvalId]: "" }));
    setPending(null);
  };

  return <section className="card stack-3" data-testid="approval-panel" data-state={state.phase}>
    <header className="stack-2">
      <div className="row-between" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <div><h2 className="card-title">内部交付批准</h2><p className="muted">仅记录团队内部放行决定，不生成签名凭证或递交回执。</p></div>
        <button type="button" className="btn btn-outline btn-sm" data-testid="approval-refresh" onClick={() => void onRefresh()}>刷新状态</button>
      </div>
      <p className="notice" data-testid="approval-preparation-label">申请准备材料，非已提交文件</p>
    </header>

    {state.phase === "stale" ? <div className="notice" role="status" data-testid="approval-stale">
      <strong>批准条件已陈旧</strong>
      <p>{state.inputStale ? "草稿输入与当前案件、配置或附图版本不一致（INPUT_STALE）。" : "检查或快照已变化；现有批准会按当前门禁重新计算。"}</p>
    </div> : null}

    <section className="stack-2" data-testid="approval-snapshot">
      <h3 className="card-title">当前 SnapshotRef</h3>
      <dl className="kv">
        <dt>matterId</dt><dd>{state.snapshot.matterId}</dd>
        <dt>targetId</dt><dd>{state.snapshot.targetId}</dd>
        <dt>sourceVersion</dt><dd>{state.snapshot.sourceVersion}</dd>
        <dt>targetConfigVersion</dt><dd>{state.snapshot.targetConfigVersion}</dd>
        <dt>draftRevisionId</dt><dd>{state.snapshot.draftRevisionId}</dd>
        <dt>figureRevisionId</dt><dd>{state.snapshot.figureRevisionId}</dd>
      </dl>
    </section>

    <section className="stack-2" data-testid="approval-prerequisites">
      <h3 className="card-title">门禁前置条件</h3>
      <dl className="kv">
        <dt>当前检查</dt><dd data-testid="approval-check-validity">{model.checkStatus}</dd>
        <dt>AI / 混合段落</dt><dd data-testid="approval-ai-coverage">{model.confirmedAiParagraphIds.length} / {model.aiParagraphIds.length} 已确认</dd>
        <dt>通读确认</dt><dd data-testid="approval-full-read">{model.fullReadConfirmed ? "当前快照已确认" : "未确认"}</dd>
        <dt>输入陈旧</dt><dd data-testid="approval-input-stale">{state.inputStale ? "是 · INPUT_STALE" : "否"}</dd>
        <dt>引用文件</dt><dd data-testid="approval-files-available">{model.filesAvailable ? "当前可用" : "缺失或不可用 · MISSING_BYTES"}</dd>
        <dt>附图集</dt><dd data-testid="approval-figure-set">{state.figureSet.id} · {state.figureSet.entries.length} 张</dd>
        <dt>规则包</dt><dd data-testid="approval-rule-pack">{model.rulePackStatus}</dd>
        <dt>当前角色</dt><dd data-testid="approval-role">{ROLE_LABELS[role]} · {model.roleCanApprove ? "可执行批准" : "不可批准（ACTION_FORBIDDEN）"}</dd>
      </dl>
      <div className="stack-2" data-testid="approval-risk-coverage">
        <h4>风险确认</h4>
        {model.risks.length === 0 ? <p className="muted">当前检查没有列出风险项目。</p> : model.risks.map((risk) => <p key={risk.id} data-testid={`approval-risk-${risk.id}`}>
          {risk.title} · {risk.requiresAcknowledgement ? risk.acknowledged ? "当前检查已确认" : "待确认" : "无需确认"} · {risk.id}
        </p>)}
      </div>
    </section>

    <DecisionPanel title="批准门禁" testId="approval-gate-approve" decision={model.approveDecision} />
    <DecisionPanel title="导出门禁" testId="approval-gate-export" decision={model.exportDecision} />

    <section className="card stack-3" data-testid="approval-create">
      <h3 className="card-title">创建内部批准记录</h3>
      <label className="field"><span className="field-label">内部备注</span>
        <textarea className="input" value={note} onChange={(event) => setNote(event.currentTarget.value)} rows={3} data-testid="approval-note" />
      </label>
      <button type="button" className="btn btn-default" data-testid="approval-create-button" disabled={!approveAllowed || pending !== null} onClick={() => void create()}>
        {pending === "create" ? "正在保存…" : "记录内部批准"}
      </button>
      {!model.roleCanApprove ? <p className="field-hint">编辑角色不能自行提升为审批角色；请由当前已授权的负责人、管理员或审阅者处理。</p> : null}
    </section>

    {actionError ? <div className="notice" role="alert" data-testid="approval-action-error" data-code={actionError.code}>
      <strong>操作未完成（{actionError.code}）</strong><p>{actionError.message}</p>
    </div> : null}

    <section className="stack-3" data-testid="approval-history">
      <h3 className="card-title">批准记录与撤销</h3>
      {model.records.length === 0 ? <p className="muted">尚无内部批准记录。</p> : model.records.map(({ approval, revocation, decision }) => <article className="v6-entry stack-2" key={approval.id} data-testid={`approval-record-${approval.id}`}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <strong>{revocation ? "已撤销（追加记录）" : decision?.allowed ? "当前有效" : "当前无效"}</strong>
          {!revocation && decision && !decision.allowed ? <span>{describeReasons(decision.reasons)}</span> : null}
        </div>
        <p>内部记录 {approval.id} · 操作者 {approval.actorId} · {approval.createdAt}</p>
        <p>SnapshotRef：{snapshotLabel(approval.snapshot)}</p>
        <p>检查：{approval.checkRunId} · 确认记录：{approval.confirmationIds.length}</p>
        {approval.note ? <p>备注：{approval.note}</p> : null}
        {revocation ? <p role="status" data-testid={`approval-revocation-${revocation.id}`}>撤销人 {revocation.actorId} · {revocation.createdAt} · 原因：{revocation.reason}</p> : !revocation ? <div className="row" style={{ flexWrap: "wrap", alignItems: "end" }}>
          <label className="field"><span className="field-label">撤销原因</span>
            <input className="input" value={revokeReasons[approval.id] ?? ""}
              onChange={(event) => setRevokeReasons((previous) => ({ ...previous, [approval.id]: event.currentTarget.value }))}
              data-testid={`approval-revoke-reason-${approval.id}`} />
          </label>
          <button type="button" className="btn btn-outline btn-sm" data-testid={`approval-revoke-${approval.id}`}
            disabled={!model.roleCanApprove || pending !== null || (revokeReasons[approval.id] ?? "").trim().length === 0}
            onClick={() => void revoke(approval.id)}>{pending === approval.id ? "正在保存…" : "撤销批准"}</button>
        </div> : null}
      </article>)}
    </section>
  </section>;
}

function DecisionPanel({ title, testId, decision }: { title: string; testId: string; decision: GateDecision | null }) {
  return <section className="stack-2" data-testid={testId} data-allowed={decision?.allowed ? "true" : "false"}>
    <h3 className="card-title">{title}</h3>
    {!decision ? <p className="muted">等待当前快照和检查结果。</p> : decision.allowed
      ? <p role="status">门禁允许 · {decision.evaluatedAt}</p>
      : <div className="notice" role="status"><strong>门禁阻止操作</strong>
        <ul>{decision.reasons.map((reason, index) => <li key={`${reason.code}-${reason.resourceId ?? ""}-${index}`}>
          <code>{reason.code}</code>{reason.resourceId ? ` · ${reason.resourceId}` : ""} · {reasonText(reason.code)}
        </li>)}</ul>
      </div>}
  </section>;
}

function checkStatus(
  checkRun: CheckRunResult["checkRun"] | null,
  snapshot: SnapshotRef | null,
  activeRulePackVersion: string,
): string {
  if (!checkRun) return "无当前结果 · CHECK_REQUIRED";
  if (checkRun.state !== "succeeded") return `${checkRun.state} · CHECK_REQUIRED`;
  if (!snapshot || !sameSnapshot(checkRun.snapshot, snapshot)) return "已过期 · STALE_BINDING";
  if (!isCurrentCheckRun(checkRun, snapshot, activeRulePackVersion)) return "已过期 · CHECK_REQUIRED";
  return `有效 · ${checkRun.id}`;
}

function reasonText(code: GateErrorCode | string): string {
  const labels: Readonly<Record<string, string>> = {
    GATE_BLOCKED: "存在适用阻断项。",
    CHECK_REQUIRED: "需要成功且绑定当前快照和规则包的检查。",
    CONFIRMATION_REQUIRED: "风险或内容确认尚未满足。",
    APPROVAL_REQUIRED: "批准记录缺失、撤销或依赖已变化。",
    INPUT_STALE: "草稿输入早于当前材料、配置或附图版本。",
    STALE_BINDING: "批准或检查绑定的 SnapshotRef 已变化。",
    MISSING_BYTES: "至少一个引用文件不可用。",
    BAD_DRAWING: "存在无效附图。",
    DUPLICATE_FIGURE_NUMBER: "附图编号重复。",
    INVALID_AST: "草稿结构无效。",
  };
  return labels[code] ?? "请按门禁原因更新当前记录。";
}

function describeReasons(reasons: readonly { code: string; resourceId?: string }[]): string {
  return reasons.map((item) => `${item.code}${item.resourceId ? `(${item.resourceId})` : ""}`).join("、");
}

function snapshotLabel(snapshot: SnapshotRef): string {
  return `matter=${snapshot.matterId}; target=${snapshot.targetId}; source=${snapshot.sourceVersion}; config=${snapshot.targetConfigVersion}; draft=${snapshot.draftRevisionId}; figures=${snapshot.figureRevisionId}`;
}

function allParagraphs(ast: GenerationRevisionView["ast"]): GenerationRevisionView["ast"]["claims"][number]["paragraphs"][number][] {
  return [
    ...ast.claims.flatMap((claim) => claim.paragraphs),
    ...ast.sections.flatMap((section) => section.paragraphs),
  ];
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function approvalLedgerRow(actor: Actor, ledger: ApprovalLedger): StoredApprovalLedger {
  return {
    kind: "delivery.approvals",
    tenantId: actor.tenantId,
    actorId: actor.userId,
    matterId: ledger.matterId,
    ledger: structuredClone(ledger),
  };
}

function approvalEvent(
  actor: Actor,
  snapshot: SnapshotRef,
  action: "approval.created" | "approval.revoked",
  occurredAt: string,
  eventId: string,
  approvalId: string,
  metadata: Readonly<Record<string, string | number | null>>,
): ActivityRecord {
  const allowed = ACTIVITY_METADATA_KEYS_BY_ACTION[action];
  for (const key of Object.keys(metadata)) {
    if (!allowed.includes(key as (typeof allowed)[number])) {
      throw new Error(`approval event metadata ${key} is not allowed for ${action}`);
    }
  }
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
    resourceId: approvalId,
    occurredAt,
    metadata,
  });
}

function ownedAggregate(value: unknown, actor: Actor, matterId: string): MatterAggregate | null {
  if (!isRecord(value) || !isRecord(value.matter) || !Array.isArray(value.targets) || !Array.isArray(value.assets)) return null;
  if (value.matter.id !== matterId || value.matter.tenantId !== actor.tenantId || value.matter.createdBy !== actor.userId) return null;
  return value as unknown as MatterAggregate;
}

function initialState(matterId: string): ApprovalPanelState {
  return {
    phase: "loading",
    snapshot: null,
    snapshotCurrent: false,
    inputStale: false,
    revision: null,
    figureSet: null,
    figureAssetsAvailable: false,
    ledger: EMPTY_APPROVAL_LEDGER(matterId),
    confirmations: EMPTY_CONFIRMATION_LEDGER(matterId),
    matterVersion: null,
    error: null,
  };
}

function actionFailure(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

class ApprovalReadFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export default ApprovalPanel;
