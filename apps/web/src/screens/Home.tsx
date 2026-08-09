import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useStore } from "../lib/store";
import { Badge, Button, EmptyState, PageHeader } from "../components/ui";
import { TYPE_LABEL, statusLabelOf } from "../lib/data";
import type { Project } from "../lib/types";

const ICONS: Record<string, string> = { utility_model: "水", invention: "锁", other: "网" };

const STATUS_TONE: Record<string, "ok" | "warn" | "err" | undefined> = {
  审校完成: "ok",
  补充信息中: "warn",
  需补充材料: "err",
};

function ProjectRow({ p, onOpen }: { p: Project; onOpen: () => void }) {
  return (
    <button className="project-row" onClick={onOpen}>
      <span className="project-icon">{ICONS[p.patentType] ?? "专"}</span>
      <span className="grow" style={{ textAlign: "left", minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.name}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {TYPE_LABEL[p.patentType]} · 更新于 {p.updatedAt.slice(0, 10)}
          {p.claimsCount ? ` · 权利要求 ${p.claimsCount} 条` : ""}
        </div>
      </span>
      <Badge tone={STATUS_TONE[p.statusLabel]}>{p.statusLabel}</Badge>
      <span className="muted" aria-hidden>⋯</span>
    </button>
  );
}

export function Home() {
  const { projects, loadDemo } = useStore();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="项目"
        sub="所有起草记录保存在本机，不上传云端"
        actions={
          <>
            <Button onClick={() => navigate("/new")}>
              <Plus size={15} />
              新建项目
            </Button>
          </>
        }
      />
      <div className="row" style={{ marginBottom: 16 }}>
        <span className="chip active">全部</span>
        <span className="chip">实用新型</span>
        <span className="chip">发明专利</span>
      </div>
      <div className="stack-3">
        {projects.map((p) => (
          <ProjectRow key={p.id} p={p} onOpen={() => navigate(`/projects/${p.id}`)} />
        ))}
        {projects.length === 0 ? (
          <EmptyState
            title="还没有项目"
            sub="新建项目并上传交底材料，或先浏览一个示例项目熟悉流程"
            action={
              <div className="row" style={{ justifyContent: "center" }}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    loadDemo();
                    navigate("/projects/demo-hot-water-meter");
                  }}
                >
                  载入示例项目（热水表）
                </Button>
              </div>
            }
          />
        ) : null}
      </div>
    </>
  );
}
