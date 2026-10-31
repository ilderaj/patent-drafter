/**
 * V6-08 — the `/v6` route skeleton (S01 页面与数据, 操作与状态).
 *
 * Everything a page needs to decide what to show lives here, behind three
 * calls, so the React views stay thin and the behaviour is testable without a
 * browser:
 *
 * - `parseV6Path` turns a pathname under the `/patent` basename into a
 *   `V6Route`; `v6Path` is its inverse. The URL is the only place a selected
 *   matter, target and tab are kept, so a refreshed or shared link restores
 *   the same view (S01 切换目标/标签: only the URL and view change).
 * - `resolveMatterView` reads the matter (and the target the URL names) from
 *   the local repository. A matter or target that is missing, belongs to
 *   someone else, or is named by a malformed id is `unavailable` — one answer,
 *   so a probe cannot tell them apart, and nothing is filled in with demo data.
 *   A storage fault is `storage_unavailable`, never a fake empty matter.
 * - `createSelfServiceMatter` is S01 进入自助: one `CreateMatter` commit, then
 *   the upload step. The caller supplies the ids; retrying with the same ids
 *   after a fault or a lost answer finds the matter already written and
 *   answers with it instead of creating a second one.
 */

import {
  CONTRACT_VERSION,
  type Actor,
  type ActivityRecord,
  type LocalRepository,
  type MatterRecord,
  type RepositoryErrorCode,
  type TargetRecord,
} from "../lib/repository.ts";

/** S01 runtime label; always visible in the shell. */
export type Runtime = "local_web" | "cloud_web" | "desktop" | "demo";

export const RUNTIME_LABELS: Readonly<Record<Runtime, string>> = Object.freeze({
  local_web: "本地网页版",
  cloud_web: "云端网页版",
  desktop: "桌面版",
  demo: "示例体验",
});

/**
 * The R1 local web build has no sign-in: the browser profile is the only user.
 * The repository binds every write to this actor, so matters created here are
 * readable only through it. Both ids are fixed UUIDs because the contract
 * types `Matter.tenantId` and `Matter.createdBy` as `Id`.
 */
export const LOCAL_ACTOR: Actor = Object.freeze({
  tenantId: "5f0c6a2e-8d4b-4c71-9a3e-2b6d7f1c0e01",
  userId: "9b2e4d6f-1a3c-4e58-8b7d-0c2f4a6e8d02",
});

/** The eight in-matter tabs (prototype `pro.js` TABS); always shown, in this order. */
export const MATTER_TABS = Object.freeze([
  { key: "overview", label: "概览" },
  { key: "sources", label: "材料" },
  { key: "facts", label: "事实" },
  { key: "draft", label: "草稿" },
  { key: "check", label: "检查" },
  { key: "review", label: "审阅" },
  { key: "deliver", label: "交付" },
  { key: "filing", label: "申请" },
] as const);

export type MatterTab = (typeof MATTER_TABS)[number]["key"];

/** Why a feature is not usable yet; shown instead of a simulated result. */
export interface Capability {
  state: "available" | "unavailable";
  reason: string | null;
}

const unavailable = (reason: string): Capability => ({ state: "unavailable", reason });
const AVAILABLE: Capability = { state: "available", reason: null };

/** Each tab's capability in this build. Overview reads the matter; the rest arrive with later tickets. */
export const TAB_CAPABILITIES: Readonly<Record<MatterTab, Capability>> = Object.freeze({
  overview: AVAILABLE,
  sources: unavailable("材料管理尚未开放，将在上传与解析功能交付后提供。"),
  facts: unavailable("事实与冲突确认尚未开放，将随五个问题一起提供。"),
  draft: unavailable("草稿尚未开放：本地版还不能生成或编辑申请文本。"),
  check: unavailable("检查尚未开放：本地版还没有检查规则运行结果。"),
  review: unavailable("审阅需要专业协作功能，本地版暂不提供。"),
  deliver: unavailable("交付尚未开放：还没有可导出的草稿。"),
  filing: unavailable("申请记录需要专业协作功能，本地版暂不提供。"),
});

