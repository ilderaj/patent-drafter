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
import { Callout, Icon } from "../../components/ui/index.ts";

const QUESTION_HELP: Readonly<Record<IntakeQuestionKey, string>> = Object.freeze({
  problem: "一两句话即可。写你看到的真实问题，不用写成专利语言。",
  difference: "写结构和动作上的不同。审查员最关心这部分，写得越具体越好。",
  inventorIds: "只能写自然人。公司是申请人，不是发明人；多位发明人可以分别添加。",
  disclosure: "展示、演示、论文、上架和销售都算公开。它会影响风险提示和申请路线。",
  maturity: "决定推荐哪种申请类型，也决定材料里能写多少细节。",
});

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

  if (state.phase === "loading") return <div className="q-wrap" aria-busy="true"><p className="small muted">正在读取已保存答案…</p></div>;
  if (state.phase === "error") return <div className="q-wrap"><Callout tone="warn" icon="alert">{state.message}</Callout></div>;
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
  const [disclosureDetail, setDisclosureDetail] = useState(view.answers.disclosureDetail);
  const [maturity, setMaturity] = useState(view.answers.maturity ?? "");
  const [sources, setSources] = useState<Partial<Record<IntakeQuestionKey, QuestionSource>>>(() => {
    const stored: Partial<Record<IntakeQuestionKey, QuestionSource>> = {};
    for (const item of view.questions) if (item.source !== null) stored[item.key] = item.source;
    return stored;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const requestKey = useRef<string | null>(null);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);

  const answers = {
    ...view.answers,
    problem,
    difference,
    inventorIds,
    disclosure: disclosure === "" ? null : disclosure as typeof view.answers.disclosure,
    disclosureDetail: disclosure === "" || disclosure === "none" ? null : disclosureDetail,
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

  const appendExample = (text: string) => {
    const element = answerRef.current;
    if (!element) return;
    const current = element.value.replace(/[。；]\s*$/, "");
    const nextValue = current ? `${current}；${text}` : text;
    if (definition.key === "problem") setProblem(nextValue);
    else setDifference(nextValue);
    changed();
    element.focus();
  };

  const detail = disclosureDetail ?? { occurredOn: null, audience: "", confidentiality: "unknown" as const, evidenceRefs: [] };
  const updateDetail = (patch: Partial<typeof detail>) => {
    setDisclosureDetail({ ...detail, ...patch });
    changed();
  };

  const selectedOption = definition.key === "disclosure" ? disclosure : definition.key === "maturity" ? maturity : "";
  const options = definition.key === "disclosure" ? DISCLOSURE_OPTIONS : definition.key === "maturity" ? MATURITY_OPTIONS : [];
  const suggestion = question.suggestions[0];
  const sourceSummary = source?.kind === "source"
    ? `来自${suggestion && source.ref.chunkId === suggestion.chunkId ? `《${suggestion.sourceName}》` : "本案材料"}${source.ref.page === null ? "" : `第 ${source.ref.page} 页`}`
    : source?.kind === "direct"
      ? "用户直接回答"
      : source?.kind === "not_found"
        ? "材料中未找到"
        : "这题还没有记录来源";
  const inventedPeople = parties.filter((party) => party.kind === "person");

  return (
    <div className="q-wrap" data-testid="self-questions-step" data-question={definition.key}>
      <div className="q-prog" aria-label={`第 ${index + 1} 题，共 ${INTAKE_QUESTIONS.length} 题`}>
        {INTAKE_QUESTIONS.map((item, itemIndex) => <i key={item.key} className={itemIndex <= index ? "on" : ""} />)}
      </div>
      <div className="q-meta">
        <span>第 {index + 1} 题，共 {INTAKE_QUESTIONS.length} 题</span>
        <span className="dotsep" />
        <span>{definition.key === "disclosure" || definition.key === "maturity" ? "选择最接近的一项" : "可以随时回来改"}</span>
      </div>
      <h1 className="q-title">{definition.prompt}</h1>
      <p className="q-help">{QUESTION_HELP[definition.key]}</p>
      <div className="q-src"><Icon name="doc" size="sm" />{sourceSummary}</div>

      {definition.key === "problem" ? (
        <textarea ref={answerRef} className="textarea" maxLength={2_000} value={problem}
          placeholder="用你自己的话写，不用写成专利语言"
          onChange={(event) => { setProblem(event.currentTarget.value); changed(); }} />
      ) : null}
      {definition.key === "difference" ? (
        <textarea ref={answerRef} className="textarea" maxLength={4_000} value={difference}
          placeholder="写结构和动作上的不同，越具体越好"
          onChange={(event) => { setDifference(event.currentTarget.value); changed(); }} />
      ) : null}

      {definition.key === "inventorIds" ? (
        <div>
          {inventedPeople.length === 0 ? <p className="q-help">本案还没有发明人。按姓名添加；不会要求你填写内部编号。</p> : null}
          <div className="optgrid">
            {inventedPeople.map((party) => {
              const selected = inventorIds.includes(party.id);
              return (
                <button key={party.id} type="button" className={selected ? "optcard sel" : "optcard"}
                  aria-pressed={selected}
                  onClick={() => {
                    setInventorIds((current) => selected ? current.filter((id) => id !== party.id) : [...current, party.id]);
                    changed();
                  }}>
                  <span className={selected ? "radio on" : "radio"} />
                  <span><span className="oc-t">{party.name}</span></span>
                </button>
              );
            })}
          </div>
          <div className="rowgap" style={{ marginTop: 10 }}>
            <input className="input" value={newInventorName} onChange={(event) => setNewInventorName(event.currentTarget.value)} placeholder="发明人姓名，例如：张伟" aria-label="发明人姓名" />
            <button type="button" className="btn" disabled={!newInventorName.trim()} onClick={addInventor}>添加姓名</button>
          </div>
        </div>
      ) : null}

      {options.length > 0 ? (
        <div className="optgrid">
          {options.map((option) => {
            const selected = selectedOption === option.value;
            return (
              <button key={option.value} type="button" className={selected ? "optcard sel" : "optcard"}
                aria-pressed={selected}
                onClick={() => {
                  if (definition.key === "disclosure") setDisclosure(option.value);
                  else setMaturity(option.value);
                  changed();
                }}>
                <span className={selected ? "radio on" : "radio"} />
                <span><span className="oc-t">{option.label}</span></span>
              </button>
            );
          })}
        </div>
      ) : null}

      {definition.key === "disclosure" && disclosure !== "" && disclosure !== "none" ? (
        <div className="wiz-sec">
          <div className="q-meta"><span>公开细节（可选）</span><span className="dotsep" /><span>帮助后续风险提示</span></div>
          <div className="rowgap">
            <input className="input" type="date" aria-label="公开日期" value={detail.occurredOn ?? ""}
              onChange={(event) => updateDetail({ occurredOn: event.currentTarget.value === "" ? null : event.currentTarget.value })} />
            <input className="input" type="text" placeholder="给谁看过、在哪里" aria-label="公开对象"
              value={detail.audience} onChange={(event) => updateDetail({ audience: event.currentTarget.value })} />
            <select className="select" aria-label="是否保密" value={detail.confidentiality}
              onChange={(event) => updateDetail({ confidentiality: event.currentTarget.value as "yes" | "no" | "unknown" })}>
              <option value="unknown">保密约定：不确定</option>
              <option value="yes">有保密约定</option>
              <option value="no">没有保密约定</option>
            </select>
          </div>
          {detail.evidenceRefs.length > 0 ? (
            <ul className="small muted">
              {detail.evidenceRefs.map((ref, position) => (
                <li key={`${ref.chunkId}-${position}`}>
                  「{ref.quote}」<button type="button" className="link small" onClick={() => updateDetail({ evidenceRefs: detail.evidenceRefs.filter((_, index) => index !== position) })}>移除</button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="small muted">这些细节会随答案保存在本案；留空时不会写入。</p>
        </div>
      ) : null}

      {(definition.key === "problem" || definition.key === "difference") && question.suggestions.length > 0 ? (
        <div className="q-examples">
          {question.suggestions.map((item, itemIndex) => (
            <button key={`${item.chunkId}-${itemIndex}`} type="button" className="chip-ex" onClick={() => appendExample(item.quote)}>
              <Icon name="plus" size="sm" />{item.quote.length > 42 ? `${item.quote.slice(0, 42)}…` : item.quote}
            </button>
          ))}
        </div>
      ) : null}

      <div className="q-src">
        <Icon name="doc" size="sm" />
        {sourceSummary}
        <button type="button" className="link small" onClick={() => setSourcePickerOpen((open) => !open)}>
          {sourcePickerOpen ? "收起来源" : "更改来源"}
        </button>
      </div>
      {sourcePickerOpen ? (
        <select
          className="select"
          aria-label="这道题的来源"
          autoFocus
          value={encodeSourceValue(definition.key, source ?? null, view)}
          onChange={(event) => {
            update(definition.key, decodeSourceValue(event.currentTarget.value, definition.key, view, source));
            setSourcePickerOpen(false);
          }}
        >
          <option value="">请选择答案来源</option>
          {source && encodeSourceValue(definition.key, source, view) === SOURCE_STORED ? <option value={SOURCE_STORED}>已保存的来源</option> : null}
          <option value={SOURCE_NOT_FOUND}>材料中未找到</option>
          <option value={SOURCE_DIRECT}>用户直接回答</option>
          {question.suggestions.map((item, itemIndex) => (
            <option key={`${item.chunkId}-${itemIndex}`} value={`suggest:${itemIndex}`}>
              {item.sourceName}{item.page === null ? "" : ` 第 ${item.page} 页`}：{item.quote.length > 40 ? `${item.quote.slice(0, 40)}…` : item.quote}
            </option>
          ))}
        </select>
      ) : null}
      {question.sourceChanged ? <p className="small muted">来源已变化，请重新选择来源后再保存。</p> : null}

      {error ? <Callout tone="warn" icon="alert" testId="self-question-error">{error}</Callout> : null}
      {saved ? <p className="small muted" role="status" aria-live="polite">答案和来源已保存在本机。</p> : null}

      <div className="q-nav">
        <button type="button" className="btn" disabled={busy} onClick={() => void back()}>
          <Icon name="chevL" size="sm" />上一步
        </button>
        <span className="grow" />
        <span className="small muted">{definition.key === "disclosure" ? "这题会影响风险提示，不阻断材料生成" : "答案只用于本案"}</span>
        <button type="button" className="btn primary lg" disabled={busy} onClick={() => void next()}>
          {busy ? "正在保存…" : index === INTAKE_QUESTIONS.length - 1 ? "完成，选择路线" : "下一题"}<Icon name="arrow" size="sm" />
        </button>
      </div>
    </div>
  );
}
