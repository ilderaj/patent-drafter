import type { Actor, ActivityRecord, LocalRepository, RepositoryError, TargetRecord } from "../../lib/repository.ts";
import { readMatterContext, type MatterReadContext } from "../matters/matters.ts";
import type { NextActionKind } from "../matters/actions.ts";
import { confirmationSchema, revocationSchema } from "../../../../../../packages/contracts/src/index.ts";
import { currentConfirmations, type ConfirmationLedger } from "../../../../../../packages/domain/src/v6/confirmation.ts";
import { isCurrent, type SnapshotRef } from "../../../../../../packages/domain/src/v6/revision.ts";

export type WorkbenchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RepositoryError };

export type CheckState = "none" | "current" | "stale" | "failed";
export type ApprovalState = "none" | "valid" | "invalid";
export type TargetLanguage = "zh-CN" | "en-US";

export interface ApprovalValidity {
  state: ApprovalState;
  reason: string | null;
  approvalId: string | null;
}

export interface WorkbenchTargetSummary {
  id: string;
  status: TargetRecord["status"];
  route: string | null;
  language: TargetLanguage | null;
  configVersion: number;
  revisionId: string | null;
  inputStale: boolean;
  check: { state: CheckState; runId: string | null; rulePackVersion: string | null };
  confirmations: { confirmed: number; required: number };
  approval: ApprovalValidity;
  nextAction: NextActionKind;
}

export interface WorkbenchOverview {
  matterId: string;
  title: string;
  matterStatus: "active" | "archived" | "deletion_pending";
  matterVersion: number;
  sourceVersion: number;
  targets: readonly WorkbenchTargetSummary[];
  loadedAt: number;
}

export interface ActivityFeedData {
  matters: readonly { id: string; title: string }[];
  events: readonly ActivityRecord[];
  loadedAt: number;
}

export interface ActivityFilters {
  matterId: string | null;
  targetId: string | null | "all";
  actorKind: ActivityRecord["actorKind"] | "all";
  actionClass: string | "all";
  modelOnly: boolean;
}

interface RecordValue {
  [key: string]: unknown;
}

interface CheckRunValue extends RecordValue {
  id: string;
  snapshot: RecordValue;
  rulePackVersion: string;
  state: string;
  createdAt: string;
}

interface ApprovalValue extends RecordValue {
  id: string;
  snapshot: RecordValue;
  checkRunId: string;
  confirmationIds: readonly string[];
  createdAt: string;
}

/**
 * Read and aggregate the persisted matter state for the professional workbench.
 * This function performs no writes; callers should invoke it again after a
 * feature action, when the window regains focus, and when the view is stale.
 */
export async function loadWorkbenchOverview(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string | null = null,
  options: { activeRulePackVersion?: string | null; now?: number } = {},
): Promise<WorkbenchResult<WorkbenchOverview>> {
  const context = await readMatterContext(repository, actor, matterId);
  if (!context.ok) return context;
  if (targetId !== null && !context.data.aggregate.targets.some((target) => target.id === targetId)) {
    return { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "target not found" } };
  }
  return {
    ok: true,
    data: deriveWorkbenchOverview(context.data, {
      activeRulePackVersion: options.activeRulePackVersion ?? activeRulePack(context.data.blobs),
      loadedAt: options.now ?? Date.now(),
    }),
  };
}

