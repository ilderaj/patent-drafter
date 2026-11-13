/**
 * The user's saved intake answers as honest, citable sources.
 *
 * A matter without uploaded documents can still be drafted from what the user
 * typed. These sources are labelled "用户直接回答 · 第 N 题"; they are never
 * presented as files, pages or parsed chunks. Ids are derived from the answer
 * text, so changing an answer changes the chunk id and hash (older consent no
 * longer covers it) while a recovered matter keeps the same ids.
 *
 * Only the two free-text technical answers are sent to a processor. Inventor
 * names, public-disclosure history and maturity are required to be answered but
 * are not needed to draft, so they stay on the device (data minimisation).
 */
import { intakeAnswersSchema, type Fact, type SourceRef } from "../../../../../../packages/contracts/src/matter.ts";
import { sha256Hex } from "../../lib/repository.ts";
import { derivedId } from "../sources/parse.ts";
import { INTAKE_QUESTIONS, isAnswered, type IntakeQuestionKey } from "./intake.ts";

/** Questions whose text is sent to the processor, in question order. */
export const SENT_ANSWER_KEYS: readonly IntakeQuestionKey[] = Object.freeze(["problem", "difference"] as const);

export const ANSWER_ORIGIN_LABEL = "用户直接回答";

export function answerSourceLabel(questionNo: number): string {
  return `${ANSWER_ORIGIN_LABEL} · 第 ${questionNo} 题`;
}

export interface AnswerSourceItem {
  questionNo: number;
  key: IntakeQuestionKey;
  label: string;
  answered: boolean;
  /** True when the answer text is part of an outbound payload. */
  sent: boolean;
  /** Unicode code points of the sent text; null when nothing is sent. */
  characters: number | null;
  chunkId: string | null;
  factId: string | null;
}

export interface AnswerChunk {
  id: string;
  sourceId: string;
  questionNo: number;
  label: string;
  text: string;
  hash: string;
}

export interface AnswerSources {
  sourceId: string;
  items: readonly AnswerSourceItem[];
  chunks: readonly AnswerChunk[];
  facts: readonly Fact[];
  total: number;
  answered: number;
  complete: boolean;
  missing: readonly string[];
}

export interface AnswerSourceInput {
  answers: unknown;
  confirmedBy: string;
  confirmedAt: string;
}

/** Shape the manifest and the confirmation dialog read (counts and labels, no text). */
export interface AnswerManifestSummary {
  total: number;
  answered: number;
  sentCount: number;
  complete: boolean;
  missing: readonly string[];
  items: readonly Pick<AnswerSourceItem, "questionNo" | "key" | "label" | "answered" | "sent" | "characters" | "chunkId">[];
}

export function answerManifestSummary(sources: AnswerSources): AnswerManifestSummary {
  return {
    total: sources.total,
    answered: sources.answered,
    sentCount: sources.chunks.length,
    complete: sources.complete,
    missing: sources.missing,
    items: sources.items.map(({ questionNo, key, label, answered, sent, characters, chunkId }) => ({
      questionNo, key, label, answered, sent, characters, chunkId,
    })),
  };
}

function sentText(key: IntakeQuestionKey, answers: { problem: string; difference: string }): string {
  const raw = key === "problem" ? answers.problem : key === "difference" ? answers.difference : "";
  return raw.normalize("NFC").trim();
}

const FACT_KIND: Readonly<Partial<Record<IntakeQuestionKey, Fact["kind"]>>> = Object.freeze({
  problem: "problem",
  difference: "structure",
});

export async function buildAnswerSources(input: AnswerSourceInput | null): Promise<AnswerSources> {
  const sourceId = await derivedId("v6/user-direct-answers/source");
  const parsed = input === null ? null : intakeAnswersSchema.safeParse(input.answers);
  const answers = parsed?.success ? parsed.data : null;
  const items: AnswerSourceItem[] = [];
  const chunks: AnswerChunk[] = [];
  const facts: Fact[] = [];
  for (const [index, definition] of INTAKE_QUESTIONS.entries()) {
    const questionNo = index + 1;
    const answered = answers !== null && isAnswered(definition.key, answers);
    const sends = answered && SENT_ANSWER_KEYS.includes(definition.key);
    if (!sends || answers === null || input === null) {
      items.push({ questionNo, key: definition.key, label: definition.label, answered, sent: false, characters: null, chunkId: null, factId: null });
      continue;
    }
    const text = sentText(definition.key, answers);
    const hash = await sha256Hex(new TextEncoder().encode(text));
    const chunkId = await derivedId(`v6/user-answer/chunk/${definition.key}/${hash}`);
    const factId = await derivedId(`v6/user-answer/fact/${definition.key}/${hash}`);
    const characters = Array.from(text).length;
    chunks.push({ id: chunkId, sourceId, questionNo, label: answerSourceLabel(questionNo), text, hash });
    facts.push({
      id: factId,
      statement: text,
      kind: FACT_KIND[definition.key] ?? "structure",
      status: "user_confirmed",
      refs: [answerSourceRef({ sourceId, chunkId, hash, questionNo, text })],
      confirmedBy: input.confirmedBy,
      confirmedAt: input.confirmedAt,
    });
    items.push({ questionNo, key: definition.key, label: definition.label, answered, sent: true, characters, chunkId, factId });
  }
  const answeredCount = items.filter((item) => item.answered).length;
  return {
    sourceId,
    items,
    chunks,
    facts,
    total: items.length,
    answered: answeredCount,
    complete: answeredCount === items.length,
    missing: items.filter((item) => !item.answered).map((item) => `第 ${item.questionNo} 题（${item.label}）`),
  };
}

export function answerSourceRef(input: { sourceId: string; chunkId: string; hash: string; questionNo: number; text: string }): SourceRef {
  return {
    sourceId: input.sourceId,
    chunkId: input.chunkId,
    chunkHash: input.hash,
    page: null,
    start: 0,
    end: Array.from(input.text).length,
    quote: input.text,
    origin: "user_answer",
    questionNo: input.questionNo,
  };
}

/** The answers, creator and time of the current intake snapshot row, or null when absent. */
export function readSnapshotAnswerInput(value: unknown, matterId: string, sourceVersion: number): AnswerSourceInput | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as { kind?: unknown; snapshot?: unknown };
  if (row.kind !== "intake.snapshot" || typeof row.snapshot !== "object" || row.snapshot === null) return null;
  const snapshot = row.snapshot as { matterId?: unknown; version?: unknown; answers?: unknown; createdBy?: unknown; createdAt?: unknown };
  if (snapshot.matterId !== matterId || snapshot.version !== sourceVersion) return null;
  if (typeof snapshot.createdBy !== "string" || typeof snapshot.createdAt !== "string") return null;
  return { answers: snapshot.answers, confirmedBy: snapshot.createdBy, confirmedAt: snapshot.createdAt };
}
