/**
 * V6-20 — read-only preview projection and local full-read confirmation.
 *
 * `buildPreviewProjection` is the boundary between a stored DraftAST and the
 * self-service DTO. A preview-only result contains only claims, the two free
 * sections, locked-section IDs and risks. Full content is returned in a separate
 * contract-shaped FullDraftDTO only when `access` is `full` or `local_unmetered`.
 *
 * `loadLocalPreview` reuses V6-18's revision reader and LocalRepository. The
 * confirmation helper stores the accepted V6-05 append-only ledger in the
 * existing local blobs store, scoped to the verified actor and matter.
 */
import {
  activitySchema,
  confirmationSchema,
  draftRevisionSchema,
  fullDraftSchema,
  previewSchema,
  riskSchema,
  revocationSchema,
  snapshotRefSchema,
  type Confirmation as ContractConfirmation,
  type DraftAST,
  type DraftInputRef,
  type DraftRevision,
  type FullDraftDTO,
  type Paragraph,
  type PreviewDTO,
  type RiskDTO,
  type SectionKind,
  type SnapshotRef,
} from "../../../../../../packages/contracts/src/index.ts";
import {
  confirm,
  currentConfirmations,
  type ConfirmationLedger,
  type ContentAccess,
} from "../../../../../../packages/domain/src/v6/confirmation.ts";
import { isCurrent } from "../../../../../../packages/domain/src/v6/revision.ts";
import {
  createGenerationRevisionStore,
  type GenerationRevisionView,
} from "../generation/generation.ts";
import {
  STORES,
  type Actor,
  type ActivityRecord,
  type LocalRepository,
  type StorageTransaction,
} from "../../lib/repository.ts";

export const LOCKED_SECTION_KINDS: readonly SectionKind[] = Object.freeze([
  "summary",
  "figures_description",
  "embodiments",
  "abstract",
]);

export const PREVIEW_SECTION_LABELS: Readonly<Record<SectionKind | "claims", string>> = Object.freeze({
  claims: "权利要求书",
  technical_field: "技术领域",
  background: "背景技术",
  summary: "发明内容",
  figures_description: "附图说明",
  embodiments: "具体实施方式",
  abstract: "摘要",
});

const RISK_PRESENTATION: Readonly<Record<RiskDTO["category"], { shape: string; label: string }>> = Object.freeze({
  blocker: { shape: "■", label: "阻断" },
  risk: { shape: "▲", label: "风险" },
  unverified: { shape: "○", label: "待核实" },
  policy: { shape: "▰", label: "产品政策" },
});

export interface PreviewProjectionInput {
  revision: DraftRevision;
  access: ContentAccess;
  risks?: readonly RiskDTO[];
  inputStale: boolean;
}

/** PreviewDTO plus a separately validated full draft for currently readable access. */
export interface ReadOnlyPreviewProjection {
  preview: PreviewDTO;
  fullDraft: FullDraftDTO | null;
}

/**
 * Project one revision into the strict S05 DTOs. Locked body text is never
 * copied into PreviewDTO fields or its risk descriptions.
 */
export function buildPreviewProjection(input: PreviewProjectionInput): ReadOnlyPreviewProjection {
  const revision = draftRevisionSchema.parse(input.revision);
  const access = input.access;
  const risks = (input.risks ?? []).map((risk) => sanitizeRisk(risk, revision.ast, access));
  const preview = previewSchema.parse({
    snapshot: snapshotFromRevision(revision),
    access,
    title: revision.ast.title,
    language: revision.ast.language,
    claims: revision.ast.claims.map((claim) => ({
      ...claim,
      paragraphs: claim.paragraphs.map(previewParagraph),
      features: claim.features.map((feature) => ({ ...feature, supportParagraphIds: [] })),
    })),
    technicalField: paragraphsIn(revision.ast, "technical_field").map(previewParagraph),
    background: paragraphsIn(revision.ast, "background").map(previewParagraph),
    lockedSections: access === "preview" ? [...LOCKED_SECTION_KINDS] : [],
    risks,
    inputStale: input.inputStale,
  });
  const fullDraft = access === "preview"
    ? null
    : fullDraftSchema.parse({
      snapshot: preview.snapshot,
      ast: revision.ast,
      risks: risks.map((risk) => riskSchema.parse(risk)),
      inputStale: input.inputStale,
    });
  return { preview, fullDraft };
}