/** Derive every target summary from one repository read context. */
export function deriveWorkbenchOverview(
  context: MatterReadContext,
  options: { activeRulePackVersion?: string | null; loadedAt?: number } = {},
): WorkbenchOverview {
  const { aggregate, blobs, events, targetRows } = context;
  const activePack = options.activeRulePackVersion ?? activeRulePack(blobs);
  const targets = aggregate.targets.map((target, index): WorkbenchTargetSummary => {
    const current = currentSnapshot(aggregate.matter.id, aggregate.matter.sourceVersion, target);
    const revision = findRevision(blobs, aggregate.matter.id, target.id, target.draftRevisionId);
    const inputStale = revision !== null && isInputStale(revision.input, aggregate.matter.id, target.id, aggregate.matter.sourceVersion, target);
    const aiParagraphIds = revision === null ? [] : generatedParagraphIds(revision.ast);
    const ledger = readConfirmationLedger(blobs, aggregate.matter.id, aggregate.matter.tenantId, aggregate.matter.createdBy);
    const liveConfirmations = current === null ? [] : currentConfirmations(ledger, current);
    const confirmed = new Set(liveConfirmations
      .filter((confirmation) => confirmation.kind === "ai_paragraph" && typeof confirmation.paragraphId === "string")
      .map((confirmation) => confirmation.paragraphId as string));
    const check = latestCheck(blobs, aggregate.matter.id, target.id);
    const checkState = check === null
      ? "none"
      : check.state === "failed"
        ? "failed"
        : check.state === "succeeded" && current !== null
          && sameSnapshot(check.snapshot, current)
          && activePack !== null
          && check.rulePackVersion === activePack
          ? "current"
          : "stale";
    const approval = approvalValidity({
      blobs,
      events,
      matterId: aggregate.matter.id,
      tenantId: aggregate.matter.tenantId,
      targetId: target.id,
      current,
      activeRulePackVersion: activePack,
      ledger,
    });
    const targetRow = targetRows.find((row) => row.id === target.id);
    return {
      id: target.id,
      status: target.status,
      route: targetRow?.route ?? null,
      language: targetConfigLanguage(blobs, aggregate.matter.tenantId, aggregate.matter.id, target),
      configVersion: target.configVersion,
      revisionId: target.draftRevisionId,
      inputStale,
      check: { state: checkState, runId: check?.id ?? null, rulePackVersion: check?.rulePackVersion ?? null },
      confirmations: {
        confirmed: aiParagraphIds.filter((id) => confirmed.has(id)).length,
        required: aiParagraphIds.length,
      },
      approval,
      nextAction: targetRow?.nextAction ?? "none",
    };
  });

  return {
    matterId: aggregate.matter.id,
    title: aggregate.matter.title,
    matterStatus: aggregate.matter.status,
    matterVersion: aggregate.matter.version,
    sourceVersion: aggregate.matter.sourceVersion,
    targets,
    loadedAt: options.loadedAt ?? Date.now(),
  };
}

/** Load append-only activity for the actor's accessible matters. */
export async function loadActivityFeed(
  repository: LocalRepository,
  actor: Actor,
  options: { now?: number } = {},
): Promise<WorkbenchResult<ActivityFeedData>> {
  const listed = await repository.listMatters(actor);
  if (!listed.ok) return listed;
  const matters = listed.data.items
    .filter((item) => item.matter.status !== "deletion_pending")
    .map((item) => ({ id: item.matter.id, title: item.matter.title }));
  const events: ActivityRecord[] = [];
  for (const matter of matters) {
    const result = await repository.listEvents(actor, matter.id);
    if (!result.ok) return result;
    events.push(...result.data.items);
  }
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  return { ok: true, data: { matters, events, loadedAt: options.now ?? Date.now() } };
}

/** Apply the S06 matter, target, actor, action-class and model-only filters. */
export function filterActivity(
  events: readonly ActivityRecord[],
  filters: ActivityFilters,
): readonly ActivityRecord[] {
  return events.filter((event) =>
    (filters.matterId === null || event.matterId === filters.matterId)
    && (filters.targetId === "all" || event.targetId === filters.targetId)
    && (filters.actorKind === "all" || event.actorKind === filters.actorKind)
    && (filters.actionClass === "all" || event.action.split(".")[0] === filters.actionClass)
    && (!filters.modelOnly || hasModelParticipation(event)),
  );
}

/** Model participation is derived only from the contract's job/provider/model fields. */
export function hasModelParticipation(event: ActivityRecord): boolean {
  return typeof event.metadata.provider === "string" || typeof event.metadata.model === "string";
}

