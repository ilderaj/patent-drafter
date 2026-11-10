import { useEffect, useRef, useState } from "react";
import type { Party } from "../../../../../../packages/contracts/src/matter.ts";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import {
  DISCLOSURE_OPTIONS,
  INTAKE_QUESTIONS,
  MATURITY_OPTIONS,
  isAnswered,
  readIntake,
  saveIntake,
  type IntakeQuestionKey,
  type IntakeView,
  type QuestionSource,
} from "../intake/intake.ts";
import { decodeSourceValue, encodeSourceValue, SOURCE_DIRECT, SOURCE_NOT_FOUND, SOURCE_STORED } from "../intake/Intake.tsx";
import type { SelfServiceStep } from "./SelfService.tsx";
import { intakeSaveInput } from "./persistence.ts";

export function QuestionsStep({
  repository,
  actor,
  matterId,
  initialIndex,
  onNavigate,
  onQuestion,
}: {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  initialIndex: number;
  onNavigate: (step: SelfServiceStep, targetId?: string | null) => void;
  onQuestion: (index: number) => void;
}) {
  const [state, setState] = useState<{ phase: "loading" } | { phase: "ready"; view: IntakeView } | { phase: "error"; message: string }>({ phase: "loading" });
  useEffect(() => {
    let live = true;
    void readIntake(repository, actor, matterId).then((result) => {
      if (!live) return;
      setState(result.ok ? { phase: "ready", view: result.view } : { phase: "error", message: result.message });
    });
    return () => { live = false; };
  }, [repository, actor, matterId]);

  if (state.phase === "loading") return <section className="v6-self-step" aria-busy="true"><p className="muted">正在读取已保存答案…</p></section>;
  if (state.phase === "error") return <section className="v6-self-step"><div className="notice" role="alert">{state.message}</div></section>;
  const index = Math.min(Math.max(0, initialIndex), INTAKE_QUESTIONS.length - 1);
  return <QuestionForm key={`${index}/${state.view.sourceVersion}`} {...{ repository, actor, matterId, index, view: state.view, onNavigate, onQuestion }} />;
}

