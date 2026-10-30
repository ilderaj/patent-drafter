/**
 * V6-05 — the delivery gate (S07, 05-contracts §6).
 *
 * `evaluateGate` answers one question for one action: may this snapshot be
 * generated, confirmed, prepared, approved, exported or downloaded right now?
 * It is a pure function of its inputs. Everything it needs — whether the files
 * are still present, whether the snapshot is current, which confirmations are
 * live — is resolved by the caller and passed in, because the domain layer owns
 * no storage and no clock.
 *
 * A gate never reports "allowed" on missing evidence: an unknown blocker rule,
 * an expired check or a confirmation bound to another snapshot all close it.
 * The refusal carries `ErrorCode`s from 05-contracts §10, so the page can say
 * what to fix instead of "gate blocked".
 */
import type { Confirmation } from "./confirmation.js";
import type { SnapshotRef } from "./revision.js";

/** §6 `GateAction`. */
export type GateAction = "generate" | "confirm" | "prepare" | "approve" | "export" | "download";

/**
 * The refusal codes this module can produce. Every one is in §10; the test
 * parses each emitted reason against `errorCodeSchema` so this list cannot drift.
 */
export type GateErrorCode =
  | "GATE_BLOCKED"
  | "CHECK_REQUIRED"
  | "CONFIRMATION_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "INPUT_STALE"
  | "STALE_BINDING"
  | "MISSING_BYTES"
  | "BAD_DRAWING"
  | "DUPLICATE_FIGURE_NUMBER"
  | "INVALID_AST";

export type RiskCategory = "blocker" | "risk" | "unverified" | "policy";
export type FindingStatus = "open" | "acknowledged" | "resolved";

/** §6 `RiskDTO`. */
export interface Risk {
  id: string;
  category: RiskCategory;
  title: string;
  explanation: string;
  ruleId: string;
  requiresAcknowledgement: boolean;
  anchor: { nodeId: string | null; section: string | null; locked: boolean };
}

/** §6 `RiskDTO` plus the check-run bookkeeping the schema adds to a finding. */
export interface Finding extends Risk {
  status: FindingStatus;
  evidenceNodeIds: readonly string[];
}

/** §6 `CheckRun`. */
export interface CheckRun {
  id: string;
  snapshot: SnapshotRef;
  rulePackVersion: string;
  state: "queued" | "running" | "succeeded" | "failed";
  findings: readonly Finding[];
  createdAt: string;
}

/** §6 `Approval`. */
export interface Approval {
  id: string;
  snapshot: SnapshotRef;
  checkRunId: string;
  confirmationIds: readonly string[];
  actorId: string;
  purpose: "internal_release";
  note: string;
  createdAt: string;
}

/** §6 `GateContext` — exactly the contract's fields, in the contract's order. */
export interface GateContext {
  action: GateAction;
  snapshot: SnapshotRef;
  snapshotCurrent: boolean;
  filesAvailable: boolean;
  rulePackVersion: string;
  activeRulePackVersion: string;
  checkRun: CheckRun | null;
  approval: Approval | null;
  /** The live (not revoked) confirmations; `currentConfirmations` builds this list. */
  confirmations: readonly Confirmation[];
  risks: readonly Risk[];
  now: string;
}

export interface GateReason {
  code: GateErrorCode;
  resourceId?: string;
}

/** §6 `GateDecision`. */
export interface GateDecision {
  action: GateAction;
  allowed: boolean;
  evaluatedAt: string;
  reasons: readonly GateReason[];
}

/**
 * Facts the contract's `GateContext` does not carry but the §6 rules need. They
 * are supplied by the caller that also builds the context, so the gate stays a
 * pure function and never guesses a package kind or a confirmation mode.
 */
