/**
 * V6-13 — the five-question intake surface (S03).
 *
 * Mirrors the V6-10/V6-11 split: every rule lives in `intake.ts`; this file only
 * keeps the form the user is editing, loads the persisted view, renders the four
 * S03 states (empty, loading, error, stale) and hands one command at a time to
 * `saveIntake`.
 *
 * Two rules are visible here rather than hidden in a default:
 *
 * - `disclosure` and `maturity` start as an empty select. Nothing in this file
 *   ever derives them from material, from the other answers or from a previous
 *   session; the user must pick.
 * - an answered question always shows its source chooser. The chooser offers
 *   exactly the three S03 sources plus real, located paragraphs from the parsed
 *   material. A stored source that no longer locates its chunk is kept and
 *   marked 「来源已变化」instead of being silently replaced.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import type { Fact, FactConflict, IntakeAnswers, Party, SourceSnapshot } from "../../../../../../packages/contracts/src/matter.ts";
import {
  DISCLOSURE_OPTIONS,
  FACT_KIND_OPTIONS,
  FACT_STATUS_OPTIONS,
  INTAKE_QUESTIONS,
  MATURITY_OPTIONS,
  readIntake,
  saveIntake,
  type IntakeFailure,
  type IntakeQuestionKey,
  type IntakeView,
  type QuestionSource,
  type SaveIntakeInput,
  type SourceSuggestion,
} from "./intake.ts";

export const SOURCE_DIRECT = "direct";
export const SOURCE_NOT_FOUND = "not_found";
export const SOURCE_STORED = "stored";

function sameRef(a: QuestionSource, b: QuestionSource): boolean {
  if (a.kind !== "source" || b.kind !== "source") return a.kind === b.kind;
  return (
    a.ref.sourceId === b.ref.sourceId &&
    a.ref.chunkId === b.ref.chunkId &&
    a.ref.start === b.ref.start &&
    a.ref.end === b.ref.end
  );
}

/** Encode one question's source for its `<select>`. Never guesses. */
export function encodeSourceValue(
  key: IntakeQuestionKey,
  source: QuestionSource | null,
  view: IntakeView,
): string {
  if (source === null) return "";
  if (source.kind === "direct") return SOURCE_DIRECT;
  if (source.kind === "not_found") return SOURCE_NOT_FOUND;
  const suggestions = view.questions.find((question) => question.key === key)?.suggestions ?? [];
  const suggestionIndex = suggestions.findIndex((suggestion) => sameRef({ kind: "source", ref: suggestion.ref }, source));
  if (suggestionIndex >= 0) return `suggest:${suggestionIndex}`;
  const chunk = view.chunks.find((choice) => sameRef({ kind: "source", ref: choice.ref }, source));
  if (chunk) return `chunk:${chunk.chunkId}`;
  return SOURCE_STORED;
}

/** Decode one `<select>` value back into a source; `stored` keeps the old ref. */
export function decodeSourceValue(
  value: string,
  key: IntakeQuestionKey,
  view: IntakeView,
  current: QuestionSource | undefined,
): QuestionSource | undefined {
  if (value === "") return undefined;
  if (value === SOURCE_DIRECT) return { kind: "direct" };
  if (value === SOURCE_NOT_FOUND) return { kind: "not_found" };
  if (value === SOURCE_STORED) return current;
  if (value.startsWith("suggest:")) {
    const index = Number(value.slice("suggest:".length));
    const suggestion = view.questions.find((question) => question.key === key)?.suggestions[index];
    return suggestion ? { kind: "source", ref: suggestion.ref } : current;
  }
  if (value.startsWith("chunk:")) {
    const chunkId = value.slice("chunk:".length);
    const choice = view.chunks.find((candidate) => candidate.chunkId === chunkId);
    return choice ? { kind: "source", ref: choice.ref } : current;
  }
  return current;
}

// ---------------------------------------------------------------------------
// The editable form
// ---------------------------------------------------------------------------

export interface IntakeFormState {
  answers: IntakeAnswers;
  sources: Partial<Record<IntakeQuestionKey, QuestionSource>>;
  parties: Party[];
  facts: Fact[];
  conflicts: FactConflict[];
  newPartyName: string;
  newPartyKind: Party["kind"];
  newFactStatement: string;
  newFactKind: Fact["kind"];
  newFactStatus: Fact["status"];
  newFactChunkId: string;
  newConflictFactIds: string[];
}

export function emptyIntakeForm(): IntakeFormState {
  return {
    answers: {
      problem: "",
      difference: "",
      inventorIds: [],
      disclosure: null,
      maturity: null,
      disclosureDetail: null,
    },
    sources: {},
    parties: [],
    facts: [],
    conflicts: [],
    newPartyName: "",
    newPartyKind: "person",
    newFactStatement: "",
    newFactKind: "problem",
    newFactStatus: "source_backed",
    newFactChunkId: "",
    newConflictFactIds: [],
  };
}

function plainFact(fact: Fact): Fact {
  return {
    id: fact.id,
    statement: fact.statement,
    kind: fact.kind,
    status: fact.status,
    refs: fact.refs,
    confirmedBy: fact.confirmedBy,
    confirmedAt: fact.confirmedAt,
  };
}

function plainConflict(conflict: FactConflict): FactConflict {
  return {
    id: conflict.id,
    factIds: [...conflict.factIds],
    state: conflict.state,
    chosenFactIds: [...conflict.chosenFactIds],
    reason: conflict.reason,
  };
}

/** Seed the form from the persisted view; unanswered questions stay unanswered. */
export function formFromView(view: IntakeView): IntakeFormState {
  const sources: Partial<Record<IntakeQuestionKey, QuestionSource>> = {};
  for (const question of view.questions) {
    if (question.source !== null) sources[question.key] = question.source;
  }
  return {
    ...emptyIntakeForm(),
    answers: {
      problem: view.answers.problem,
      difference: view.answers.difference,
      inventorIds: [...view.answers.inventorIds],
      disclosure: view.answers.disclosure,
      maturity: view.answers.maturity,
      disclosureDetail: view.answers.disclosureDetail,
    },
    sources,
    parties: view.parties.map((party) => ({ ...party, roles: [...party.roles] })),
    facts: view.facts.map(plainFact),
    conflicts: view.conflicts.map(plainConflict),
  };
}

