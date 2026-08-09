import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { useStore } from "../lib/store";
import { Badge, Button } from "../components/ui";

export function MobileHome() {
  const { projects } = useStore();
  const navigate = useNavigate();
  const rows = projects;
  return (
    <div>
      <div className="mobile-top">
        <h1>专利起草助手</h1>
        <Button size="sm" onClick={() => navigate("/new")} aria-label="新建项目">
          <Plus size={14} />
        </Button>
      </div>
      <div className="row" style={{ padding: "12px 16px", gap: 8, overflowX: "auto" }}>
        <span className="chip active">全部</span>
        <span className="chip">实用新型</span>
        <span className="chip">发明</span>
      </div>
      <div className="stack-3" style={{ padding: "0 16px 24px" }}>
        {rows.map((p) => (
          <button
            key={p.id}
            className="project-row"
            style={{ padding: 14 }}
            onClick={() => navigate(`/projects/${p.id}`)}
          >
            <span className="project-icon" style={{ width: 36, height: 36, fontSize: 14 }}>水</span>
            <span className="grow" style={{ textAlign: "left" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                更新于 {p.updatedAt.slice(5, 10)}
                {p.claimsCount ? ` · ${p.claimsCount} 条权利要求` : ""}
              </div>
            </span>
            <Badge>{p.statusLabel}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MobileWorkbench() {
  const { projects } = useStore();
  const navigate = useNavigate();
  const project = projects[0] ?? null;
  const text =
    project?.claims[0]?.text ??
    "1、一种基于三模通讯的共享热水表，包括热水表本体，其特征在于，所述热水表本体内设有控制主板，所述控制主板上集成有用于控制热水用水的控制器以及与所述控制器连接的射频通信模块、热水表蓝牙通信模块以及热水表470通信模块，…";
  return (
    <div>
      <div className="mobile-top">
        <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} aria-label="返回项目">
          <ArrowLeft size={14} />
        </Button>
        <h1>权利要求 1</h1>
        <Button size="sm">保存</Button>
      </div>
      <div style={{ padding: 16 }}>
        <div className="badge" style={{ marginBottom: 12 }}>权利要求 1（独立）</div>
        <p style={{ fontSize: 13, lineHeight: 1.9, margin: 0 }}>{text}</p>
        <div className="src-tags" style={{ marginTop: 12 }}>
          <span className="src-tag source">材料原文 p.3</span>
          <span className="src-tag user">用户确认</span>
        </div>
        <div className="notice mt-4" style={{ borderColor: "color-mix(in srgb, var(--warning) 30%, transparent)" }}>
          <span className="ic" style={{ color: "var(--warning)" }}>!</span>
          术语「智慧网关/智能网关」不一致
        </div>
      </div>
    </div>
  );
}
