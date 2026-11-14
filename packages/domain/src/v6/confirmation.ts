/**
 * V6-05 — content confirmations (S07, 05-contracts §4).
 *
 * A confirmation is a promise about one snapshot: "I read this draft", "I read
 * this AI paragraph", "I accept this risk". It never carries over to a new
 * revision, because `isCurrent` compares every SnapshotRef field (C01). Creating
 * and revoking are pure transitions over an append-only ledger; nothing here
 * writes storage, reads the clock or allocates ambient IDs.
 *
 * The AI paragraph list is passed in rather than read from the AST: the AST is
 * opaque to the domain layer (V6-04), and 05-contracts §4 ties `ai_paragraph` to
 * an `ai`/`mixed` paragraph of the revision being confirmed.
 */
import type { SnapshotRef } from "./revision.js";

export type ConfirmationKind = "full_read" | "ai_paragraph" | "risk_ack";

/** §4 `Confirmation.identity`: R1 records the local user as self-reported. */
export type ConfirmationIdentity = "authenticated" | "local_self_reported" | "legacy_unverified";

/** 05-contracts §4 `Confirmation`. */
export interface Confirmation {
  id: string;
  snapshot: SnapshotRef;
  actorId: string;
  identity: ConfirmationIdentity;
  kind: ConfirmationKind;
  paragraphId: string | null;
  riskId: string | null;
  checkRunId: string | null;
  createdAt: string;
}

/** 05-contracts §4 `Revocation`; only `confirmation` is produced here. */
export interface Revocation {
  id: string;
  objectType: "confirmation";
  objectId: string;
  actorId: string;
  reason: string;
  createdAt: string;
}

/** Append-only ledger. A revocation is a record, not an edit to the confirmation. */
export interface ConfirmationLedger {
  matterId: string;
  confirmations: readonly Confirmation[];
  revocations: readonly Revocation[];
}

/** Injected determinism: the only sources of IDs and time. */
export interface ConfirmationContext {
  newId: (label: string) => string;
  now: () => string;
}

export type ConfirmationErrorCode =
  | "INVALID_INPUT"
  | "RESOURCE_NOT_FOUND"
  | "ACTION_FORBIDDEN"
  | "INVALID_TRANSITION";

export interface ConfirmationError {
  code: ConfirmationErrorCode;
  message: string;
  fields?: readonly { path: string; reason: string }[];
}

export type ConfirmationOutcome<T = Confirmation> =
  | { ok: true; state: ConfirmationLedger; confirmation: T; created: boolean }
  | { ok: false; error: ConfirmationError; state: ConfirmationLedger };

export interface RevokeOutcome {
  ok: true;
  state: ConfirmationLedger;
  revocation: Revocation;
}

export type RevokeResult = RevokeOutcome | { ok: false; error: ConfirmationError; state: ConfirmationLedger };

/**
 * `full_read` states how well the user could see the whole draft. §4 allows the
 * confirmation only when the full content is readable, so a preview-only
 * session cannot produce one.
 */
export type ContentAccess = "preview" | "full" | "local_unmetered";

export interface FullReadCommand {
  kind: "full_read";
  snapshot: SnapshotRef;
  actorId: string;
  identity: ConfirmationIdentity;
  contentAccess: ContentAccess;
}

export interface AiParagraphCommand {
  kind: "ai_paragraph";
  snapshot: SnapshotRef;
  actorId: string;
  identity: ConfirmationIdentity;
  paragraphId: string;
  /** The `ai`/`mixed` paragraphs of the snapshot being confirmed. */
  aiParagraphIds: readonly string[];
}

export interface RiskAckCommand {
  kind: "risk_ack";
  snapshot: SnapshotRef;
  actorId: string;
  identity: ConfirmationIdentity;
  riskId: string;
  checkRunId: string;
}

export type ConfirmCommand = FullReadCommand | AiParagraphCommand | RiskAckCommand;

export interface RevokeCommand {
  confirmationId: string;
  actorId: string;
  reason: string;
}