function previewParagraph(paragraph: Paragraph): Paragraph {
  return {
    ...paragraph,
    sourceRefs: [],
    generationJobId: null,
  };
}

function paragraphsIn(ast: DraftAST, kind: SectionKind): Paragraph[] {
  return ast.sections.find((section) => section.kind === kind)?.paragraphs ?? [];
}

function sanitizeRisk(riskInput: RiskDTO, ast: DraftAST, access: ContentAccess): RiskDTO {
  const risk = riskSchema.parse(riskInput);
  if (access !== "preview") return riskSchema.parse({ ...risk, anchor: { ...risk.anchor, locked: false } });
  const lockedKinds = new Set<SectionKind>(LOCKED_SECTION_KINDS);
  const lockedParagraphs = ast.sections
    .filter((section) => lockedKinds.has(section.kind))
    .flatMap((section) => section.paragraphs.map((paragraph) => ({ paragraph, section: section.kind })));
  const lockedNode = risk.anchor.nodeId === null
    ? undefined
    : lockedParagraphs.find(({ paragraph }) => paragraph.id === risk.anchor.nodeId);
  const sectionIsLocked = risk.anchor.section !== null
    && risk.anchor.section !== "claims"
    && lockedKinds.has(risk.anchor.section);
  const locked = lockedNode !== undefined || sectionIsLocked
    || (risk.anchor.locked && risk.anchor.nodeId === null && risk.anchor.section === null);
  const anchorSection = sectionIsLocked ? risk.anchor.section as SectionKind : lockedNode?.section;
  const unknownLockedAnchor = risk.anchor.locked && !lockedNode && !sectionIsLocked;
  const title = sanitizeRiskField(risk.title, lockedParagraphs, anchorSection, unknownLockedAnchor, false);
  const explanation = sanitizeRiskField(risk.explanation, lockedParagraphs, anchorSection, unknownLockedAnchor, true);
  return riskSchema.parse({
    ...risk,
    title,
    explanation,
    anchor: { ...risk.anchor, locked },
  });
}

function sanitizeRiskField(
  value: string,
  lockedParagraphs: readonly { paragraph: Paragraph; section: SectionKind }[],
  anchorSection: SectionKind | undefined,
  unknownLockedAnchor: boolean,
  explanation: boolean,
): string {
  const matchingParagraph = lockedParagraphs.find(({ paragraph }) => hasMeaningfulOverlap(value, paragraph.text));
  if (!matchingParagraph && !unknownLockedAnchor) return value;
  const section = matchingParagraph?.section ?? anchorSection;
  const label = section ? PREVIEW_SECTION_LABELS[section] : "锁定章节";
  return explanation
    ? `该风险位于${label}；正文在当前预览中不可见，请查看完整内容。`
    : `${label}风险`;
}

function hasMeaningfulOverlap(value: string, lockedText: string): boolean {
  const valueChars = normalizeForExcerptDetection(value);
  const lockedChars = normalizeForExcerptDetection(lockedText);
  if (valueChars.length === 0 || lockedChars.length === 0) return false;
  const shorterLength = Math.min(valueChars.length, lockedChars.length);
  const threshold = lockedChars.length < 8
    ? Math.max(1, Math.ceil(lockedChars.length * 0.8))
    : 8;
  if (shorterLength < threshold) return false;
  const [shorter, longer] = valueChars.length <= lockedChars.length
    ? [valueChars, lockedChars]
    : [lockedChars, valueChars];
  const longerText = longer.join("");
  for (let start = 0; start <= shorter.length - threshold; start += 1) {
    if (longerText.includes(shorter.slice(start, start + threshold).join(""))) return true;
  }
  return false;
}