export type IntakeFormAction =
  | { type: "reset"; form: IntakeFormState }
  | { type: "text"; key: "problem" | "difference"; value: string }
  | { type: "choice"; key: "disclosure" | "maturity"; value: string }
  | { type: "source"; key: IntakeQuestionKey; source: QuestionSource | undefined }
  | { type: "inventor"; partyId: string; checked: boolean }
  | { type: "party-name"; value: string }
  | { type: "party-kind"; value: Party["kind"] }
  | { type: "add-party"; party: Party }
  | { type: "remove-party"; partyId: string }
  | { type: "fact-statement"; value: string }
  | { type: "fact-kind"; value: Fact["kind"] }
  | { type: "fact-status"; value: Fact["status"] }
  | { type: "fact-chunk"; value: string }
  | { type: "add-fact"; fact: Fact }
  | { type: "remove-fact"; factId: string }
  | { type: "conflict-new-fact"; factId: string; checked: boolean }
  | { type: "add-conflict"; conflict: FactConflict }
  | { type: "conflict-state"; conflictId: string; state: FactConflict["state"] }
  | { type: "conflict-chosen"; conflictId: string; factId: string; checked: boolean }
  | { type: "conflict-reason"; conflictId: string; reason: string }
  | { type: "remove-conflict"; conflictId: string }
  | { type: "detail-occurred-on"; value: string }
  | { type: "detail-audience"; value: string }
  | { type: "detail-confidentiality"; value: "yes" | "no" | "unknown" }
  | { type: "detail-remove-evidence"; index: number }
  | { type: "detail-clear" };

function withDetail(form: IntakeFormState, patch: Partial<NonNullable<IntakeAnswers["disclosureDetail"]>>): IntakeFormState {
  const detail = form.answers.disclosureDetail ?? {
    occurredOn: null,
    audience: "",
    confidentiality: "unknown" as const,
    evidenceRefs: [],
  };
  return {
    ...form,
    answers: { ...form.answers, disclosureDetail: { ...detail, ...patch } },
  };
}

export function intakeFormReducer(state: IntakeFormState, action: IntakeFormAction): IntakeFormState {
  switch (action.type) {
    case "reset":
      return action.form;
    case "text":
      return { ...state, answers: { ...state.answers, [action.key]: action.value } };
    case "choice": {
      if (action.key === "disclosure") {
        const disclosure = action.value === "" ? null : (action.value as IntakeAnswers["disclosure"]);
        return { ...state, answers: { ...state.answers, disclosure } };
      }
      const maturity = action.value === "" ? null : (action.value as IntakeAnswers["maturity"]);
      return { ...state, answers: { ...state.answers, maturity } };
    }
    case "source": {
      const sources = { ...state.sources };
      if (action.source === undefined) delete sources[action.key];
      else sources[action.key] = action.source;
      return { ...state, sources };
    }
    case "inventor": {
      const known = new Set(state.answers.inventorIds);
      if (action.checked) known.add(action.partyId);
      else known.delete(action.partyId);
      return { ...state, answers: { ...state.answers, inventorIds: [...known] } };
    }
    case "party-name":
      return { ...state, newPartyName: action.value };
    case "party-kind":
      return { ...state, newPartyKind: action.value };
    case "add-party":
      return {
        ...state,
        parties: [...state.parties, action.party],
        newPartyName: "",
      };
    case "remove-party":
      return {
        ...state,
        parties: state.parties.filter((party) => party.id !== action.partyId),
        answers: {
          ...state.answers,
          inventorIds: state.answers.inventorIds.filter((id) => id !== action.partyId),
        },
      };
    case "fact-statement":
      return { ...state, newFactStatement: action.value };
    case "fact-kind":
      return { ...state, newFactKind: action.value };
    case "fact-status":
      return { ...state, newFactStatus: action.value };
    case "fact-chunk":
      return { ...state, newFactChunkId: action.value };
    case "add-fact":
      return {
        ...state,
        facts: [...state.facts, action.fact],
        newFactStatement: "",
        newFactChunkId: "",
      };
    case "remove-fact":
      return {
        ...state,
        facts: state.facts.filter((fact) => fact.id !== action.factId),
        conflicts: state.conflicts.filter((conflict) => !conflict.factIds.includes(action.factId)),
        newConflictFactIds: state.newConflictFactIds.filter((id) => id !== action.factId),
      };
    case "conflict-new-fact": {
      const known = new Set(state.newConflictFactIds);
      if (action.checked) known.add(action.factId);
      else known.delete(action.factId);
      return { ...state, newConflictFactIds: [...known] };
    }
    case "add-conflict":
      return {
        ...state,
        conflicts: [...state.conflicts, action.conflict],
        newConflictFactIds: [],
      };
    case "conflict-state":
      return {
        ...state,
        conflicts: state.conflicts.map((conflict) =>
          conflict.id === action.conflictId
            ? {
                ...conflict,
                state: action.state,
                chosenFactIds: action.state === "resolved" ? conflict.chosenFactIds : [],
                reason: action.state === "retained" ? (conflict.reason ?? "") : null,
              }
            : conflict,
        ),
      };
    case "conflict-chosen":
      return {
        ...state,
        conflicts: state.conflicts.map((conflict) => {
          if (conflict.id !== action.conflictId) return conflict;
          const chosen = new Set(conflict.chosenFactIds);
          if (action.checked) chosen.add(action.factId);
          else chosen.delete(action.factId);
          return { ...conflict, chosenFactIds: [...chosen] };
        }),
      };
    case "conflict-reason":
      return {
        ...state,
        conflicts: state.conflicts.map((conflict) =>
          conflict.id === action.conflictId ? { ...conflict, reason: action.reason } : conflict,
        ),
      };
    case "remove-conflict":
      return { ...state, conflicts: state.conflicts.filter((conflict) => conflict.id !== action.conflictId) };
    case "detail-occurred-on":
      return withDetail(state, { occurredOn: action.value === "" ? null : action.value });
    case "detail-audience":
      return withDetail(state, { audience: action.value });
    case "detail-confidentiality":
      return withDetail(state, { confidentiality: action.value });
    case "detail-remove-evidence": {
      const detail = state.answers.disclosureDetail;
      if (!detail) return state;
      return withDetail(state, { evidenceRefs: detail.evidenceRefs.filter((_, index) => index !== action.index) });
    }
    case "detail-clear":
      return { ...state, answers: { ...state.answers, disclosureDetail: null } };
  }
}

