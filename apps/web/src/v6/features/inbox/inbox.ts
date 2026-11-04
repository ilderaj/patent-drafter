import { sha256Hex, STORES, type Actor, type LocalRepository, type RepositoryError } from "../../lib/repository.ts";
import { readMatterContext, type MatterReadContext } from "../matters/matters.ts";

export type InboxKind = "fact_conflict" | "ai_confirmation" | "check" | "review" | "deadline" | "job" | "service";
export type InboxGroup = "期限" | "审阅" | "事实与确认" | "检查" | "任务" | "服务";

export interface InboxItem {
  id: string;
  matterId: string;
  targetId: string | null;
  kind: InboxKind;
  group: InboxGroup;
  title: string;
  resourceId: string;
  state: "open" | "resolved";
  readAt: string | null;
  dueAt: string | null;
  createdAt: string;
  actionPath: string;
  actionKind: string;
}

export interface InboxView {
  items: readonly InboxItem[];
  loadedAt: number;
}

export type InboxResult<T> = { ok: true; data: T } | { ok: false; error: RepositoryError };

const KIND_GROUP: Readonly<Record<InboxKind, InboxGroup>> = Object.freeze({
  fact_conflict: "事实与确认",
  ai_confirmation: "事实与确认",
  check: "检查",
  review: "审阅",
  deadline: "期限",
  job: "任务",
  service: "服务",
});
const GROUP_ORDER: readonly InboxGroup[] = Object.freeze(["期限", "审阅", "事实与确认", "检查", "任务", "服务"]);

interface RawItem {
  matterId: string;
  kind: InboxKind;
  targetId: string | null;
  title: string;
  resourceId: string;
  dueAt: string | null;
  createdAt: string;
  actionKind: string;
  context: Record<string, string>;
  state: "open" | "resolved";
}

interface MatterScope {
  context: MatterReadContext;
  targetStatus: ReadonlyMap<string, "active" | "archived">;
}

export async function loadInbox(repository: LocalRepository, actor: Actor): Promise<InboxResult<InboxView>> {
  const matters = await repository.listMatters(actor);
  if (!matters.ok) return { ok: false, error: matters.error };
  const scopes: MatterScope[] = [];
  for (const item of matters.data.items) {
    if (item.matter.status === "deletion_pending") continue;
    const loaded = await readMatterContext(repository, actor, item.matter.id);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    scopes.push({
      context: loaded.data,
      targetStatus: new Map(loaded.data.aggregate.targets.map((target) => [target.id, target.status])),
    });
  }

  const raw: RawItem[] = [];
  for (const scope of scopes) raw.push(...deriveMatterInbox(scope));
  try {
    const cursor = await readCursor(repository, actor);
    const items = await Promise.all(raw.map(async (item): Promise<InboxItem> => {
      const id = await itemId(item.kind, item.matterId, item.targetId, item.resourceId);
      return {
        id,
        matterId: item.matterId,
        targetId: item.targetId,
        kind: item.kind,
        group: KIND_GROUP[item.kind],
        title: item.title,
        resourceId: item.resourceId,
        state: item.state,
        readAt: cursor[id] ?? null,
        dueAt: item.dueAt,
        createdAt: item.createdAt,
        actionPath: actionPath(item),
        actionKind: item.actionKind,
      };
    }));
    items.sort(compareItems);
    return { ok: true, data: { items, loadedAt: Date.now() } };
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "无法读取本机待办。" } };
  }
}