export function activityOutcome(event: ActivityRecord): "failed" | "succeeded" | "recorded" {
  if (event.action.endsWith(".failed")) return "failed";
  if (event.action.endsWith(".succeeded") || event.action.endsWith(".created") || event.action.endsWith(".completed")) {
    return "succeeded";
  }
  return "recorded";
}

export function activityActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function actorLabel(event: ActivityRecord): string {
  switch (event.actorKind) {
    case "user": return "本机用户（自报）";
    case "worker": return "worker";
    case "webhook": return "webhook";
  }
}

export function currentSnapshot(
  matterId: string,
  sourceVersion: number,
  target: TargetRecord,
): SnapshotRef | null {
  if (target.draftRevisionId === null) return null;
  return {
    matterId,
    targetId: target.id,
    sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: target.draftRevisionId,
    figureRevisionId: target.figureRevisionId,
  };
}

function approvalValidity(input: {
  blobs: readonly unknown[];
  events: readonly ActivityRecord[];
  matterId: string;
  tenantId: string;
  targetId: string;
  current: SnapshotRef | null;
  activeRulePackVersion: string | null;
  ledger: ConfirmationLedger;
}): ApprovalValidity {
  const approvals = input.blobs
    .map(unwrapApproval)
    .filter((approval): approval is ApprovalValue & { row: RecordValue } => approval !== null
      && snapshotBelongs(approval.snapshot, input.matterId, input.targetId)
      && rowBelongs(approval.row, input.tenantId, input.matterId));
  approvals.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const approval = approvals[0];
  if (!approval) return { state: "none", reason: null, approvalId: null };
  if (input.events.some((event) => event.action === "approval.revoked" && event.resourceId === approval.id)) {
    return invalidApproval(approval.id, "批准已撤销");
  }
  if (input.current === null) return invalidApproval(approval.id, "修订变化");
  const current = input.current;
  if (approval.snapshot.draftRevisionId !== current.draftRevisionId) {
    return invalidApproval(approval.id, "修订变化");
  }
  if (approval.snapshot.figureRevisionId !== current.figureRevisionId) {
    return invalidApproval(approval.id, "图集变化");
  }
  if (approval.snapshot.sourceVersion !== current.sourceVersion
    || approval.snapshot.targetConfigVersion !== current.targetConfigVersion) {
    return invalidApproval(approval.id, "输入陈旧");
  }

  const latest = latestCheck(input.blobs, input.matterId, input.targetId);
  const check = findCheckById(input.blobs, input.matterId, input.targetId, approval.checkRunId);
  if (!check || !latest || latest.id !== approval.checkRunId
    || check.state !== "succeeded" || !sameSnapshot(check.snapshot, current)) {
    return invalidApproval(approval.id, "检查过期");
  }
  if (input.activeRulePackVersion === null || check.rulePackVersion !== input.activeRulePackVersion) {
    return invalidApproval(approval.id, "规则包变化");
  }

  const liveConfirmationIds = new Set(input.current === null ? [] : currentConfirmations(input.ledger, input.current).map((item) => item.id));
  if (approval.confirmationIds.some((id) => !liveConfirmationIds.has(id))) {
    return invalidApproval(approval.id, "确认撤销");
  }
  return { state: "valid", reason: null, approvalId: approval.id };
}

function invalidApproval(approvalId: string, reason: string): ApprovalValidity {
  return { state: "invalid", reason, approvalId };
}

function latestCheck(blobs: readonly unknown[], matterId: string, targetId: string): CheckRunValue | null {
  const checks = blobs
    .map(unwrapCheck)
    .filter((check): check is CheckRunValue & { row: RecordValue } => check !== null && snapshotBelongs(check.snapshot, matterId, targetId)
      && rowBelongs(check.row, undefined, matterId));
  checks.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return checks[0] ?? null;
}

function findCheckById(
  blobs: readonly unknown[],
  matterId: string,
  targetId: string,
  id: string,
): CheckRunValue | null {
  return blobs.map(unwrapCheck).find((check) => check !== null && check.id === id
    && snapshotBelongs(check.snapshot, matterId, targetId)
    && rowBelongs(check.row, undefined, matterId)) ?? null;
}

