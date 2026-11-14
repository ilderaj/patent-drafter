import type { IntakeView } from "../intake/intake.ts";
import type { SelfServiceStep } from "../../routes/navigation.ts";
import type { TargetRecord } from "../../lib/repository.ts";

export interface SelfServiceProgress {
  intake: IntakeView;
  target: { id: string; config: unknown | null } | null;
  targetRecord: Pick<TargetRecord, "draftRevisionId"> | null;
}

export function needsQuestionRepair(intake: IntakeView): boolean {
  return intake.missing.length > 0 || intake.questions.some((question) => question.answered && question.sourceChanged);
}

/** The first real prerequisite for a deep link; this function never writes data. */
export function requiredSelfServiceStep(step: SelfServiceStep, progress: SelfServiceProgress): SelfServiceStep {
  if (["route", "generate", "preview", "done"].includes(step) && needsQuestionRepair(progress.intake)) return "questions";
  if (["generate", "preview", "done"].includes(step) && (progress.target === null || progress.target.config === null)) return "route";
  if (["preview", "done"].includes(step) && progress.targetRecord?.draftRevisionId == null) return "generate";
  return step;
}

export function resolveQuestionIndex(intake: IntakeView, requested: string | null): number {
  const requestedIndex = requested === null ? Number.NaN : Number(requested);
  const firstMissingKey = intake.missing[0]
    ?? intake.questions.find((question) => question.answered && question.sourceChanged)?.key;
  const firstMissing = firstMissingKey === undefined
    ? -1
    : Math.max(0, intake.questions.findIndex((question) => question.key === firstMissingKey));
  if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < intake.questions.length) {
    return firstMissing >= 0 ? Math.min(requestedIndex, firstMissing) : requestedIndex;
  }
  return firstMissing >= 0 ? firstMissing : intake.questions.length - 1;
}