function normalizeForExcerptDetection(value: string): string[] {
  return Array.from(value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
}

function sameDraftInputRef(a: DraftInputRef, b: DraftInputRef): boolean {
  return a.matterId === b.matterId
    && a.targetId === b.targetId
    && a.sourceVersion === b.sourceVersion
    && a.targetConfigVersion === b.targetConfigVersion
    && a.figureRevisionId === b.figureRevisionId;
}

export interface PreviewLoadReady {
  kind: "ready";
  revision: GenerationRevisionView;
  projection: ReadOnlyPreviewProjection;
  isCurrent: boolean;
  inputStale: boolean;
  currentSourceVersion: number;
  currentTargetConfigVersion: number;
  currentFigureRevisionId: string;
  confirmation: ContractConfirmation | null;
}

export type LocalPreviewLoad =
  | PreviewLoadReady
  | { kind: "empty" }
  | { kind: "failed"; code: string; message: string };

/** Read the current head and its local confirmation from the actual repository. */
export async function loadLocalPreview(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string,
  access: ContentAccess,
  risks: readonly RiskDTO[] = [],
): Promise<LocalPreviewLoad> {
  const revisions = createGenerationRevisionStore({ repository, actor });
  const head = await revisions.loadHeadRevision(matterId, targetId);
  if (!head.ok) return { kind: "failed", code: head.error.code, message: "无法读取当前草稿，请重试。" };
  if (head.data === null) return { kind: "empty" };

  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return { kind: "failed", code: loaded.error.code, message: "无法读取案件，请重试。" };
  const target = loaded.data.data.targets.find((candidate) => candidate.id === targetId);
  if (!target) return { kind: "failed", code: "RESOURCE_NOT_FOUND", message: "案件或目标不可用。" };

  const revision = head.data;
  const snapshot = snapshotFromRevision(revision.revision);
  const liveSnapshot: SnapshotRef = {
    matterId,
    targetId,
    sourceVersion: loaded.data.data.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: target.draftRevisionId ?? "",
    figureRevisionId: target.figureRevisionId,
  };
  const currentInput: DraftInputRef = {
    matterId,
    targetId,
    sourceVersion: liveSnapshot.sourceVersion,
    targetConfigVersion: liveSnapshot.targetConfigVersion,
    figureRevisionId: liveSnapshot.figureRevisionId,
  };
  const current = target.draftRevisionId !== null && isCurrent(snapshot, liveSnapshot);
  const inputStale = !sameDraftInputRef(revision.revision.input, currentInput);
  let confirmation: ContractConfirmation | null = null;
  if (current) {
    const ledger = await readConfirmationLedger(repository, actor, matterId);
    confirmation = currentConfirmations(ledger, snapshot).find((item) => item.kind === "full_read") ?? null;
  }
  return {
    kind: "ready",
    revision,
    projection: buildPreviewProjection({ revision: revision.revision, access, risks, inputStale }),
    isCurrent: current,
    inputStale,
    currentSourceVersion: loaded.data.data.matter.sourceVersion,
    currentTargetConfigVersion: target.configVersion,
    currentFigureRevisionId: target.figureRevisionId,
    confirmation,
  };
}

export type FullReadErrorCode = "ACTION_FORBIDDEN" | "RESOURCE_NOT_FOUND" | "STALE_BINDING" | "STORAGE_UNAVAILABLE";

export type FullReadResult =
  | { ok: true; confirmation: ContractConfirmation; created: boolean }
  | { ok: false; error: { code: FullReadErrorCode | string; message: string } };

/**
 * Commit one full_read through V6-05 after checking the live matter, target,
 * revision, and six-field snapshot in the same local storage transaction.
 */
export async function confirmLocalFullRead(options: {
  repository: LocalRepository;
  actor: Actor;
  snapshot: SnapshotRef;
  access: ContentAccess;
  newId?: (label: string) => string;
  now?: () => string;
}): Promise<FullReadResult> {
  const { repository, actor, snapshot, access } = options;
  const parsedSnapshot = snapshotRefSchema.safeParse(snapshot);
  if (!parsedSnapshot.success) return { ok: false, error: { code: "ACTION_FORBIDDEN", message: "当前内容无法确认通读。" } };

  const loaded = await repository.loadMatter(actor, snapshot.matterId);
  if (!loaded.ok) return { ok: false, error: { code: loaded.error.code, message: "案件或目标不可用。" } };
  const target = loaded.data.data.targets.find((candidate) => candidate.id === snapshot.targetId);
  if (!target) return { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "案件或目标不可用。" } };
  const liveSnapshot: SnapshotRef = {
    matterId: snapshot.matterId,
    targetId: snapshot.targetId,
    sourceVersion: loaded.data.data.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: target.draftRevisionId ?? "",
    figureRevisionId: target.figureRevisionId,
  };
  if (!isCurrent(snapshot, liveSnapshot)) {
    return { ok: false, error: { code: "STALE_BINDING", message: "草稿已更新，请刷新后重新核对。" } };
  }

  if (access !== "preview") {
    const revisions = createGenerationRevisionStore({ repository, actor });
    const head = await revisions.loadHeadRevision(snapshot.matterId, snapshot.targetId);
    if (!head.ok) return { ok: false, error: { code: head.error.code, message: "无法读取完整草稿。" } };
    if (!head.data || head.data.revision.id !== snapshot.draftRevisionId) {
      return { ok: false, error: { code: "STALE_BINDING", message: "草稿已更新，请刷新后重新核对。" } };
    }
    const readable = fullDraftSchema.safeParse({ snapshot, ast: head.data.ast, risks: [], inputStale: false });
    if (!readable.success) return { ok: false, error: { code: "ACTION_FORBIDDEN", message: "当前完整草稿无法读取。" } };
  }

  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const current = await matterInTransaction(tx, actor, snapshot.matterId, snapshot.targetId);
      if (!current || !isCurrent(snapshot, current.snapshot)) {
        return { ok: false, error: { code: "STALE_BINDING", message: "草稿已更新，请刷新后重新核对。" } } as const;
      }
      const ledger = await ledgerInTransaction(tx, actor, snapshot.matterId);
      const newId = options.newId ?? randomId;
      const outcome = confirm(ledger, {
        kind: "full_read",
        snapshot,
        actorId: actor.userId,
        identity: "local_self_reported",
        contentAccess: access,
      }, {
        newId,
        now: options.now ?? (() => new Date().toISOString()),
      });
      if (!outcome.ok) {
        return { ok: false, error: { code: outcome.error.code, message: outcome.error.message } } as const;
      }
      const confirmation = confirmationSchema.parse(outcome.confirmation);
      if (outcome.created) {
        const event: ActivityRecord = activitySchema.parse({
          id: newId("confirmation-event"),
          tenantId: actor.tenantId,
          matterId: snapshot.matterId,
          targetId: snapshot.targetId,
          actorId: actor.userId,
          actorKind: "user",
          action: "confirmation.created",
          snapshot,
          jobId: null,
          resourceId: confirmation.id,
          occurredAt: confirmation.createdAt,
          metadata: { count: 1 },
        });
        if (await tx.get(STORES.events, event.id) !== undefined) {
          return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "确认事件编号冲突，请重试。" } } as const;
        }
        await tx.put(STORES.matters, snapshot.matterId, {
          matter: {
            ...current.matter,
            version: (current.matter.version as number) + 1,
            updatedAt: confirmation.createdAt,
          },
          targets: current.targets,
          assets: current.assets,
        });
        await tx.put(STORES.events, event.id, event);
        await tx.put(STORES.blobs, confirmationLedgerKey(actor, snapshot.matterId), {
          kind: "preview.confirmation-ledger",
          tenantId: actor.tenantId,
          actorId: actor.userId,
          matterId: snapshot.matterId,
          ledger: outcome.state,
        });
      }
      return { ok: true, confirmation, created: outcome.created } as const;
    });
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "本机确认记录未能保存，请重试。" } };
  }
}