export interface GateFacts {
  packageKind: "preparation" | "internally_approved";
  confirmationMode: "self_read" | "professional_paragraphs";
  /** S05 `inputStale`: the draft was written against inputs the matter has since replaced. */
  inputStale: boolean;
  /** The `ai`/`mixed` paragraphs of the draft that must be confirmed one by one. */
  aiParagraphIds: readonly string[];
  /**
   * The `policy` rules whose rule record declares this action as blocked (S07:
   * a product policy blocks only the actions it names). Engineering blockers do
   * not appear here; they block on their category alone.
   */
  blockingPolicyRuleIds: readonly string[];
}

/**
 * Engineering blocker rules whose refusals have their own §10 code. A finding
 * from any other rule — including every legal or policy rule — is still a
 * blocker, but its refusal is `GATE_BLOCKED`: the gate does not invent a code
 * the contract does not define for it.
 */
export const ENGINEERING_RULE_CODES: Readonly<Record<string, GateErrorCode>> = Object.freeze({
  "ast.invalid": "INVALID_AST",
  "asset.missing_bytes": "MISSING_BYTES",
  "asset.bad_drawing": "BAD_DRAWING",
  "figure.duplicate_number": "DUPLICATE_FIGURE_NUMBER",
});

/** Actions whose rules the rule pack declares (§6: prepare, approve, export). */
const CHECKED_ACTIONS: readonly GateAction[] = ["prepare", "approve", "export"];

export function evaluateGate(context: GateContext, facts: GateFacts): GateDecision {
  const reasons: GateReason[] = [];
  const push = (code: GateErrorCode, resourceId?: string) => {
    if (reasons.some((item) => item.code === code && item.resourceId === resourceId)) return;
    reasons.push(resourceId === undefined ? { code } : { code, resourceId });
  };

  if (context.action === "generate") {
    // Generation needs sources; it does not need a current snapshot, because the
    // snapshot is what it is about to create.
    if (!context.filesAvailable) push("MISSING_BYTES");
    return decide(context, reasons);
  }

  if (!context.snapshotCurrent) {
    // Every remaining action acts on a snapshot; a replaced snapshot has none.
    push("STALE_BINDING");
    return decide(context, reasons);
  }

  if (context.action === "confirm") {
    // Confirming is a read of the current snapshot only.
    return decide(context, reasons);
  }

  if (context.action === "download") {
    // §6: an export is re-checked when it is downloaded. The export record itself
    // is not in GateContext, so the download re-check is limited to the binding.
    return decide(context, reasons);
  }

  if (!CHECKED_ACTIONS.includes(context.action)) return decide(context, reasons);

  if (!context.filesAvailable) push("MISSING_BYTES");

  const check = context.checkRun;
  if (check === null || !isCheckValid(check, context)) {
    push("CHECK_REQUIRED", check === null ? undefined : check.id);
    // Without a valid check there are no findings to read, and no risk can be
    // claimed as acknowledged against a check run that is no longer current.
    return decide(context, reasons);
  }

  const acknowledged = acknowledgedRiskIds(context, check);
  for (const finding of findingsOf(context, check)) {
    if (finding.category === "unverified") continue; // S07-A01: never blocks
    if (finding.category === "blocker") {
      // A blocker is a defect the product can decide; acknowledging it does not
      // remove it (S07-A05) and neither does a status of "resolved", which only a
      // rerun that no longer finds it may produce. Any present blocker blocks.
      push(ENGINEERING_RULE_CODES[finding.ruleId] ?? "GATE_BLOCKED", finding.id);
      continue;
    }
    if (finding.category === "policy") {
      // S07: a product policy blocks only the action its rule explicitly names;
      // the caller passes the rule ids that declared this action.
      if (facts.blockingPolicyRuleIds.includes(finding.ruleId)) push("GATE_BLOCKED", finding.id);
      continue;
    }
    // category === "risk": a risk that needs acknowledgement needs it while it is
    // present, whatever its status says. A resolved status may only come from a
    // rerun that no longer reports the risk (S07), so a present one fails closed.
    if (finding.requiresAcknowledgement && !acknowledged.has(finding.id)) {
      push("CONFIRMATION_REQUIRED", finding.id);
    }
  }

  if (facts.inputStale) push("INPUT_STALE");

  for (const paragraphId of pendingContent(context, facts)) {
    push("CONFIRMATION_REQUIRED", paragraphId);
  }

  if (context.action === "export" && facts.packageKind === "internally_approved") {
    for (const reason of approvalReasons(context, check)) push(reason.code, reason.resourceId);
  }

  return decide(context, reasons);
}