/** S01 global navigation, in order. */
export const GLOBAL_NAV = Object.freeze([
  { key: "inbox", label: "收件箱", capability: unavailable("待办队列尚未开放。") },
  { key: "matters", label: "案件", capability: AVAILABLE },
  { key: "filings", label: "申请", capability: unavailable("跨案件申请状态需要专业协作功能，本地版暂不提供。") },
  { key: "activity", label: "动态", capability: unavailable("跨案件动态尚未开放；单个案件的记录保存在本机。") },
  { key: "ai", label: "AI 与数据", capability: unavailable("AI 设置尚未开放：本地版目前不调用任何模型。") },
  { key: "services", label: "服务", capability: unavailable("人工服务（咨询、复核、代理对接）尚未开放，暂不能下单。") },
  { key: "billing", label: "账单", capability: unavailable("本地版不收费，没有订单或额度。") },
  { key: "settings", label: "设置", capability: AVAILABLE },
] as const);

export type GlobalKey = (typeof GLOBAL_NAV)[number]["key"];

export type V6Route =
  | { kind: "start" }
  | { kind: "matters" }
  | { kind: "upload"; matterId: string }
  | { kind: "matter"; matterId: string; targetId: string | null; tab: MatterTab }
  | { kind: "section"; key: Exclude<GlobalKey, "matters"> }
  | { kind: "not_found" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TAB_KEYS: ReadonlySet<string> = new Set(MATTER_TABS.map((tab) => tab.key));
const SECTION_KEYS: ReadonlySet<string> = new Set(GLOBAL_NAV.map((item) => item.key).filter((key) => key !== "matters"));

/** True for the lowercase UUID shape every matter and target id has (05-contracts `Id`). */
export function isEntityId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Read a pathname relative to the router basename (`/v6/...`). A trailing
 * slash is ignored. A matter link without a tab opens the overview. Anything
 * else under `/v6` is `not_found`; ids are checked by `resolveMatterView`, so
 * a malformed id still reaches the same unavailable page as a missing one.
 */
export function parseV6Path(pathname: string): V6Route {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts[0] !== "v6") return { kind: "not_found" };
  const rest = parts.slice(1).map(safeDecode);
  if (rest.some((part) => part === null)) return { kind: "not_found" };
  const [a, b, c, d, e, ...extra] = rest as string[];

  if (a === undefined) return { kind: "start" };
  if (a !== "matters") {
    return b === undefined && SECTION_KEYS.has(a) ? { kind: "section", key: a as Exclude<GlobalKey, "matters"> } : { kind: "not_found" };
  }
  if (b === undefined) return { kind: "matters" };
  if (c === undefined) return { kind: "matter", matterId: b, targetId: null, tab: "overview" };
  if (c === "upload" && d === undefined) return { kind: "upload", matterId: b };
  if (TAB_KEYS.has(c) && d === undefined) return { kind: "matter", matterId: b, targetId: null, tab: c as MatterTab };
  if (c === "targets" && d !== undefined && extra.length === 0) {
    if (e === undefined) return { kind: "matter", matterId: b, targetId: d, tab: "overview" };
    if (TAB_KEYS.has(e)) return { kind: "matter", matterId: b, targetId: d, tab: e as MatterTab };
  }
  return { kind: "not_found" };
}

/** The canonical pathname for a route; `parseV6Path(v6Path(r))` deep-equals `r` for every route but `not_found`. */
export function v6Path(route: V6Route): string {
  switch (route.kind) {
    case "start":
      return "/v6";
    case "matters":
      return "/v6/matters";
    case "upload":
      return `/v6/matters/${encodeURIComponent(route.matterId)}/upload`;
    case "matter": {
      const base = `/v6/matters/${encodeURIComponent(route.matterId)}`;
      return route.targetId === null
        ? `${base}/${route.tab}`
        : `${base}/targets/${encodeURIComponent(route.targetId)}/${route.tab}`;
    }
    case "section":
      return `/v6/${route.key}`;
    case "not_found":
      return "/v6/not-found";
  }
}

export type MatterView =
  | { state: "ready"; matter: MatterRecord; targets: readonly TargetRecord[]; target: TargetRecord | null; version: number }
  | { state: "unavailable" }
  | { state: "storage_unavailable"; message: string };

/**
 * Load what a matter page shows. `targetId` null means the matter as a whole.
 * Reads only; it never writes or repairs anything.
 */
export async function resolveMatterView(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string | null,
): Promise<MatterView> {
  if (!isEntityId(matterId) || (targetId !== null && !isEntityId(targetId))) return { state: "unavailable" };
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) {
    return loaded.error.code === "STORAGE_UNAVAILABLE"
      ? { state: "storage_unavailable", message: PAGE_ERROR_MESSAGES.STORAGE_UNAVAILABLE }
      : { state: "unavailable" };
  }
  const { matter, targets } = loaded.data.data;
  if (matter.status === "deletion_pending") return { state: "unavailable" };
  const target = targetId === null ? null : (targets.find((candidate) => candidate.id === targetId) ?? null);
  if (targetId !== null && target === null) return { state: "unavailable" };
  return { state: "ready", matter, targets, target, version: loaded.data.version };
}