function deriveMatterInbox(scope: MatterScope): RawItem[] {
  const { context, targetStatus } = scope;
  const matterId = context.aggregate.matter.id;
  const out: RawItem[] = [];
  const snapshot = context.snapshot;

  if (snapshot) {
    for (const conflict of arrayOf(snapshot.conflicts)) {
      if (!isRecord(conflict) || typeof conflict.id !== "string") continue;
      if (conflict.state !== "open" && conflict.state !== "resolved" && conflict.state !== "retained") continue;
      out.push({
        matterId,
        kind: "fact_conflict",
        targetId: null,
        title: "处理事实冲突",
        resourceId: conflict.id,
        dueAt: null,
        createdAt: typeof snapshot.createdAt === "string" ? snapshot.createdAt : "",
        actionKind: context.matterNextAction,
        context: { conflictId: conflict.id },
        state: conflict.state === "resolved" ? "resolved" : "open",
      });
    }
  }

  for (const target of context.aggregate.targets) {
    if (target.status !== "active") continue;
    const actionState = context.targetActions.get(target.id);
    const targetAction = context.targetRows.find((row) => row.id === target.id)?.nextAction
      ?? context.matterNextAction;
    const revision = currentRevision(context.blobs, matterId, target.id, target.draftRevisionId);
    if (revision) out.push(...confirmationItems(context, target.id, revision, targetAction));
    if (target.draftRevisionId !== null) {
      const check = latestCheck(context.blobs, context, target.id, target.draftRevisionId);
      const hasCurrentCheck = actionState?.hasCurrentCheck ?? false;
      const unacknowledgedRisk = actionState?.hasUnacknowledgedRequiredRisk ?? false;
      const openFinding = check?.findings.some((finding) => isRecord(finding) && finding.status === "open") ?? false;
      const needsCheck = !hasCurrentCheck || openFinding || check?.state === "failed";
      const open = needsCheck || unacknowledgedRisk;
      out.push({
        matterId,
        kind: "check",
        targetId: target.id,
        title: unacknowledgedRisk ? "确认检查风险" : needsCheck ? "运行或复核检查" : "检查已完成",
        resourceId: target.id,
        dueAt: null,
        createdAt: check?.createdAt ?? "",
        actionKind: targetAction,
        context: check ? { checkRunId: check.id } : {},
        state: open ? "open" : "resolved",
      });
    }
  }

  const currentTargetIds = new Set(
    context.aggregate.targets.filter((target) => target.status === "active").map((target) => target.id),
  );
  const reviewFeedback = collectReviewFeedback(context.blobs);
  const resolvedReviews = new Set(context.events
    .filter((event) => event.action === "review.resolved" || event.action === "review.revoked")
    .map((event) => event.resourceId));

  for (const value of context.blobs) {
    if (!isRecord(value)) continue;
    const deadline = unwrapRecord(value, "deadline");
    if (deadline && typeof deadline.id === "string" && typeof deadline.targetId === "string"
      && deadline.status === "confirmed" && currentTargetIds.has(deadline.targetId)) {
      const dueAt = localDateEndOfDay(deadline.dueOn, deadline.timeZone);
      out.push({
        matterId,
        kind: "deadline",
        targetId: deadline.targetId,
        title: typeof deadline.title === "string" ? deadline.title : "已确认期限",
        resourceId: deadline.id,
        dueAt,
        createdAt: typeof deadline.confirmedAt === "string" ? deadline.confirmedAt : "",
        actionKind: "review_deadline",
        context: { deadlineId: deadline.id },
        state: "open",
      });
    }

    const review = unwrapRecord(value, "review");
    const reviewSnapshot = review && isRecord(review.snapshot) ? review.snapshot : null;
    if (review && typeof review.id === "string" && reviewSnapshot?.matterId === matterId) {
      const targetId = typeof reviewSnapshot.targetId === "string" ? reviewSnapshot.targetId : null;
      if (targetId !== null && !currentTargetIds.has(targetId)) continue;
      const feedback = reviewFeedback.get(review.id) ?? [];
      const feedbackResolved = feedback.length > 0 && feedback.every((entry) => entry.resolution !== "open");
      const resolved = ["closed", "revoked", "expired"].includes(String(review.status))
        || resolvedReviews.has(review.id)
        || feedbackResolved;
      out.push({
        matterId,
        kind: "review",
        targetId,
        title: resolved ? "审阅反馈已处理" : "查看审阅进度",
        resourceId: review.id,
        dueAt: typeof review.dueOn === "string" ? localDateStart(review.dueOn) : null,
        createdAt: typeof review.createdAt === "string" ? review.createdAt : "",
        actionKind: "open_review",
        context: { reviewId: review.id },
        state: resolved ? "resolved" : "open",
      });
    }

    const job = unwrapJob(value);
    if (job && job.matterId === matterId && job.tenantId === context.aggregate.matter.tenantId
      && typeof job.id === "string"
      && (job.targetId === null || job.targetId === undefined || (typeof job.targetId === "string" && currentTargetIds.has(job.targetId)))) {
      const parseJobSucceeded = job.kind === "parse" && job.state === "succeeded";
      const resolved = job.state === "cancelled"
        || parseJobSucceeded
        || (job.state === "succeeded" && (job.disposition === "adopted" || job.disposition === "discarded"));
      const createdAt = typeof job.createdAt === "string" ? job.createdAt : "";
      out.push({
        matterId,
        kind: "job",
        targetId: typeof job.targetId === "string" ? job.targetId : null,
        title: job.state === "failed" ? "任务失败，查看后重试" : "查看任务状态",
        resourceId: job.id,
        dueAt: null,
        createdAt,
        actionKind: "open_job",
        context: { jobId: job.id },
        state: resolved ? "resolved" : "open",
      });
    }

    const service = unwrapRecord(value, "service.order");
    if (service && service.tenantId === context.aggregate.matter.tenantId && service.matterId === matterId
      && typeof service.id === "string") {
      const resolved = service.status === "closed" || service.status === "cancelled" || service.status === "delivered";
      out.push({
        matterId,
        kind: "service",
        targetId: null,
        title: "人工服务有待处理",
        resourceId: service.id,
        dueAt: null,
        createdAt: typeof service.createdAt === "string" ? service.createdAt : "",
        actionKind: "open_service",
        context: { serviceOrderId: service.id },
        state: resolved ? "resolved" : "open",
      });
    }
  }
  return out;
}

