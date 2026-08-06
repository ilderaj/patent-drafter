import { useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, PageHeader } from "../components/ui";
import { DEMO_FIGURE_BRIEF, DEMO_FIGURES } from "../lib/data";

export function Figures() {
  const { id } = useParams();
  const { projects } = useStore();
  const project = projects.find((p) => p.id === id) ?? null;
  if (!project) return null;
  const figures = project.figures.length > 0 ? project.figures : DEMO_FIGURES;
  const brief = project.figureBrief || DEMO_FIGURE_BRIEF;

  return (
    <>
      <PageHeader title="附图中心" sub="框图类自动生成；机械图、电路图请按 Drawing Brief 上传" />
      <div className="fig-grid">
        {figures.map((f) => (
          <div className="fig-tile" key={f.id}>
            <div className="fig-canvas">{f.previewLabel}</div>
            <div className="fig-meta">
              <span style={{ fontSize: 13, fontWeight: 500 }}>{f.title}</span>
              <span className="badge">{f.badge}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="card mt-5">
        <div style={{ fontSize: 13, fontWeight: 600 }}>图2 Drawing Brief（给绘图方/用户）</div>
        <p className="muted mt-2" style={{ fontSize: 12, lineHeight: 1.8, margin: 0 }}>{brief}</p>
        <div className="row mt-4">
          <Button variant="secondary">导出 Drawing Brief 文档</Button>
          <Button variant="ghost">上传用户图纸（替换占位）</Button>
        </div>
      </div>
    </>
  );
}