/** A revocation names the confirmation it retires; matching is by object id. */
export function isRevoked(ledger: ConfirmationLedger, confirmationId: string): boolean {
  return ledger.revocations.some((item) => item.objectId === confirmationId);
}

/** Current = bound to this snapshot and not revoked. The snapshot is the whole promise. */
export function isConfirmationCurrent(
  ledger: ConfirmationLedger,
  confirmation: Confirmation,
  snapshot: SnapshotRef,
): boolean {
  return !isRevoked(ledger, confirmation.id) && sameSnapshot(confirmation.snapshot, snapshot);
}

/**
 * The confirmations still in force for a snapshot. `GateContext.confirmations`
 * expects exactly this list: a gate that received a revoked confirmation would
 * approve content the user withdrew.
 */
export function currentConfirmations(ledger: ConfirmationLedger, snapshot: SnapshotRef): readonly Confirmation[] {
  return ledger.confirmations.filter((item) => isConfirmationCurrent(ledger, item, snapshot));
}

export interface ConfirmationStatus {
  /** A current `full_read` exists (the self-service mode). */
  fullRead: boolean;
  /** AI paragraphs of this snapshot that carry a current confirmation. */
  confirmedAiParagraphIds: readonly string[];
  /** AI paragraphs of this snapshot that do not. */
  pendingAiParagraphIds: readonly string[];
  /** Risks acknowledged against the given check run, still current. */
  acknowledgedRiskIds: readonly string[];
}

/**
 * What the user has confirmed for one snapshot, computed from the ledger so no
 * caller can invent a progress count (§4 `RevisionSummary`).
 */
export function confirmationStatus(
  ledger: ConfirmationLedger,
  snapshot: SnapshotRef,
  aiParagraphIds: readonly string[],
  checkRunId: string | null = null,
): ConfirmationStatus {
  const live = currentConfirmations(ledger, snapshot);
  const confirmedAi = new Set(
    live.filter((item) => item.kind === "ai_paragraph").map((item) => item.paragraphId as string),
  );
  const acknowledged = new Set(
    live
      .filter((item) => item.kind === "risk_ack" && (checkRunId === null || item.checkRunId === checkRunId))
      .map((item) => item.riskId as string),
  );
  return {
    fullRead: live.some((item) => item.kind === "full_read"),
    confirmedAiParagraphIds: aiParagraphIds.filter((id) => confirmedAi.has(id)),
    pendingAiParagraphIds: aiParagraphIds.filter((id) => !confirmedAi.has(id)),
    acknowledgedRiskIds: [...acknowledged],
  };
}

/**
 * Record a confirmation. Confirming the same thing twice on the same snapshot is
 * idempotent: the ledger keeps one row and reports `created: false`, so a retried
 * click cannot inflate the count or duplicate an audit record.
 */
export function confirm(
  ledger: ConfirmationLedger,
  command: ConfirmCommand,
  context: ConfirmationContext,
): ConfirmationOutcome {
  if (command.snapshot.matterId !== ledger.matterId) {
    return fail(ledger, "RESOURCE_NOT_FOUND", `snapshot belongs to matter ${command.snapshot.matterId}, not ${ledger.matterId}`);
  }

  if (command.kind === "full_read" && command.contentAccess === "preview") {
    // §4: a full read cannot be claimed from a redacted preview.
    return fail(ledger, "ACTION_FORBIDDEN", "full_read requires the full draft, not a redacted preview", [
      { path: "contentAccess", reason: "the locked sections were not readable" },
    ]);
  }

  if (command.kind === "ai_paragraph" && !command.aiParagraphIds.includes(command.paragraphId)) {
    return fail(ledger, "INVALID_INPUT", `paragraph ${command.paragraphId} is not an AI paragraph of this draft`, [
      { path: "paragraphId", reason: "ai_paragraph confirms only ai/mixed paragraphs" },
    ]);
  }

  if (command.kind === "risk_ack" && (command.riskId.length === 0 || command.checkRunId.length === 0)) {
    return fail(ledger, "INVALID_INPUT", "risk_ack requires both the risk and the check run that raised it", [
      { path: "riskId", reason: "a risk acknowledgement is bound to a check run" },
    ]);
  }

  const duplicate = ledger.confirmations.find((item) => !isRevoked(ledger, item.id) && sameConfirmation(item, command));
  if (duplicate) {
    return { ok: true, state: ledger, confirmation: duplicate, created: false };
  }

  const confirmation: Confirmation = {
    id: context.newId("confirmation"),
    snapshot: { ...command.snapshot },
    actorId: command.actorId,
    identity: command.identity,
    kind: command.kind,
    paragraphId: command.kind === "ai_paragraph" ? command.paragraphId : null,
    riskId: command.kind === "risk_ack" ? command.riskId : null,
    checkRunId: command.kind === "risk_ack" ? command.checkRunId : null,
    createdAt: context.now(),
  };
  return {
    ok: true,
    state: { ...ledger, confirmations: [...ledger.confirmations, confirmation] },
    confirmation,
    created: true,
  };
}