function confirmationItems(
  context: MatterReadContext,
  targetId: string,
  revision: Record<string, unknown>,
  actionKind: string,
): RawItem[] {
  const matterId = context.aggregate.matter.id;
  const snapshot = currentSnapshot(context, targetId, revision);
  const aiParagraphs = paragraphIds(revision);
  const ledger = currentConfirmations(context.blobs, matterId, snapshot);
  const createdAt = typeof revision.createdAt === "string" ? revision.createdAt : "";
  const items: RawItem[] = aiParagraphs.map((paragraphId) => {
    const confirmed = ledger.aiParagraphIds.has(paragraphId);
    return {
      matterId,
      kind: "ai_confirmation",
      targetId,
      title: confirmed ? "内容确认已完成" : "确认生成内容",
      resourceId: paragraphId,
      dueAt: null,
      createdAt,
      actionKind,
      context: { nodeId: paragraphId, revisionId: String(revision.id) },
      state: confirmed ? "resolved" : "open",
    };
  });
  if (context.targetActions.get(targetId)?.mode === "self_service") {
    items.push({
      matterId,
      kind: "ai_confirmation",
      targetId,
      title: ledger.fullRead ? "草稿通读确认已完成" : "通读并确认草稿",
      resourceId: String(revision.id),
      dueAt: null,
      createdAt,
      actionKind,
      context: { revisionId: String(revision.id), confirmation: "full_read" },
      state: ledger.fullRead ? "resolved" : "open",
    });
  }
  return items;
}

function currentRevision(
  blobs: readonly unknown[],
  matterId: string,
  targetId: string,
  revisionId: string | null,
): Record<string, unknown> | null {
  if (revisionId === null) return null;
  for (const value of blobs) {
    if (!isRecord(value)) continue;
    const revision = value.kind === "draft.revision" && isRecord(value.revision) ? value.revision : value;
    if (revision.id === revisionId && revision.matterId === matterId && revision.targetId === targetId) return revision;
  }
  return null;
}

function currentSnapshot(context: MatterReadContext, targetId: string, revision: Record<string, unknown>): Record<string, unknown> {
  const target = context.aggregate.targets.find((candidate) => candidate.id === targetId)!;
  return {
    matterId: context.aggregate.matter.id,
    targetId,
    sourceVersion: context.aggregate.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: revision.id,
    figureRevisionId: target.figureRevisionId,
  };
}