export type MatterListView =
  | { state: "ready"; matters: readonly MatterRecord[] }
  | { state: "storage_unavailable"; message: string };

/** The actor's own matters, newest first; an empty list on a fresh profile. */
export async function listMatterView(repository: LocalRepository, actor: Actor): Promise<MatterListView> {
  const listed = await repository.listMatters(actor);
  if (!listed.ok) {
    return { state: "storage_unavailable", message: PAGE_ERROR_MESSAGES.STORAGE_UNAVAILABLE };
  }
  return { state: "ready", matters: listed.data.items.map((item) => item.matter) };
}

export interface CreateMatterInput {
  /** New UUIDs for the matter and its `matter.created` event; reuse them to retry. */
  matterId: string;
  eventId: string;
  requestId: string;
  /** RFC3339 UTC, injected so the call is deterministic. */
  now: string;
  title?: string;
}

export type CreateMatterResult =
  | { ok: true; matterId: string; next: string; created: boolean }
  | { ok: false; code: RepositoryErrorCode; message: string };

export const DEFAULT_MATTER_TITLE = "未命名案件";

/**
 * The text a page shows for each repository refusal. The repository's own
 * message can carry the raw storage exception, so it never reaches the page.
 */
export const PAGE_ERROR_MESSAGES: Readonly<Record<RepositoryErrorCode, string>> = Object.freeze({
  INVALID_INPUT: "本地存储拒绝了这次写入，案件尚未保存。",
  RESOURCE_NOT_FOUND: "案件不可用。",
  VERSION_CONFLICT: "该案件编号已被占用，请重新创建。",
  INVALID_TRANSITION: "案件当前状态不允许这次写入。",
  QUOTA_EXCEEDED: "本地存储空间已满，尚未保存。请释放空间后重试。",
  STORAGE_UNAVAILABLE: "本地存储暂时不可用，尚未保存。请稍后重试。",
  HASH_MISMATCH: "保存的字节与记录不一致，尚未保存。",
});

/**
 * S01 进入自助: write one empty matter (no sources, targets, drafts or demo
 * content) and its `matter.created` event, then point at the upload step. A
 * failure creates nothing and says why. When the matter id already exists for
 * this actor — a retry after a lost answer — the existing matter is returned
 * with `created: false` and nothing new is written.
 */
export async function createSelfServiceMatter(
  repository: LocalRepository,
  actor: Actor,
  input: CreateMatterInput,
): Promise<CreateMatterResult> {
  if (!isEntityId(input.matterId) || !isEntityId(input.eventId)) {
    return { ok: false, code: "INVALID_INPUT", message: "matter and event ids must be lowercase UUIDs" };
  }
  const title = (input.title ?? "").trim() || DEFAULT_MATTER_TITLE;
  const matter: MatterRecord = {
    id: input.matterId,
    tenantId: actor.tenantId,
    version: 1,
    title,
    status: "active",
    // The first shared-input snapshot; an empty matter has no sources yet.
    sourceVersion: 1,
    createdBy: actor.userId,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const event: ActivityRecord = {
    id: input.eventId,
    tenantId: actor.tenantId,
    matterId: input.matterId,
    targetId: null,
    actorId: actor.userId,
    actorKind: "user",
    action: "matter.created",
    snapshot: null,
    jobId: null,
    resourceId: input.matterId,
    occurredAt: input.now,
    metadata: { version: 1 },
  };
  const next = v6Path({ kind: "upload", matterId: input.matterId });
  const committed = await repository.commit(
    actor,
    { contractVersion: CONTRACT_VERSION, expectedVersion: 0, payload: { matter, targets: [], assets: [], events: [event], blobs: [] } },
    { requestId: input.requestId },
  );
  if (committed.ok) return { ok: true, matterId: input.matterId, next, created: true };
  if (committed.error.code === "VERSION_CONFLICT") {
    // The id is taken. If it is this actor's matter, an earlier attempt wrote it.
    const existing = await repository.loadMatter(actor, input.matterId);
    if (existing.ok) return { ok: true, matterId: input.matterId, next, created: false };
  }
  return { ok: false, code: committed.error.code, message: PAGE_ERROR_MESSAGES[committed.error.code] ?? PAGE_ERROR_MESSAGES.INVALID_INPUT };
}

function safeDecode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}
