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
  const { projects, answerIntake, completeIntake } = useStore();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === id) ?? null;
  const [idx, setIdx] = useState(0);
  if (!project) return null;

  const questions = project.intakeQuestions;
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