export function riskPresentation(category: RiskDTO["category"]): { shape: string; label: string } {
  return RISK_PRESENTATION[category];
}

export function snapshotFromRevision(revision: DraftRevision): SnapshotRef {
  return {
    matterId: revision.matterId,
    targetId: revision.targetId,
    sourceVersion: revision.input.sourceVersion,
    targetConfigVersion: revision.input.targetConfigVersion,
    draftRevisionId: revision.id,
    figureRevisionId: revision.input.figureRevisionId,
  };
}

const EMPTY_LEDGER = (matterId: string): ConfirmationLedger => ({ matterId, confirmations: [], revocations: [] });

async function readConfirmationLedger(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<ConfirmationLedger> {
  return repository.backend.transaction("readonly", (tx) => ledgerInTransaction(tx, actor, matterId));
}

async function ledgerInTransaction(
  tx: StorageTransaction,
  actor: Actor,
  matterId: string,
): Promise<ConfirmationLedger> {
  const row = await tx.get(STORES.blobs, confirmationLedgerKey(actor, matterId));
  if (!isRecord(row) || row.kind !== "preview.confirmation-ledger" || row.tenantId !== actor.tenantId
    || row.actorId !== actor.userId || row.matterId !== matterId || !isRecord(row.ledger)) {
    return EMPTY_LEDGER(matterId);
  }
  const candidate = row.ledger as Record<string, unknown>;
  if (candidate.matterId !== matterId || !Array.isArray(candidate.confirmations) || !Array.isArray(candidate.revocations)) {
    return EMPTY_LEDGER(matterId);
  }
  const confirmations = candidate.confirmations.flatMap((item) => {
    const parsed = confirmationSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const revocations = candidate.revocations.flatMap((item): ConfirmationLedger["revocations"][number][] => {
    const parsed = revocationSchema.safeParse(item);
    return parsed.success && parsed.data.objectType === "confirmation"
      ? [parsed.data as ConfirmationLedger["revocations"][number]]
      : [];
  });
  return { matterId, confirmations, revocations };
}

interface LocalMatterSnapshot {
  snapshot: SnapshotRef;
  matter: Record<string, unknown>;
  targets: readonly unknown[];
  assets: readonly unknown[];
}

async function matterInTransaction(
  tx: StorageTransaction,
  actor: Actor,
  matterId: string,
  targetId: string,
): Promise<LocalMatterSnapshot | null> {
  // LocalRepository owns the stored aggregate shape. This same-transaction
  // read binds the ledger append, event and aggregate version to one snapshot.
  const raw = await tx.get(STORES.matters, matterId);
  if (!isRecord(raw) || !isRecord(raw.matter) || raw.matter.tenantId !== actor.tenantId
    || raw.matter.createdBy !== actor.userId || raw.matter.status !== "active"
    || !Number.isSafeInteger(raw.matter.version) || !Number.isSafeInteger(raw.matter.sourceVersion)
    || !Array.isArray(raw.targets) || !Array.isArray(raw.assets)) return null;
  const target = raw.targets.find((item) => isRecord(item) && item.id === targetId && item.matterId === matterId);
  if (!isRecord(target) || target.status !== "active" || !Number.isSafeInteger(target.configVersion)
    || typeof target.figureRevisionId !== "string" || typeof target.draftRevisionId !== "string") return null;
  return {
    snapshot: {
      matterId,
      targetId,
      sourceVersion: raw.matter.sourceVersion as number,
      targetConfigVersion: target.configVersion as number,
      draftRevisionId: target.draftRevisionId,
      figureRevisionId: target.figureRevisionId,
    },
    matter: raw.matter,
    targets: raw.targets,
    assets: raw.assets,
  };
}

function confirmationLedgerKey(actor: Actor, matterId: string): string {
  return `preview/confirmations/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}`;
}

function randomId(_label: string): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw new Error("Secure UUID generation is unavailable.");
  return globalThis.crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