function unwrapCheck(value: unknown): (CheckRunValue & { row: RecordValue }) | null {
  if (!isRecord(value) || (value.kind !== "check.run" && value.kind !== "check.record")) return null;
  const nested = isRecord(value.checkRun) ? value.checkRun : isRecord(value.run) ? value.run : value;
  if (typeof nested.id !== "string" || !isRecord(nested.snapshot) || typeof nested.state !== "string"
    || typeof nested.rulePackVersion !== "string") return null;
  return {
    ...nested,
    id: nested.id,
    snapshot: nested.snapshot,
    rulePackVersion: nested.rulePackVersion,
    state: nested.state,
    createdAt: typeof nested.createdAt === "string" ? nested.createdAt : "",
    row: value,
  };
}

function unwrapApproval(value: unknown): (ApprovalValue & { row: RecordValue }) | null {
  if (!isRecord(value) || (value.kind !== "approval" && value.kind !== "approval.record")) return null;
  const nested = isRecord(value.approval) ? value.approval : value;
  if (typeof nested.id !== "string" || !isRecord(nested.snapshot) || typeof nested.checkRunId !== "string"
    || !Array.isArray(nested.confirmationIds)) return null;
  return {
    ...nested,
    id: nested.id,
    snapshot: nested.snapshot,
    checkRunId: nested.checkRunId,
    confirmationIds: nested.confirmationIds.filter((id): id is string => typeof id === "string"),
    createdAt: typeof nested.createdAt === "string" ? nested.createdAt : "",
    row: value,
  };
}

function readConfirmationLedger(
  blobs: readonly unknown[],
  matterId: string,
  tenantId: string,
  actorId: string,
): ConfirmationLedger {
  const confirmations: ConfirmationLedger["confirmations"][number][] = [];
  const revocations: ConfirmationLedger["revocations"][number][] = [];
  for (const value of blobs) {
    if (!isRecord(value) || value.kind !== "draft-review.confirmations" || value.matterId !== matterId
      || value.tenantId !== tenantId || value.actorId !== actorId || !isRecord(value.ledger)) continue;
    for (const raw of arrayOf(value.ledger.revocations)) {
      const parsed = revocationSchema.safeParse(raw);
      if (parsed.success && parsed.data.objectType === "confirmation") {
        revocations.push(parsed.data as ConfirmationLedger["revocations"][number]);
      }
    }
    for (const raw of arrayOf(value.ledger.confirmations)) {
      const parsed = confirmationSchema.safeParse(raw);
      if (parsed.success && parsed.data.snapshot.matterId === matterId) confirmations.push(parsed.data);
    }
  }
  return { matterId, confirmations, revocations };
}

function findRevision(
  blobs: readonly unknown[],
  matterId: string,
  targetId: string,
  revisionId: string | null,
): RecordValue | null {
  if (revisionId === null) return null;
  for (const value of blobs) {
    if (!isRecord(value)) continue;
    const revision = (value.kind === "draft.revision" || value.kind === "generation.revision") && isRecord(value.revision)
      ? value.revision
      : value;
    if (revision.id === revisionId && revision.matterId === matterId && revision.targetId === targetId) return revision;
  }
  return null;
}

function generatedParagraphIds(ast: unknown): string[] {
  if (!isRecord(ast)) return [];
  const paragraphs: unknown[] = [];
  for (const section of arrayOf(ast.sections)) if (isRecord(section)) paragraphs.push(...arrayOf(section.paragraphs));
  for (const claim of arrayOf(ast.claims)) if (isRecord(claim)) paragraphs.push(...arrayOf(claim.paragraphs));
  return paragraphs
    .filter((paragraph): paragraph is RecordValue => isRecord(paragraph)
      && (paragraph.origin === "ai" || paragraph.origin === "mixed") && typeof paragraph.id === "string")
    .map((paragraph) => paragraph.id as string);
}

