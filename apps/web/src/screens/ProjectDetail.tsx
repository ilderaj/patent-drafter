import { Navigate, useLocation, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Upload } from "./Upload";
import { Readiness } from "./Readiness";
import { Intake } from "./Intake";
import { Strategy } from "./Strategy";
import { Workbench } from "./Workbench";
import { Figures } from "./Figures";
import { AuditScreen } from "./Audit";
import { ExportScreen } from "./Export";
import { History } from "./History";

export function ProjectDetail() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const { projects } = useStore();
  const project = projects.find((p) => p.id === id) ?? null;

  if (!project) {
    return (
      <div className="state-screen">
        <div className="state-card">
          <h2>项目不存在</h2>
          <p>该项目可能已被删除。</p>
        </div>
      </div>
    );
  }

  const seg = pathname.split("/").pop();
  switch (seg) {
    case "upload":
      return <Upload />;
    case "readiness":
      return <Readiness />;
    case "intake":
      return <Intake />;
    case "strategy":
      return <Strategy />;
    case "figures":
      return <Figures />;
    case "audit":
      return <AuditScreen />;
    case "export":
      return <ExportScreen />;
    case "history":
      return <History />;
    default: {
      if (project.status === "readiness") return <Readiness />;
      if (project.status === "intake") return <Intake />;
      if (project.status === "strategy") return <Strategy />;
      if (project.status === "new" || project.status === "uploading") {
        return <Navigate to={`/projects/${project.id}/upload`} replace />;
      }
      return <Workbench />;
    }
  }
}