function paragraphIds(revision: Record<string, unknown>): string[] {
  if (!isRecord(revision.ast)) return [];
  const paragraphs: unknown[] = [];
  for (const section of arrayOf(revision.ast.sections)) {
    if (isRecord(section)) paragraphs.push(...arrayOf(section.paragraphs));
  }
  for (const claim of arrayOf(revision.ast.claims)) {
    if (isRecord(claim)) paragraphs.push(...arrayOf(claim.paragraphs));
  }
  return paragraphs
    .filter((value): value is Record<string, unknown> => isRecord(value)
      && (value.origin === "ai" || value.origin === "mixed")
      && typeof value.id === "string")
    .map((value) => value.id as string);
}

function currentConfirmations(
  blobs: readonly unknown[],
  matterId: string,
  snapshot: Record<string, unknown>,
): { aiParagraphIds: Set<string>; fullRead: boolean } {
  const aiParagraphIds = new Set<string>();
  let fullRead = false;
  const revoked = new Set<string>();
  for (const value of blobs) {
    if (!isRecord(value) || value.kind !== "confirmation.ledger" || value.matterId !== matterId || !isRecord(value.ledger)) continue;
    const ledger = value.ledger;
    for (const revocation of arrayOf(ledger.revocations)) {
      if (isRecord(revocation) && typeof revocation.objectId === "string") revoked.add(revocation.objectId);
    }
    for (const confirmation of arrayOf(ledger.confirmations)) {
      if (!isRecord(confirmation) || revoked.has(String(confirmation.id)) || !sameSnapshot(confirmation.snapshot, snapshot)) continue;
      if (confirmation.kind === "full_read") fullRead = true;
      if (confirmation.kind === "ai_paragraph" && typeof confirmation.paragraphId === "string") aiParagraphIds.add(confirmation.paragraphId);
    }
  }
  return { aiParagraphIds, fullRead };
}

function latestCheck(
  blobs: readonly unknown[],
  context: MatterReadContext,
  targetId: string,
  draftRevisionId: string,
): { id: string; state: string; createdAt: string; findings: readonly unknown[] } | null {
  const runs: Record<string, unknown>[] = [];
  for (const value of blobs) {
    if (!isRecord(value) || value.kind !== "check.run") continue;
    const run = isRecord(value.checkRun) ? value.checkRun : isRecord(value.run) ? value.run : value;
    const snapshot = isRecord(run.snapshot) ? run.snapshot : null;
    if (snapshot?.matterId === context.aggregate.matter.id && snapshot.targetId === targetId
      && snapshot.sourceVersion === context.aggregate.matter.sourceVersion
      && snapshot.targetConfigVersion === context.aggregate.targets.find((target) => target.id === targetId)?.configVersion
      && snapshot.figureRevisionId === context.aggregate.targets.find((target) => target.id === targetId)?.figureRevisionId
      && snapshot.draftRevisionId === draftRevisionId && typeof run.id === "string") runs.push(run);
  }
  runs.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) || String(a.id).localeCompare(String(b.id)));
  const run = runs[0];
  return run ? {
    id: String(run.id),
    state: typeof run.state === "string" ? run.state : "failed",
    createdAt: typeof run.createdAt === "string" ? run.createdAt : "",
    findings: arrayOf(run.findings),
  } : null;
}

function collectReviewFeedback(blobs: readonly unknown[]): Map<string, Record<string, unknown>[]> {
  const feedback = new Map<string, Record<string, unknown>[]>();
  for (const value of blobs) {
    if (!isRecord(value) || value.kind !== "review.feedback") continue;
    const item = isRecord(value.feedback) ? value.feedback : value;
    if (typeof item.reviewId !== "string") continue;
    const rows = feedback.get(item.reviewId) ?? [];
    rows.push(item);
    feedback.set(item.reviewId, rows);
  }
  return feedback;
}

function unwrapRecord(value: Record<string, unknown>, kind: string): Record<string, unknown> | null {
  if (value.kind !== kind && value.kind !== `${kind}.record`) return null;
  const nestedKey = kind === "service.order" ? "order" : kind;
  return isRecord(value[nestedKey]) ? value[nestedKey] as Record<string, unknown> : value;
}

function unwrapJob(value: Record<string, unknown>): Record<string, unknown> | null {
  if (value.kind !== "parse.job" && value.kind !== "job") return null;
  return isRecord(value.job) ? value.job : null;
}