/**
 * Withdraw a confirmation (S06-A03: revoking one AI paragraph confirmation makes
 * the approval invalid). The confirmation row stays; the revocation is appended,
 * so the history shows what was claimed and when it was withdrawn.
 */
export function revokeConfirmation(
  ledger: ConfirmationLedger,
  command: RevokeCommand,
  context: ConfirmationContext,
): RevokeResult {
  const confirmation = ledger.confirmations.find((item) => item.id === command.confirmationId);
  if (!confirmation) {
    return fail(ledger, "RESOURCE_NOT_FOUND", `confirmation ${command.confirmationId} is not in this matter`);
  }
  if (command.reason.trim().length === 0) {
    return fail(ledger, "INVALID_INPUT", "a revocation must state why it was withdrawn", [
      { path: "reason", reason: "the audit record needs a reason" },
    ]);
  }
  if (isRevoked(ledger, confirmation.id)) {
    // Revoking twice is not a new fact; report the transition rather than duplicate it.
    return fail(ledger, "INVALID_TRANSITION", `confirmation ${confirmation.id} is already revoked`);
  }

  const revocation: Revocation = {
    id: context.newId("revocation"),
    objectType: "confirmation",
    objectId: confirmation.id,
    actorId: command.actorId,
    reason: command.reason,
    createdAt: context.now(),
  };
  return { ok: true, state: { ...ledger, revocations: [...ledger.revocations, revocation] }, revocation };
}

function sameConfirmation(existing: Confirmation, command: ConfirmCommand): boolean {
  return (
    existing.actorId === command.actorId &&
    existing.kind === command.kind &&
    existing.paragraphId === (command.kind === "ai_paragraph" ? command.paragraphId : null) &&
    existing.riskId === (command.kind === "risk_ack" ? command.riskId : null) &&
    existing.checkRunId === (command.kind === "risk_ack" ? command.checkRunId : null) &&
    sameSnapshot(existing.snapshot, command.snapshot)
  );
}

/**
 * §2 snapshot equality, field for field with `revision.ts#isCurrent`. A domain
 * module cannot import a sibling at runtime: Node's type stripping resolves only
 * explicit `.ts` specifiers, and the packages that map `@patent/domain` into
 * their own tsconfig do not enable `allowImportingTsExtensions`. The V6-05 suite
 * proves this copy agrees with `isCurrent` by changing each of the six fields.
 */
function sameSnapshot(a: SnapshotRef, b: SnapshotRef): boolean {
  return (
    a.matterId === b.matterId &&
    a.targetId === b.targetId &&
    a.sourceVersion === b.sourceVersion &&
    a.targetConfigVersion === b.targetConfigVersion &&
    a.draftRevisionId === b.draftRevisionId &&
    a.figureRevisionId === b.figureRevisionId
  );
}

function fail(
  state: ConfirmationLedger,
  code: ConfirmationErrorCode,
  message: string,
  fields?: readonly { path: string; reason: string }[],
): { ok: false; error: ConfirmationError; state: ConfirmationLedger } {
  const error: ConfirmationError = { code, message };
  if (fields) error.fields = fields;
  return { ok: false, error, state };
}