/** The command `saveIntake` receives; only values the user actually sees. */
export function draftToSaveInput(form: IntakeFormState, baseSourceVersion: number): SaveIntakeInput {
  return {
    baseSourceVersion,
    answers: form.answers,
    questionSources: form.sources,
    facts: form.facts.map(plainFact),
    conflicts: form.conflicts.map(plainConflict),
    parties: form.parties,
  };
}

// ---------------------------------------------------------------------------
// Loaded state
// ---------------------------------------------------------------------------

type LoadPhase =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "failed"; message: string };

export type IntakeSaveStatus =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "saved"; message: string }
  | { phase: "failed"; failure: IntakeFailure };

export interface IntakeProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function Intake({ repository, actor, matterId }: IntakeProps) {
  const [form, dispatch] = useReducer(intakeFormReducer, undefined, emptyIntakeForm);
  const [view, setView] = useState<IntakeView | null>(null);
  const [load, setLoad] = useState<LoadPhase>({ phase: "loading" });
  const [status, setStatus] = useState<IntakeSaveStatus>({ phase: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const requestKey = useRef<string | null>(null);
  // Set when the matter version was committed but its snapshot was not: the
  // next save must build on that version to fill the snapshot in.
  const recoveryBase = useRef<number | null>(null);

  const refresh = useCallback(async (options: { resetForm?: boolean } = {}) => {
    const current = ++generation.current;
    const outcome = await readIntake(repository, actor, matterId);
    if (current !== generation.current) return;
    if (outcome.ok) {
      setView(outcome.view);
      if (options.resetForm !== false) dispatch({ type: "reset", form: formFromView(outcome.view) });
      setLoad({ phase: "ready" });
    } else {
      setLoad({ phase: "failed", message: outcome.message });
    }
  }, [repository, actor, matterId]);

  useEffect(() => {
    setLoad({ phase: "loading" });
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh, attempt]);

  // Any edit means the next save is a new request, never the previous one.
  const onForm = useCallback((action: IntakeFormAction) => {
    requestKey.current = null;
    dispatch(action);
  }, []);

  const onAddParty = useCallback(() => {
    if (form.newPartyName.trim().length === 0) return;
    onForm({
      type: "add-party",
      party: {
        id: newId(),
        kind: form.newPartyKind,
        name: form.newPartyName.trim(),
        roles: [],
        country: null,
      },
    });
  }, [form.newPartyKind, form.newPartyName, onForm]);

  const onAddFact = useCallback(() => {
    if (form.newFactStatement.trim().length === 0) return;
    const chunk = view?.chunks.find((choice) => choice.chunkId === form.newFactChunkId);
    onForm({
      type: "add-fact",
      fact: {
        id: newId(),
        statement: form.newFactStatement.trim(),
        kind: form.newFactKind,
        status: form.newFactStatus,
        refs: chunk ? [chunk.ref] : [],
        confirmedBy: null,
        confirmedAt: null,
      },
    });
  }, [form.newFactChunkId, form.newFactKind, form.newFactStatement, form.newFactStatus, onForm, view]);

  const onAddConflict = useCallback(() => {
    if (form.newConflictFactIds.length < 2) return;
    onForm({
      type: "add-conflict",
      conflict: {
        id: newId(),
        factIds: [...form.newConflictFactIds],
        state: "open",
        chosenFactIds: [],
        reason: null,
      },
    });
  }, [form.newConflictFactIds, onForm]);

  const onSave = useCallback(async () => {
    if (view === null || busy) return;
    const key = requestKey.current ?? newId();
    requestKey.current = key;
    setBusy(true);
    setStatus({ phase: "saving" });
    try {
      const base = recoveryBase.current ?? view.sourceVersion;
      const outcome = await saveIntake(repository, actor, matterId, draftToSaveInput(form, base), {
        requestKey: key,
      });
      if (outcome.ok) {
        requestKey.current = null;
        recoveryBase.current = null;
        setStatus({
          phase: "saved",
          message: outcome.unchanged
            ? "没有变化，未写入新版本。"
            : outcome.replayed
              ? `已重放第 ${outcome.version} 版，没有重复写入。`
              : `已保存为第 ${outcome.version} 版。`,
        });
        await refresh();
        return;
      }
      if (outcome.committedVersion !== undefined) {
        // The version exists without its snapshot. Replaying the old request
        // would hit a version conflict, so the next save is a new request on
        // top of the committed version.
        recoveryBase.current = outcome.committedVersion;
        requestKey.current = null;
      } else if (outcome.errorCode !== "STORAGE_UNAVAILABLE") {
        // A storage failure before the commit keeps the key so a retry is the
        // same request. Every other failure needs a fresh request.
        requestKey.current = null;
      }
      setStatus({ phase: "failed", failure: outcome });
    } finally {
      setBusy(false);
    }
  }, [actor, busy, form, matterId, refresh, repository, view]);

  const onReloadLatest = useCallback(() => {
    // The reload reads the committed version (recovering if its snapshot is
    // missing), so the next save builds on that view, not on an older base.
    requestKey.current = null;
    recoveryBase.current = null;
    setStatus({ phase: "idle" });
    setAttempt((value) => value + 1);
  }, []);

  const onKeepMine = useCallback(async () => {
    // Keep the edited form and move its base to the latest committed version:
    // the next save writes the user's version on top of it. Only the view
    // (chunks, staleness, sourceVersion) is refreshed, never the form.
    requestKey.current = null;
    recoveryBase.current = null;
    setStatus({ phase: "idle" });
    await refresh({ resetForm: false });
  }, [refresh]);

  return (
    <IntakePanel
      load={load}
      view={view}
      form={form}
      busy={busy}
      status={status}
      onForm={onForm}
      onSave={onSave}
      onRetryLoad={onReloadLatest}
      onReloadLatest={onReloadLatest}
      onKeepMine={onKeepMine}
      onAddParty={onAddParty}
      onAddFact={onAddFact}
      onAddConflict={onAddConflict}
    />
  );
}

// ---------------------------------------------------------------------------
// Pure markup
// ---------------------------------------------------------------------------

export interface IntakePanelProps {
  load: LoadPhase;
  view: IntakeView | null;
  form: IntakeFormState;
  busy: boolean;
  status: IntakeSaveStatus;
  onForm: (action: IntakeFormAction) => void;
  onSave: () => void;
  onRetryLoad: () => void;
  onReloadLatest: () => void;
  onKeepMine: () => void;
  onAddParty: () => void;
  onAddFact: () => void;
  onAddConflict: () => void;
}

export function IntakePanel({
  load,
  view,
  form,
  busy,
  status,
  onForm,
  onSave,
  onRetryLoad,
  onReloadLatest,
  onKeepMine,
  onAddParty,
  onAddFact,
  onAddConflict,
}: IntakePanelProps) {
  if (load.phase === "loading") {
    return (
      <section className="card" data-testid="intake" data-state="loading" aria-busy="true">
        <h2 className="card-title" id="intake-title">
          五题与事实
        </h2>
        <p className="muted" data-testid="intake-loading">
          正在读取本机保存的答案…
        </p>
      </section>
    );
  }
  if (load.phase === "failed" || view === null) {
    return (
      <section className="card" data-testid="intake" data-state="error" aria-labelledby="intake-title">
        <h2 className="card-title" id="intake-title">
          五题与事实
        </h2>
        <div className="notice" role="alert" data-testid="intake-error" style={STACKED_NOTICE}>
          <strong>答案没有显示</strong>
          <p>{load.phase === "failed" ? load.message : "案件不可用。"}</p>
          <button type="button" className="btn btn-outline btn-sm" data-testid="intake-retry-load" onClick={onRetryLoad}>
            重试
          </button>
        </div>
      </section>
    );
  }

  const answered = view.questions.filter((question) => question.answered).length;
  const staleFacts = view.facts.filter((fact) => fact.sourceChanged);
  const staleDrafts = view.drafts.filter((draft) => draft.stale);
  const factIds = new Set(form.facts.map((fact) => fact.id));

  return (
    <section
      className="card"
      data-testid="intake"
      data-state={view.state}
      data-version={view.sourceVersion}
      aria-labelledby="intake-title"
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 className="card-title" id="intake-title">
          五题与事实
        </h2>
        <p className="muted">
          每个答案都会连同来源和当时的事实版本一起保存。公开历史和成熟度只能由你选择，不会自动填写。
        </p>
        <p className="field-hint" data-testid="intake-completeness">
          已填写 {answered}/5
          {view.missing.length > 0
            ? ` · 待补：${view.missing
                .map((key) => INTAKE_QUESTIONS.find((question) => question.key === key)?.label ?? key)
                .join("、")}`
            : " · 五题齐全"}
        </p>
        <p className="field-hint" data-testid="intake-snapshot-version">
          当前事实版本：第 {view.sourceVersion} 版
          {view.hasSnapshot ? "" : view.recovery ? "（这一版的答案快照缺失）" : "（还没有保存过答案）"}
        </p>
      </header>

      {view.recovery ? (
        <div className="notice" role="alert" data-testid="intake-recovery" style={STACKED_NOTICE}>
          <strong>第 {view.recovery.missingVersion} 版事实已记录，但这一版的答案快照没有写入本机。</strong>
          <p>
            {view.recovery.recoveredFromVersion !== null
              ? `下面显示的是第 ${view.recovery.recoveredFromVersion} 版保存的内容，可能比第 ${view.recovery.missingVersion} 版旧。`
              : "没有更早的答案快照可以显示，下面是空白表单。"}
            请核对后保存：会以第 {view.recovery.missingVersion} 版为基础写入新版本和完整快照。
          </p>
        </div>
      ) : null}

      {view.state === "empty" ? (
        <div className="notice" data-testid="intake-empty">
          <span className="ic" aria-hidden="true">
            ·
          </span>
          <span>还没有保存过答案。可以先答一题、标注来源，保存后再继续；不会补写你没有填的内容。</span>
        </div>
      ) : null}

      {view.state === "stale" ? (
        <div className="notice" role="alert" data-testid="intake-stale-notice" style={STACKED_NOTICE}>
          <strong>有内容需要复核</strong>
          <p>
            {staleFacts.length > 0
              ? `有 ${staleFacts.length} 条事实的来源已变化，请重新选择来源。`
              : staleDrafts.length > 0
                ? "有草稿基于旧的事实版本生成，需要重新生成。"
                : "有答案的来源或公开证据已变化，请重新选择来源。"}
          </p>
          {staleDrafts.length > 0 ? (
            <p>{`草稿：${staleDrafts.map((draft) => draft.label).join("、")} 已过期。`}</p>
          ) : null}
        </div>
      ) : null}

      <details className="intake-questions" data-testid="intake-questions-details">
        <summary className="section-h">补充信息（五题）<span className="sh-r">{view.questions.filter((item) => item.answered).length}/{view.questions.length} 已回答</span></summary>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {INTAKE_QUESTIONS.map((definition, index) => {
          const question = view.questions.find((item) => item.key === definition.key);
          if (!question) return null;
          return (
            <li key={definition.key}>
              <fieldset
                data-testid={`intake-question-${definition.key}`}
                data-answered={question.answered ? "true" : "false"}
                style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-s)", padding: 12 }}
              >
                <legend className="field-label">
                  {index + 1}. {definition.label}
                </legend>
                <p className="field-hint">{definition.prompt}</p>

                {definition.key === "problem" || definition.key === "difference" ? (
                  <textarea
                    className="textarea"
                    data-testid={`intake-answer-${definition.key}`}
                    value={form.answers[definition.key]}
                    maxLength={definition.maxLength ?? undefined}
                    onChange={(event) =>
                      onForm({ type: "text", key: definition.key as "problem" | "difference", value: event.currentTarget.value })
                    }
                  />
                ) : null}

                {definition.key === "disclosure" || definition.key === "maturity" ? (
                  <>
                    <select
                      className="select"
                      data-testid={`intake-answer-${definition.key}`}
                      value={form.answers[definition.key] ?? ""}
                      onChange={(event) =>
                        onForm({
                          type: "choice",
                          key: definition.key as "disclosure" | "maturity",
                          value: event.currentTarget.value,
                        })
                      }
                    >
                      <option value="">请选择（不会自动填写）</option>
                      {(definition.key === "disclosure" ? DISCLOSURE_OPTIONS : MATURITY_OPTIONS).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {form.answers[definition.key] === null ? (
                      <p className="field-hint" data-testid={`intake-choice-unset-${definition.key}`}>
                        尚未选择；保存后也会保持未选择。
                      </p>
                    ) : null}
                  </>
                ) : null}

                {definition.key === "inventorIds" ? (
                  <div data-testid="intake-inventors">
                    {form.parties.length === 0 ? (
                      <p className="field-hint">还没有添加人员；先在下方添加，再勾选发明人。</p>
                    ) : (
                      form.parties.map((party) => (
                        <label key={party.id} className="row" data-testid={`intake-inventor-row-${party.id}`}>
                          <input
                            type="checkbox"
                            data-testid={`intake-inventor-${party.id}`}
                            checked={form.answers.inventorIds.includes(party.id)}
                            onChange={(event) =>
                              onForm({ type: "inventor", partyId: party.id, checked: event.currentTarget.checked })
                            }
                          />
                          <span>
                            {party.name}
                            {party.kind === "organization" ? "（组织，不能作为发明人）" : ""}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                ) : null}

                {definition.key === "disclosure" && form.answers.disclosure !== null ? (
                  <div data-testid="intake-disclosure-detail" style={{ display: "grid", gap: 6 }}>
                    <span className="field-label">公开细节（可选）</span>
                    <input
                      className="input"
                      type="date"
                      data-testid="intake-disclosure-date"
                      value={form.answers.disclosureDetail?.occurredOn ?? ""}
                      onChange={(event) => onForm({ type: "detail-occurred-on", value: event.currentTarget.value })}
                    />
                    <input
                      className="input"
                      type="text"
                      placeholder="给谁看过、在哪里"
                      data-testid="intake-disclosure-audience"
                      value={form.answers.disclosureDetail?.audience ?? ""}
                      onChange={(event) => onForm({ type: "detail-audience", value: event.currentTarget.value })}
                    />
                    <select
                      className="select"
                      data-testid="intake-disclosure-confidentiality"
                      value={form.answers.disclosureDetail?.confidentiality ?? ""}
                      onChange={(event) =>
                        onForm({
                          type: "detail-confidentiality",
                          value: event.currentTarget.value as "yes" | "no" | "unknown",
                        })
                      }
                    >
                      <option value="">保密约定：未填写</option>
                      <option value="yes">有保密约定</option>
                      <option value="no">没有保密约定</option>
                      <option value="unknown">不确定</option>
                    </select>
                    {(form.answers.disclosureDetail?.evidenceRefs ?? []).length > 0 ? (
                      <ul data-testid="intake-evidence" style={{ margin: 0, paddingLeft: 18 }}>
                        {(form.answers.disclosureDetail?.evidenceRefs ?? []).map((ref, position) => {
                          const stored = view.answers.disclosureDetail?.evidenceRefs[position];
                          const changed =
                            stored !== undefined &&
                            JSON.stringify(stored) === JSON.stringify(ref) &&
                            question.evidenceChanged[position] === true;
                          return (
                            <li
                              key={`${ref.chunkId}-${position}`}
                              data-testid={`intake-evidence-${position}`}
                              data-source-changed={changed ? "true" : "false"}
                            >
                              <span>「{ref.quote}」</span>
                              {changed ? (
                                <span className="badge badge-err" data-testid={`intake-evidence-changed-${position}`}>
                                  来源已变化，请移除或重新引用
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                data-testid={`intake-evidence-remove-${position}`}
                                onClick={() => onForm({ type: "detail-remove-evidence", index: position })}
                              >
                                移除
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    {form.answers.disclosureDetail !== null ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onForm({ type: "detail-clear" })}>
                        清除公开细节
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <label className="field-label" style={{ marginTop: 8, display: "block" }}>
                  这道题的来源
                  <select
                    className="select"
                    data-testid={`intake-source-${definition.key}`}
                    value={encodeSourceValue(definition.key, form.sources[definition.key] ?? null, view)}
                    onChange={(event) =>
                      onForm({
                        type: "source",
                        key: definition.key,
                        source: decodeSourceValue(
                          event.currentTarget.value,
                          definition.key,
                          view,
                          form.sources[definition.key],
                        ),
                      })
                    }
                  >
                    <option value="">请选择来源</option>
                    {form.sources[definition.key]?.kind === "source" &&
                    encodeSourceValue(definition.key, form.sources[definition.key] ?? null, view) === SOURCE_STORED ? (
                      <option value={SOURCE_STORED}>已保存的来源</option>
                    ) : null}
                    <option value={SOURCE_NOT_FOUND}>材料中未找到</option>
                    <option value={SOURCE_DIRECT}>用户直接回答</option>
                    {question.suggestions.map((suggestion, index) => (
                      <option key={`suggest-${suggestion.chunkId}`} value={`suggest:${index}`}>
                        {suggestionLabel(suggestion)}
                      </option>
                    ))}
                    {view.chunks.slice(0, 50).map((choice) => (
                      <option key={`chunk-${choice.chunkId}`} value={`chunk:${choice.chunkId}`}>
                        {`${choice.sourceName}${choice.page === null ? "" : ` 第 ${choice.page} 页`}：${truncate(choice.text, 48)}`}
                      </option>
                    ))}
                  </select>
                </label>

                {question.sourceChanged ? (
                  <p className="field-hint" data-testid={`intake-source-changed-${definition.key}`}>
                    来源已变化，请重新选择来源后再保存。
                  </p>
                ) : null}
                {form.sources[definition.key]?.kind === "source" && !question.sourceChanged ? (
                  <blockquote
                    className="muted"
                    data-testid={`intake-source-quote-${definition.key}`}
                    style={{ margin: "6px 0 0", paddingLeft: 10, borderLeft: "2px solid var(--line)" }}
                  >
                    {truncate((form.sources[definition.key] as { kind: "source"; ref: { quote: string } }).ref.quote, 160)}
                  </blockquote>
                ) : null}
                {question.savedAt !== null ? (
                  <p className="field-hint" data-testid={`intake-provenance-${definition.key}`}>
                    来源记录于第 {question.basedOnVersion ?? "?"} 版事实 · {question.savedAt.slice(0, 10)}
                  </p>
                ) : null}
                {question.answered && form.sources[definition.key] === undefined ? (
                  <p className="field-hint" data-testid={`intake-source-missing-${definition.key}`}>
                    保存前需要标明来源。
                  </p>
                ) : null}
              </fieldset>
            </li>
          );
        })}
      </ol>
      </details>

      <section data-testid="intake-parties" style={{ display: "grid", gap: 8 }}>
        <h3 className="card-title">人员</h3>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {form.parties.map((party) => (
            <li key={party.id} className="row" data-testid={`intake-party-${party.id}`}>
              <span>
                {party.name}（{party.kind === "person" ? "自然人" : "组织"}）
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                data-testid={`intake-party-remove-${party.id}`}
                onClick={() => onForm({ type: "remove-party", partyId: party.id })}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input
            className="input"
            type="text"
            placeholder="姓名或名称"
            data-testid="intake-party-name"
            value={form.newPartyName}
            onChange={(event) => onForm({ type: "party-name", value: event.currentTarget.value })}
          />
          <select
            className="select"
            data-testid="intake-party-kind"
            value={form.newPartyKind}
            onChange={(event) => onForm({ type: "party-kind", value: event.currentTarget.value as Party["kind"] })}
          >
            <option value="person">自然人</option>
            <option value="organization">组织</option>
          </select>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            data-testid="intake-party-add"
            disabled={form.newPartyName.trim().length === 0}
            onClick={onAddParty}
          >
            添加人员
          </button>
        </div>
      </section>

      <section data-testid="intake-facts" style={{ display: "grid", gap: 8 }}>
        <h3 className="card-title">事实</h3>
        {form.facts.length === 0 ? <p className="field-hint">还没有事实记录。</p> : null}
        <ul className="factsgrp" data-testid="intake-fact-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {form.facts.map((fact, factIndex) => {
            const factView = view.facts.find((item) => item.id === fact.id);
            return (
              <li
                key={fact.id}
                className="fact"
                data-testid={`intake-fact-${fact.id}`}
                data-source-changed={factView?.sourceChanged ? "true" : "false"}
              >
                <span className="f-id">F-{String(factIndex + 1).padStart(2, "0")}</span>
                <div className="f-b">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span className="f-t">{fact.statement}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    data-testid={`intake-fact-remove-${fact.id}`}
                    onClick={() => onForm({ type: "remove-fact", factId: fact.id })}
                  >
                    移除
                  </button>
                </div>
                <p className="f-s">
                  {labelOf(FACT_KIND_OPTIONS, fact.kind)} · {labelOf(FACT_STATUS_OPTIONS, fact.status)}
                  {fact.refs.length > 0 ? ` · ${fact.refs.length} 段材料` : " · 无材料引用"}
                </p>
                {fact.refs.map((ref, index) => (
                  <blockquote
                    key={`${fact.id}-${index}`}
                    className="muted"
                    style={{ margin: "4px 0", paddingLeft: 10, borderLeft: "2px solid var(--line)" }}
                  >
                    {truncate(ref.quote, 160)}
                  </blockquote>
                ))}
                {factView?.sourceChanged ? (
                  <span className="badge badge-err">来源已变化</span>
                ) : null}
                {factView && factView.conflictIds.length > 0 ? (
                  <span className="field-hint"> · 属于 {factView.conflictIds.length} 个冲突</span>
                ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        <div style={{ display: "grid", gap: 6 }} data-testid="intake-fact-new">
          <input
            className="input"
            type="text"
            placeholder="一条可核对的事实"
            data-testid="intake-fact-statement"
            value={form.newFactStatement}
            onChange={(event) => onForm({ type: "fact-statement", value: event.currentTarget.value })}
          />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <select
              className="select"
              data-testid="intake-fact-kind"
              value={form.newFactKind}
              onChange={(event) => onForm({ type: "fact-kind", value: event.currentTarget.value as Fact["kind"] })}
            >
              {FACT_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="select"
              data-testid="intake-fact-status"
              value={form.newFactStatus}
              onChange={(event) => onForm({ type: "fact-status", value: event.currentTarget.value as Fact["status"] })}
            >
              {FACT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="select"
              data-testid="intake-fact-chunk"
              value={form.newFactChunkId}
              onChange={(event) => onForm({ type: "fact-chunk", value: event.currentTarget.value })}
            >
              <option value="">不引用材料段落</option>
              {view.chunks.slice(0, 50).map((choice) => (
                <option key={choice.chunkId} value={choice.chunkId}>
                  {`${choice.sourceName}${choice.page === null ? "" : ` 第 ${choice.page} 页`}：${truncate(choice.text, 40)}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              data-testid="intake-fact-add"
              disabled={form.newFactStatement.trim().length === 0}
              onClick={onAddFact}
            >
              添加事实
            </button>
          </div>
        </div>
      </section>

      <section data-testid="intake-conflicts" style={{ display: "grid", gap: 8 }}>
        <h3 className="card-title">冲突</h3>
        {form.conflicts.length === 0 ? <p className="field-hint">还没有冲突记录。</p> : null}
        <ul data-testid="intake-conflict-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {form.conflicts.map((conflict) => {
            const viewConflict = view.conflicts.find((item) => item.id === conflict.id);
            const statements = (viewConflict?.facts ?? conflict.factIds.map((id) => {
              const fact = form.facts.find((item) => item.id === id);
              return { id, statement: fact?.statement ?? "（事实已移除）" };
            }));
            return (
              <li
                key={conflict.id}
                className="conflictbox"
                data-testid={`intake-conflict-${conflict.id}`}
                data-state={conflict.state}
                data-fact-ids={conflict.factIds.join(",")}
              >
                <div className="cb-t">冲突 · {conflict.state === "open" ? "待处理" : conflict.state === "resolved" ? "已选择" : "保留冲突"}</div>
                <div className="cb-d">
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                  {statements.map((entry) => (
                    <li key={entry.id} data-testid={`intake-conflict-statement-${conflict.id}-${entry.id}`}>
                      · {entry.statement}
                    </li>
                  ))}
                </ul>
                <div className="row" style={{ flexWrap: "wrap", marginTop: 6 }}>
                  <select
                    className="select"
                    data-testid={`intake-conflict-state-${conflict.id}`}
                    value={conflict.state}
                    onChange={(event) =>
                      onForm({
                        type: "conflict-state",
                        conflictId: conflict.id,
                        state: event.currentTarget.value as FactConflict["state"],
                      })
                    }
                  >
                    <option value="open">暂不处理</option>
                    <option value="resolved">选择一方或多方</option>
                    <option value="retained">保留冲突</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    data-testid={`intake-conflict-remove-${conflict.id}`}
                    onClick={() => onForm({ type: "remove-conflict", conflictId: conflict.id })}
                  >
                    移除冲突
                  </button>
                </div>
                {conflict.state === "resolved" ? (
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    {conflict.factIds.map((factId) => (
                      <label key={factId} className="row">
                        <input
                          type="checkbox"
                          data-testid={`intake-conflict-chosen-${conflict.id}-${factId}`}
                          checked={conflict.chosenFactIds.includes(factId)}
                          onChange={(event) =>
                            onForm({
                              type: "conflict-chosen",
                              conflictId: conflict.id,
                              factId,
                              checked: event.currentTarget.checked,
                            })
                          }
                        />
                        <span className="field-hint">采用</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                {conflict.state === "retained" ? (
                  <input
                    className="input"
                    type="text"
                    placeholder="保留冲突的理由（必填）"
                    data-testid={`intake-conflict-reason-${conflict.id}`}
                    value={conflict.reason ?? ""}
                    onChange={(event) =>
                      onForm({ type: "conflict-reason", conflictId: conflict.id, reason: event.currentTarget.value })
                    }
                  />
                ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-start" }} data-testid="intake-conflict-new">
          {form.facts.map((fact) => (
            <label key={fact.id} className="row" data-testid={`intake-conflict-new-${fact.id}`}>
              <input
                type="checkbox"
                data-testid={`intake-conflict-new-check-${fact.id}`}
                checked={form.newConflictFactIds.includes(fact.id)}
                onChange={(event) =>
                  onForm({ type: "conflict-new-fact", factId: fact.id, checked: event.currentTarget.checked })
                }
              />
              <span className="field-hint">{truncate(fact.statement, 24)}</span>
            </label>
          ))}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            data-testid="intake-conflict-add"
            disabled={form.newConflictFactIds.length < 2 || form.newConflictFactIds.some((id) => !factIds.has(id))}
            onClick={onAddConflict}
          >
            记录冲突（至少两条事实）
          </button>
        </div>
      </section>

      {view.drafts.length > 0 ? (
        <section data-testid="intake-drafts" style={{ display: "grid", gap: 6 }}>
          <h3 className="card-title">基于事实生成的草稿</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {view.drafts.map((draft) => (
              <li
                key={draft.targetId}
                className="row"
                data-testid={`intake-draft-${draft.targetId}`}
                data-stale={draft.stale ? "true" : "false"}
              >
                <span>
                  {draft.label}：第 {draft.inputSourceVersion} 版事实
                </span>
                <span className={draft.stale ? "badge badge-err" : "badge badge-ok"}>
                  {draft.targetMissing ? "目标已删除" : draft.stale ? "事实已变化，需重新生成" : "与当前事实一致"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {status.phase === "failed" ? (
        <div className="notice" role="alert" data-testid="intake-save-error" data-code={status.failure.errorCode} style={STACKED_NOTICE}>
          <strong>{status.failure.message}</strong>
          {status.failure.committedVersion !== undefined ? (
            <p data-testid="intake-committed-version">
              页面上的内容仍然保留；刷新后也可以在第 {status.failure.committedVersion} 版上继续保存。
            </p>
          ) : null}
          {status.failure.fields && status.failure.fields.length > 0 ? (
            <ul data-testid="intake-field-errors">
              {status.failure.fields.map((field, index) => (
                <li key={`${field.path}-${index}`} data-path={field.path}>
                  {field.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {status.phase === "failed" && status.failure.errorCode === "VERSION_CONFLICT" ? (
        <VersionConflictPanel
          failure={status.failure}
          form={form}
          baseVersion={view.sourceVersion}
          onReloadLatest={onReloadLatest}
          onKeepMine={onKeepMine}
          busy={busy}
        />
      ) : null}

      {status.phase === "saved" ? (
        <p className="field-hint" role="status" aria-live="polite" data-testid="intake-save-status">
          {status.message}
        </p>
      ) : null}

      <div className="row">
        <button
          type="button"
          className="btn btn-default"
          data-testid="intake-save"
          disabled={busy || status.phase === "saving"}
          onClick={onSave}
        >
          {busy ? "正在保存…" : "保存答案与事实"}
        </button>
      </div>
    </section>
  );
}

function VersionConflictPanel({
  failure,
  form,
  baseVersion,
  onReloadLatest,
  onKeepMine,
  busy,
}: {
  failure: IntakeFailure;
  form: IntakeFormState;
  baseVersion: number;
  onReloadLatest: () => void;
  onKeepMine: () => void;
  busy: boolean;
}) {
  const latest: SourceSnapshot | null = failure.latest ?? null;
  return (
    <div className="notice" role="alert" data-testid="intake-version-conflict" style={STACKED_NOTICE}>
      <strong>其他窗口已保存了更新的版本</strong>
      <p>
        你编辑时基于第 {baseVersion} 版；最新是第 {failure.latestVersion ?? "?"} 版。请对照下面的两列内容合并。
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }} data-testid="intake-merge">
        <div data-testid="intake-merge-mine">
          <h4 className="card-title">你正在编辑的内容</h4>
          <dl className="kv" style={MERGE_LIST}>
            <dt>问题</dt>
            <dd>{form.answers.problem.trim() === "" ? "（空）" : truncate(form.answers.problem, 120)}</dd>
            <dt>区别</dt>
            <dd>{form.answers.difference.trim() === "" ? "（空）" : truncate(form.answers.difference, 120)}</dd>
            <dt>公开历史</dt>
            <dd>{choiceLabel(DISCLOSURE_OPTIONS, form.answers.disclosure)}</dd>
            <dt>成熟度</dt>
            <dd>{choiceLabel(MATURITY_OPTIONS, form.answers.maturity)}</dd>
            <dt>事实</dt>
            <dd>{form.facts.length} 条</dd>
            <dt>冲突</dt>
            <dd>{form.conflicts.length} 个</dd>
          </dl>
        </div>
        <div data-testid="intake-merge-latest">
          <h4 className="card-title">最新版本（第 {failure.latestVersion ?? "?"} 版）</h4>
          {latest !== null && latest.version !== failure.latestVersion ? (
            <p className="field-hint" data-testid="intake-merge-latest-older">
              第 {failure.latestVersion} 版的答案快照没有写入本机；下面是第 {latest.version} 版保存的内容。
            </p>
          ) : null}
          {latest === null ? (
            <p className="field-hint">最新版本的答案无法读取；请重新加载。</p>
          ) : (
            <dl className="kv" style={MERGE_LIST}>
              <dt>问题</dt>
              <dd>{latest.answers.problem.trim() === "" ? "（空）" : truncate(latest.answers.problem, 120)}</dd>
              <dt>区别</dt>
              <dd>{latest.answers.difference.trim() === "" ? "（空）" : truncate(latest.answers.difference, 120)}</dd>
              <dt>公开历史</dt>
              <dd>{choiceLabel(DISCLOSURE_OPTIONS, latest.answers.disclosure)}</dd>
              <dt>成熟度</dt>
              <dd>{choiceLabel(MATURITY_OPTIONS, latest.answers.maturity)}</dd>
              <dt>事实</dt>
              <dd>{latest.facts.length} 条</dd>
              <dt>冲突</dt>
              <dd>{latest.conflicts.length} 个</dd>
            </dl>
          )}
        </div>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-default btn-sm"
          data-testid="intake-keep-mine"
          disabled={busy}
          onClick={onKeepMine}
        >
          保留我的修改，基于第 {failure.latestVersion ?? "?"} 版保存
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          data-testid="intake-reload-latest"
          disabled={busy}
          onClick={onReloadLatest}
        >
          以最新版本重新加载
        </button>
      </div>
      <p className="field-hint">
        「保留我的修改」不会丢掉上面的内容；下一次保存会把它写到第 {failure.latestVersion ?? "?"} 版之上。「重新加载」会放弃上面的修改，显示最新版本的内容。
      </p>
    </div>
  );
}

function suggestionLabel(suggestion: SourceSuggestion): string {
  return `${suggestion.sourceName}${suggestion.page === null ? "" : ` 第 ${suggestion.page} 页`}：${truncate(suggestion.quote, 52)}`;
}

/** `.notice` lays its children out in a row; notices with a heading and paragraphs stack them. */
const STACKED_NOTICE = { flexDirection: "column", alignItems: "stretch" } as const;
/** `.kv` holds one pair per row; the merge columns list six pairs as a label/value grid. */
const MERGE_LIST = { display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "baseline", columnGap: 8, rowGap: 4 } as const;

function truncate(text: string, max: number): string {
  const codePoints = Array.from(text);
  return codePoints.length <= max ? text : `${codePoints.slice(0, max).join("")}…`;
}

function labelOf<T extends string>(options: readonly { value: T; label: string }[], value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function choiceLabel(
  options: readonly { value: string; label: string }[],
  value: string | null,
): string {
  if (value === null) return "未选择";
  return options.find((option) => option.value === value)?.label ?? value;
}
