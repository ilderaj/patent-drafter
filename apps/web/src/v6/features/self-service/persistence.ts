import type { Fact, FactConflict, IntakeAnswers, Party } from "../../../../../../packages/contracts/src/matter.ts";
import type { IntakeView, IntakeQuestionKey, QuestionSource, SaveIntakeInput } from "../intake/intake.ts";

export interface IntakeChanges {
  answers?: IntakeAnswers;
  questionSources?: Partial<Record<IntakeQuestionKey, QuestionSource>>;
  parties?: readonly Party[];
}

export function intakeSaveInput(view: IntakeView, changes: IntakeChanges = {}): SaveIntakeInput {
  const questionSources: Partial<Record<IntakeQuestionKey, QuestionSource>> = {};
  for (const question of view.questions) {
    if (question.answered && question.source !== null) questionSources[question.key] = question.source;
  }
  Object.assign(questionSources, changes.questionSources);

  const facts: Fact[] = view.facts.map((fact) => ({
    id: fact.id,
    statement: fact.statement,
    kind: fact.kind,
    status: fact.status,
    refs: fact.refs,
    confirmedBy: fact.confirmedBy,
    confirmedAt: fact.confirmedAt,
  }));
  const conflicts: FactConflict[] = view.conflicts.map((conflict) => ({
    id: conflict.id,
    factIds: conflict.factIds,
    state: conflict.state,
    chosenFactIds: conflict.chosenFactIds,
    reason: conflict.reason,
  }));

  return {
    baseSourceVersion: view.sourceVersion,
    answers: changes.answers ?? view.answers,
    questionSources,
    facts,
    conflicts,
    parties: [...(changes.parties ?? view.parties)],
  };
}
