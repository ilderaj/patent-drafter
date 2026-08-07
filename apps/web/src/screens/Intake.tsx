import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, PageHeader, RadioCard, TextArea } from "../components/ui";
import type { IntakeAnswer, IntakeQuestion, Project } from "../lib/types";

function QuestionStep({
  project,
  q,
  isLast,
  onNext,
}: {
  project: Project;
  q: IntakeQuestion;
  isLast: boolean;
  onNext: (a: IntakeAnswer) => void;
}) {
  const prev = project.intakeAnswers.find((a) => a.id === q.id);
  const [choice, setChoice] = useState<string | undefined>(prev?.choice);
  const [note, setNote] = useState(prev?.note ?? "");
  const [error, setError] = useState(false);
  return (
    <div className="card stack-4" style={{ maxWidth: 720 }}>
      <div>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0, lineHeight: 1.5 }}>{q.question}</h2>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{q.source}</div>
      </div>
      <div className="stack-3">
        {q.options.map((o) => (
          <RadioCard key={o} selected={choice === o} onClick={() => { setChoice(o); setError(false); }}>
            <span style={{ fontSize: 13 }}>{o}</span>
          </RadioCard>
        ))}
      </div>
      <div>
        <div className="field-label">补充说明（可选）</div>
        <TextArea placeholder={q.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button
          disabled={!choice}
          onClick={() => {
            if (!choice) { setError(true); return; }
            onNext({ id: q.id, choice, note: note.trim() || undefined });
          }}
        >
          {error ? "请选择一个选项" : isLast ? "完成补充，查看策略" : "下一个问题"}
        </Button>
      </div>
    </div>
  );
}

export function Intake() {
  const { id } = useParams();
  const { projects, answerIntake, completeIntake, answerLiveIntake, runLiveTo } = useStore();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === id) ?? null;
  const [idx, setIdx] = useState(0);
  if (!project) return null;

  const questions = project.intakeQuestions;
  if (project.live) {
    return (
      <LiveIntake
        project={project}
        onSubmit={async (answers) => {
          await answerLiveIntake(project.id, answers);
          await runLiveTo(project.id, "propose_claim_strategy");
          navigate(`/projects/${project.id}/strategy`);
        }}
      />
    );
  }
  const q = questions[idx];
  if (!q) return null;

  return (
    <>
      <PageHeader title="补充信息" sub={`共 ${questions.length} 个问题 · 第 ${idx + 1} / ${questions.length} 个`} />
      <div className="stepper">
        {questions.map((_, i) => (
          <span key={i} className={`seg ${i <= idx ? "done" : ""}`} />
        ))}
      </div>
      <QuestionStep
        key={q.id}
        project={project}
        q={q}
        isLast={idx + 1 === questions.length}
        onNext={(a) => {
          answerIntake(project.id, a);
          if (idx + 1 < questions.length) {
            setIdx(idx + 1);
          } else {
            completeIntake(project.id);
            navigate(`/projects/${project.id}/strategy`);
          }
        }}
      />
      <div className="row mt-3" style={{ justifyContent: "flex-end", maxWidth: 720 }}>
        <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
          ← 上一步
        </Button>
      </div>
    </>
  );
}

function LiveIntake({ project, onSubmit }: { project: Project; onSubmit: (a: Record<string, string>) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = project.intakeQuestions;
  const required = questions.filter((q) => q.source === "必答");
  const missing = required.some((q) => !answers[q.id]?.trim());

  return (
    <>
      <PageHeader title="补充信息" sub={`共 ${questions.length} 个问题 · 基于交底材料缺口生成`} />
      <div className="stack-4" style={{ maxWidth: 720 }}>
        {questions.map((q) => {
          const val = answers[q.id] ?? "";
          return (
            <div className="card stack-3" key={q.id}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, lineHeight: 1.5 }}>{q.question}</h2>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{q.source}</div>
              </div>
              <div className="stack-2">
                {q.options.map((o) => (
                  <RadioCard key={o} selected={val === o} onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}>
                    <span style={{ fontSize: 13 }}>{o}</span>
                  </RadioCard>
                ))}
              </div>
              <div>
                <div className="field-label">补充说明（可选，将作为已确认事实进入起草）</div>
                <TextArea
                  placeholder={q.notePlaceholder}
                  value={q.options.includes(val) ? "" : val}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                />
              </div>
            </div>
          );
        })}
        {error ? <div style={{ color: "var(--destructive)", fontSize: 13 }}>{error}</div> : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button
            disabled={busy || missing}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSubmit(answers);
              } catch (e) {
                setError(`提交失败：${(e as Error).message}`);
                setBusy(false);
              }
            }}
          >
            {busy ? "处理中…" : "提交回答，生成保护策略"}
          </Button>
        </div>
      </div>
    </>
  );
}