function isInputStale(
  input: unknown,
  matterId: string,
  targetId: string,
  sourceVersion: number,
  target: TargetRecord,
): boolean {
  if (!isRecord(input)) return true;
  return input.matterId !== matterId || input.targetId !== targetId
    || input.sourceVersion !== sourceVersion || input.targetConfigVersion !== target.configVersion
    || input.figureRevisionId !== target.figureRevisionId;
}

function activeRulePack(blobs: readonly unknown[]): string | null {
  for (const value of blobs) {
    if (!isRecord(value)) continue;
    if (value.kind === "check.registry" && typeof value.activeRulePackVersion === "string") return value.activeRulePackVersion;
    if (value.kind === "check.active-rule-pack" && typeof value.rulePackVersion === "string") return value.rulePackVersion;
  }
  return null;
}

/** Project the target config language at the target's current config version, scoped to this matter. */
function targetConfigLanguage(
  blobs: readonly unknown[],
  tenantId: string,
  matterId: string,
  target: TargetRecord,
): TargetLanguage | null {
  for (const value of blobs) {
    if (!isRecord(value) || value.kind !== "target.config" || value.tenantId !== tenantId
      || value.matterId !== matterId || value.targetId !== target.id || !isRecord(value.config)
      || value.config.version !== target.configVersion) continue;
    if (value.config.language === "zh-CN" || value.config.language === "en-US") return value.config.language;
  }
  return null;
}

function sameSnapshot(a: unknown, b: SnapshotRef): boolean {
  return isRecord(a) && isCurrent(a as unknown as SnapshotRef, b);
}

function snapshotBelongs(snapshot: RecordValue, matterId: string, targetId: string): boolean {
  return snapshot.matterId === matterId && snapshot.targetId === targetId;
}

function rowBelongs(row: RecordValue, tenantId: string | undefined, matterId: string): boolean {
  return (tenantId === undefined || row.tenantId === undefined || row.tenantId === tenantId)
    && (row.matterId === undefined || row.matterId === matterId);
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

const ACTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "matter.created": "创建案件",
  "matter.renamed": "重命名案件",
  "matter.archived": "归档案件",
  "source.committed": "保存材料",
  "source.retired": "移除材料",
  "snapshot.created": "保存事实快照",
  "target.created": "创建目标",
  "target.config_updated": "更新目标配置",
  "target.archived": "归档目标",
  "figures.bound": "更新图集",
  "revision.created": "创建修订",
  "revision.restored": "恢复修订",
  "job.started": "任务开始",
  "job.succeeded": "任务完成",
  "job.failed": "任务失败",
  "job.cancelled": "任务已取消",
  "job.adopted": "采纳任务结果",
  "consent.granted": "授予外发授权",
  "consent.revoked": "撤回外发授权",
  "check.completed": "完成检查",
  "confirmation.created": "记录内容确认",
  "confirmation.revoked": "撤销内容确认",
  "approval.created": "记录内部批准",
  "approval.revoked": "撤销内部批准",
  "export.created": "创建导出",
  "export.downloaded": "下载导出",
  "review.sent": "发送审阅",
  "review.responded": "收到审阅反馈",
  "review.resolved": "处理审阅反馈",
  "review.revoked": "撤销审阅",
  "receipt.recorded": "记录回执材料",
  "receipt.confirmed": "人工确认回执信息",
  "deadline.confirmed": "确认期限记录",
  "deadline.completed": "完成期限记录",
  "payment.paid": "记录付款状态",
  "payment.refunded": "记录退款状态",
  "entitlement.granted": "记录使用权",
  "entitlement.revoked": "撤销使用权",
  "service.requested": "提交服务需求",
  "service.quoted": "记录服务报价",
  "service.authorized": "授权服务范围",
  "service.delivered": "记录服务交付",
  "service.closed": "关闭服务订单",
  "privacy.export": "记录隐私导出请求",
  "privacy.delete": "记录隐私删除请求",
  "member.added": "添加成员",
  "member.removed": "移除成员",
});