function QuestionForm({
  repository,
  actor,
  matterId,
  index,
  view,
  onNavigate,
  onQuestion,
}: {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  index: number;
  view: IntakeView;
  onNavigate: (step: SelfServiceStep, targetId?: string | null) => void;
  onQuestion: (index: number) => void;
}) {
  const definition = INTAKE_QUESTIONS[index]!;
  const question = view.questions.find((item) => item.key === definition.key)!;
  const [problem, setProblem] = useState(view.answers.problem);
  const [difference, setDifference] = useState(view.answers.difference);
  const [inventorIds, setInventorIds] = useState(view.answers.inventorIds);
  const [parties, setParties] = useState(view.parties);
  const [newInventorName, setNewInventorName] = useState("");
  const [disclosure, setDisclosure] = useState(view.answers.disclosure ?? "");
  const [maturity, setMaturity] = useState(view.answers.maturity ?? "");
  const [sources, setSources] = useState<Partial<Record<IntakeQuestionKey, QuestionSource>>>(() => {
    const stored: Partial<Record<IntakeQuestionKey, QuestionSource>> = {};
    for (const item of view.questions) if (item.source !== null) stored[item.key] = item.source;
    return stored;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const requestKey = useRef<string | null>(null);

  const answers = {
    ...view.answers,
    problem,
    difference,
    inventorIds,
    disclosure: disclosure === "" ? null : disclosure as typeof view.answers.disclosure,
    disclosureDetail: disclosure === "" || disclosure === "none" ? null : view.answers.disclosureDetail,
    maturity: maturity === "" ? null : maturity as typeof view.answers.maturity,
  };
  const source = sources[definition.key];
  const update = <K extends IntakeQuestionKey>(key: K, next: QuestionSource | undefined) => {
    requestKey.current = null;
    setSaved(false);
    setError(null);
    setSources((current) => {
      const updated = { ...current };
      if (next === undefined) delete updated[key];
      else updated[key] = next;
      return updated;
    });
  };
  const changed = () => {
    requestKey.current = null;
    setSaved(false);
    setError(null);
  };

  const hasAnswer = isAnswered(definition.key, answers);
  const hasInput = definition.key === "problem" ? problem.trim() !== ""
    : definition.key === "difference" ? difference.trim() !== ""
      : definition.key === "inventorIds" ? inventorIds.length > 0
        : definition.key === "disclosure" ? disclosure !== ""
          : maturity !== "";

  const persist = async (mustAnswer: boolean): Promise<boolean> => {
    if (mustAnswer && !hasAnswer) {
      setError("请先完成这一题，再继续。");
      return false;
    }
    if (!hasInput) return true;
    if (!source) {
      setError("请说明答案来自材料、材料中未找到，还是你直接提供的信息。");
      return false;
    }
    setBusy(true);
    setError(null);
    const result = await saveIntake(
      repository,
      actor,
      matterId,
      intakeSaveInput(view, {
        answers,
        parties,
        questionSources: { [definition.key]: source },
      }),
      { requestKey: requestKey.current ??= `self-question-${crypto.randomUUID()}` },
    );
    setBusy(false);
    if (!result.ok) {
      const details = result.fields?.map((field) => field.reason).join("；");
      setError(details ? `${result.message} ${details}` : result.message);
      return false;
    }
    requestKey.current = null;
    setSaved(true);
    return true;
  };

  const back = async () => {
    if (!(await persist(false))) return;
    if (index === 0) onNavigate("upload");
    else onQuestion(index - 1);
  };
  const next = async () => {
    if (!(await persist(true))) return;
    if (index === INTAKE_QUESTIONS.length - 1) onNavigate("route");
    else onQuestion(index + 1);
  };

  const addInventor = () => {
    const name = newInventorName.trim();
    if (!name) return;
    const party: Party = { id: crypto.randomUUID(), kind: "person", name, roles: [], country: null };
    setParties((current) => [...current, party]);
    setInventorIds((current) => [...current, party.id]);
    setNewInventorName("");
    changed();
  };

  return (
    <section className="v6-self-step" data-testid="self-questions-step" data-question={definition.key}>
      <div className="v6-self-step-heading">
        <div><p className="v6-self-kicker">第 2 步 · 问题 {index + 1} / {INTAKE_QUESTIONS.length}</p><h2>{definition.label}</h2></div>
        <span className="v6-self-progress" aria-label={`第 ${index + 1} 题，共 ${INTAKE_QUESTIONS.length} 题`}>
          {INTAKE_QUESTIONS.map((item, itemIndex) => <i key={item.key} data-current={itemIndex === index ? "true" : undefined} data-complete={isAnswered(item.key, answers) ? "true" : undefined} />)}
        </span>
      </div>
      <p className="v6-self-question">{definition.prompt}</p>
      <p className="v6-self-copy">{question.prompt} 答案只保存在本案中；材料内容不会替你作选择。</p>

      {definition.key === "problem" ? (
        <label className="v6-self-field"><span>实际遇到的问题</span><textarea className="textarea" maxLength={2_000} value={problem} onChange={(event) => { setProblem(event.currentTarget.value); changed(); }} /></label>
      ) : null}
      {definition.key === "difference" ? (
        <label className="v6-self-field"><span>与现有做法相比，实际改变了什么</span><textarea className="textarea" maxLength={4_000} value={difference} onChange={(event) => { setDifference(event.currentTarget.value); changed(); }} /></label>
      ) : null}
      {definition.key === "inventorIds" ? (
        <div className="v6-self-field">
          <span>选择或添加发明人（自然人）</span>
          {parties.filter((party) => party.kind === "person").length === 0 ? <p className="field-hint">本案还没有发明人。按姓名添加；不会要求你填写内部编号。</p> : null}
          <div className="v6-self-people">
            {parties.filter((party) => party.kind === "person").map((party) => (
              <label key={party.id} className="v6-self-person">
                <input type="checkbox" checked={inventorIds.includes(party.id)} onChange={(event) => {
                  setInventorIds((current) => event.currentTarget.checked ? [...current, party.id] : current.filter((id) => id !== party.id));
                  changed();
                }} />
                <span>{party.name}</span>
              </label>
            ))}
          </div>
          <div className="v6-self-add-person">
            <input className="input" value={newInventorName} onChange={(event) => setNewInventorName(event.currentTarget.value)} placeholder="发明人姓名" aria-label="发明人姓名" />
            <button type="button" className="btn btn-outline" disabled={!newInventorName.trim()} onClick={addInventor}>添加姓名</button>
          </div>
        </div>
      ) : null}
      {definition.key === "disclosure" ? (
        <label className="v6-self-field"><span>是否对外公开过？</span><select className="select" value={disclosure} onChange={(event) => { setDisclosure(event.currentTarget.value); changed(); }}>
          <option value="">请选择，不会自动填写</option>
          {DISCLOSURE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select><span className="field-hint">展示、发表、销售等经历由你判断并选择；不确定时可以明确选择「不确定」。</span></label>
      ) : null}
      {definition.key === "maturity" ? (
        <label className="v6-self-field"><span>目前做到什么程度？</span><select className="select" value={maturity} onChange={(event) => { setMaturity(event.currentTarget.value); changed(); }}>
          <option value="">请选择，不会自动填写</option>
          {MATURITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      ) : null}

      <label className="v6-self-field" htmlFor={`self-source-${definition.key}`}>
        <span>这题的来源</span>
        <select
          id={`self-source-${definition.key}`}
          className="select"
          value={encodeSourceValue(definition.key, source ?? null, view)}
          onChange={(event) => update(definition.key, decodeSourceValue(event.currentTarget.value, definition.key, view, source))}
        >
          <option value="">请选择答案来源</option>
          {source && encodeSourceValue(definition.key, source, view) === SOURCE_STORED ? <option value={SOURCE_STORED}>已保存的来源（材料位置待复核）</option> : null}
          <option value={SOURCE_NOT_FOUND}>材料中未找到</option>
          <option value={SOURCE_DIRECT}>用户直接回答</option>
          {question.suggestions.map((suggestion, suggestionIndex) => (
            <option key={`${suggestion.chunkId}-${suggestionIndex}`} value={`suggest:${suggestionIndex}`}>
              {suggestion.sourceName}{suggestion.page === null ? "" : ` · 第 ${suggestion.page} 页`}：{suggestion.quote}
            </option>
          ))}
        </select>
      </label>
      {source?.kind === "source" ? <blockquote className="v6-self-source-quote">{source.ref.quote}</blockquote> : null}

      {error ? <div className="notice" role="alert" data-testid="self-question-error">{error}</div> : null}
      {saved ? <p className="field-hint" role="status" aria-live="polite">答案和来源已保存在本机。</p> : null}
      <div className="v6-self-actions">
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void back()}>上一步</button>
        <span className="field-hint">{definition.key === "disclosure" ? "公开历史会影响风险提示，但不会自动阻断准备材料。" : "可随时回退修改；已保存内容会留在本案。"}</span>
        <button type="button" className="btn btn-default" disabled={busy} onClick={() => void next()}>{busy ? "正在保存…" : index === INTAKE_QUESTIONS.length - 1 ? "完成并选择路线" : "保存并继续"}</button>
      </div>
    </section>
  );
}
