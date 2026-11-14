/** S06 next-action projection, shared by the matter list and inbox. */
export type NextActionKind =
  | "add_sources"
  | "resolve_conflict"
  | "generate_draft"
  | "refresh_inputs"
  | "confirm_content"
  | "run_check"
  | "ack_risk"
  | "approve"
  | "export"
  | "record_receipt"
  | "none";

export interface NextActionState {
  hasValidSource: boolean;
  fiveQuestionsComplete: boolean;
  hasOpenConflict: boolean;
  hasDraft: boolean;
  inputStale: boolean;
  mode: "professional" | "self_service";
  hasUnconfirmedGeneratedContent: boolean;
  hasFullRead: boolean;
  hasCurrentCheck: boolean;
  hasUnacknowledgedRequiredRisk: boolean;
  hasInternalApproval: boolean;
  hasCurrentExport: boolean;
  hasConfirmedReceipt: boolean;
}

/** Return the first matching S06 row. This function is pure and deterministic. */
export function nextAction(target: NextActionState): NextActionKind {
  if (!target.hasValidSource && !target.fiveQuestionsComplete) return "add_sources";
  if (target.hasOpenConflict) return "resolve_conflict";
  if (!target.hasDraft) return "generate_draft";
  if (target.inputStale) return "refresh_inputs";
  if (
    (target.mode === "professional" && target.hasUnconfirmedGeneratedContent)
    || (target.mode === "self_service" && !target.hasFullRead)
  ) return "confirm_content";
  if (!target.hasCurrentCheck) return "run_check";
  if (target.hasUnacknowledgedRequiredRisk) return "ack_risk";
  if (target.mode === "professional" && !target.hasInternalApproval) return "approve";
  if (!target.hasCurrentExport) return "export";
  if (target.hasCurrentExport && !target.hasConfirmedReceipt) return "record_receipt";
  return "none";
}