function localDateEndOfDay(value: unknown, timeZone: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const wanted = Date.UTC(year!, month! - 1, day!, 23, 59, 59, 999);
  let guess = wanted;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: typeof timeZone === "string" ? timeZone : "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
      const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), 999);
      const correction = wanted - observed;
      guess += correction;
      if (correction === 0) break;
    }
  } catch {
    guess = wanted;
  }
  return new Date(guess).toISOString();
}

function localDateStart(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return `${value}T00:00:00.000Z`;
}

function actionPath(item: RawItem): string {
  const tab = item.kind === "fact_conflict" ? "facts"
    : item.kind === "ai_confirmation" ? "draft"
      : item.kind === "check" ? "check"
        : item.kind === "review" ? "review"
          : item.kind === "deadline" ? "filing"
            : item.kind === "service" ? "deliver" : "overview";
  const base = item.targetId === null
    ? `/v6/matters/${encodeURIComponent(item.matterId)}/${tab}`
    : `/v6/matters/${encodeURIComponent(item.matterId)}/targets/${encodeURIComponent(item.targetId)}/${tab}`;
  const query = new URLSearchParams({ context: `${item.kind}:${item.resourceId}`, action: item.actionKind });
  for (const [key, value] of Object.entries(item.context)) query.set(key, value);
  if (item.targetId !== null) query.set("targetId", item.targetId);
  return `${base}?${query.toString()}`;
}

async function itemId(kind: InboxKind, matterId: string, targetId: string | null, resourceId: string): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(`v6/inbox/${matterId}/${targetId ?? "*"}/${kind}/${resourceId}`));
  const hex = digest.slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const id = hex.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function cursorKey(actor: Actor): string {
  return `inbox/cursor/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}`;
}

async function readCursor(repository: LocalRepository, actor: Actor): Promise<Record<string, string>> {
  return repository.backend.transaction("readonly", async (tx) => {
    const value = await tx.get(STORES.blobs, cursorKey(actor));
    if (!isRecord(value) || value.kind !== "inbox.cursor" || value.tenantId !== actor.tenantId || value.userId !== actor.userId || !isRecord(value.read)) return {};
    const out: Record<string, string> = {};
    for (const [id, readAt] of Object.entries(value.read)) if (typeof readAt === "string") out[id] = readAt;
    return out;
  });
}

export async function loadInboxItem(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  itemId: string,
): Promise<InboxResult<InboxItem>> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const view = await loadInbox(repository, actor);
  if (!view.ok) return view;
  const item = view.data.items.find((candidate) => candidate.id === itemId && candidate.matterId === matterId);
  return item
    ? { ok: true, data: item }
    : { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "待办不可用。" } };
}

export async function markInboxItemRead(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  inboxItemId: string,
  now: string,
): Promise<InboxResult<InboxItem>> {
  const item = await loadInboxItem(repository, actor, matterId, inboxItemId);
  if (!item.ok) return item;
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const key = cursorKey(actor);
      const value = await tx.get(STORES.blobs, key);
      const cursor: Record<string, string> = isRecord(value) && isRecord(value.read)
        ? Object.fromEntries(Object.entries(value.read).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : {};
      if (cursor[inboxItemId] === undefined) {
        await tx.put(STORES.blobs, key, {
          kind: "inbox.cursor",
          tenantId: actor.tenantId,
          userId: actor.userId,
          version: 1,
          read: { ...cursor, [inboxItemId]: now },
        });
      }
    });
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "无法保存已读标记。" } };
  }
  return loadInboxItem(repository, actor, matterId, inboxItemId);
}

function sameSnapshot(a: unknown, b: Record<string, unknown>): boolean {
  if (!isRecord(a)) return false;
  return a.matterId === b.matterId && a.targetId === b.targetId
    && a.sourceVersion === b.sourceVersion && a.targetConfigVersion === b.targetConfigVersion
    && a.draftRevisionId === b.draftRevisionId && a.figureRevisionId === b.figureRevisionId;
}

function compareItems(a: InboxItem, b: InboxItem): number {
  const group = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
  if (group !== 0) return group;
  if (a.dueAt !== b.dueAt) {
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt.localeCompare(b.dueAt);
  }
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

