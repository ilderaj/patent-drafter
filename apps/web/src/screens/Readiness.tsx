import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, Notice, PageHeader } from "../components/ui";

const STATUS_TONE: Record<string, string> = {
  confirm: "badge-warn",
  conflict: "badge-err",
  partial: "",
  noise: "badge-warn",
  ok: "badge-ok",
};

export function Readiness() {
  const { id } = useParams();
  const { projects, proceedFromReadiness } = useStore();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === id) ?? null;
  if (!project) return null;

  return (
    <>
      <PageHeader
        title="交底充分性报告"
        sub="系统已分析材料，以下是覆盖情况与待补充项"
        actions={
          <Button variant="ghost" onClick={() => navigate(`/projects/${project.id}/upload`)}>
            ← 返回上传
          </Button>
        }
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 16 }}>
          <b style={{ fontSize: 20, fontWeight: 600 }}>{project.coverage}% 覆盖</b>
          <span className="muted" style={{ fontSize: 12, flex: 1 }}>
            {project.coverageNote}
          </span>
        </div>
      </div>
      <div className="stack-3" style={{ marginBottom: 24 }}>
        {project.dimensions.map((d) => (
          <div className="card pad-4" key={d.name} style={{ padding: 16 }}>
            <div className="row-between">
              <div className="row" style={{ gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{d.name}</span>
                <span className={`badge ${STATUS_TONE[d.status]}`}>{d.label}</span>
              </div>
              <span className="muted" style={{ fontSize: 12, textAlign: "right" }}>{d.note}</span>
            </div>
          </div>
        ))}
      </div>
      <Notice icon="!">{project.intakeNote}</Notice>
      <div className="row mt-5" style={{ justifyContent: "flex-end" }}>
        <Button
          onClick={() => {
            proceedFromReadiness(project.id);
            navigate(`/projects/${project.id}/intake`);
          }}
        >
          开始补充信息（4 个问题）
        </Button>
      </div>
    </>
  );
}