function decide(context: GateContext, reasons: readonly GateReason[]): GateDecision {
  return { action: context.action, allowed: reasons.length === 0, evaluatedAt: context.now, reasons };
}

/** A check speaks for a snapshot only while it is the success of the active pack. */
function isCheckValid(check: CheckRun, context: GateContext): boolean {
  return (
    check.state === "succeeded" &&
    sameSnapshot(check.snapshot, context.snapshot) &&
    check.rulePackVersion === context.activeRulePackVersion
  );
}

/**
 * The check's findings plus any risk the context carries that the check does
 * not repeat. §6 puts the current `RiskDTO[]` on the context alongside the
 * check run, so a risk the check has not echoed still has to be evaluated; it
 * enters as open, because a risk with no finding carries no resolved state.
 */
function findingsOf(context: GateContext, check: CheckRun): readonly Finding[] {
  const known = new Set(check.findings.map((item) => item.id));
  const extras: Finding[] = [];
  for (const risk of context.risks) {
    if (known.has(risk.id)) continue;
    extras.push({ ...risk, status: "open", evidenceNodeIds: [] });
  }
  return extras.length === 0 ? check.findings : [...check.findings, ...extras];
}

/**
 * Risks the user has actually acknowledged: a risk_ack confirmation that is
 * bound to this snapshot and to the current check run. A confirmation from an
 * earlier check run does not carry over (S07-A04).
 */
function acknowledgedRiskIds(context: GateContext, check: CheckRun): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of context.confirmations) {
    if (item.kind !== "risk_ack" || item.riskId === null) continue;
    if (item.checkRunId !== check.id) continue;
    if (!sameSnapshot(item.snapshot, context.snapshot)) continue;
    ids.add(item.riskId);
  }
  return ids;
}

/** Paragraph ids still unconfirmed, in the order the draft lists them. */
function pendingContent(context: GateContext, facts: GateFacts): readonly string[] {
  if (facts.confirmationMode === "self_read") {
    const read = context.confirmations.some(
      (item) => item.kind === "full_read" && sameSnapshot(item.snapshot, context.snapshot),
    );
    return read ? [] : ["full_read"];
  }
  const confirmed = new Set(
    context.confirmations
      .filter((item) => item.kind === "ai_paragraph" && item.paragraphId !== null && sameSnapshot(item.snapshot, context.snapshot))
      .map((item) => item.paragraphId as string),
  );
  return facts.aiParagraphIds.filter((id) => !confirmed.has(id));
}

/**
 * §2 snapshot equality, field for field with `revision.ts#isCurrent`; the reason
 * it is restated rather than imported is on the copy in `confirmation.ts`. The
 * V6-05 suite changes each of the six fields and shows this gate notices.
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

/**
 * An internal release is valid only while every dependency it names is still
 * current: the approval's own binding, the check run it was granted on, and each
 * confirmation it cites (§6, S06-A03).
 */
function approvalReasons(context: GateContext, check: CheckRun): readonly GateReason[] {
  const approval = context.approval;
  if (!approval) return [{ code: "APPROVAL_REQUIRED" }];
  const reasons: GateReason[] = [];
  if (!sameSnapshot(approval.snapshot, context.snapshot) || approval.checkRunId !== check.id) {
    reasons.push({ code: "APPROVAL_REQUIRED", resourceId: approval.id });
    return reasons;
  }
  const live = new Set(
    context.confirmations.filter((item) => sameSnapshot(item.snapshot, context.snapshot)).map((item) => item.id),
  );
  for (const confirmationId of approval.confirmationIds) {
    if (!live.has(confirmationId)) reasons.push({ code: "APPROVAL_REQUIRED", resourceId: confirmationId });
  }
  return reasons;
}
