import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, TextArea } from "../components/ui";
import { DEMO_CLAIMS, DEMO_SPEC, DEMO_ABSTRACT } from "../lib/data";

const OUTLINE = [
  { no: "1", name: "权利要求书", done: true },
  { no: "2", name: "说明书", done: false },
  { no: "3", name: "说明书摘要", done: false },
  { no: "4", name: "说明书附图", done: false },
];

export function Workbench() {
  const { id } = useParams();
  const { projects, updateProject, regenerateClaim } = useStore();
  const project = projects.find((p) => p.id === id) ?? null;
  const [selected, setSelected] = useState("c1");
  if (!project) return null;

  const claims = project.claims.length > 0 ? project.claims : DEMO_CLAIMS;
  const spec = project.specSections.length > 0 ? project.specSections : DEMO_SPEC;
  const abstract = project.abstractText || DEMO_ABSTRACT;
  const claim = claims.find((c) => c.id === selected) ?? claims[0];

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{project.name}</div>
          <div className="row mt-1" style={{ gap: 8 }}>
            <span className="badge">{project.statusLabel}</span>
            <span className="muted" style={{ fontSize: 12 }}>已保存 {project.updatedAt.slice(11) || "14:32"}</span>
          </div>
        </div>
        <div className="row">
          <Link to={`/projects/${project.id}/figures`} className="btn btn-secondary btn-sm">附图中心</Link>
          <Link to={`/projects/${project.id}/audit`} className="btn btn-secondary btn-sm">审校矩阵</Link>
          <Link to={`/projects/${project.id}/export`} className="btn btn-primary btn-sm">导出</Link>
        </div>
      </div>

      <div className="workbench">
        <div className="wb-col">
          <div className="col-title">起草大纲</div>
          {OUTLINE.map((o) => (
            <div key={o.no} className={`outline-item ${o.done ? "done" : ""} ${o.name === "权利要求书" ? "active" : ""}`}>
              <span className="no">{o.no}</span>
              {o.name}
              {o.done ? <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--primary-foreground)" }}>✓</span> : null}
            </div>
          ))}
          <div className="col-title" style={{ marginTop: 16 }}>段落</div>
          {claims.map((c) => (
            <div
              key={c.id}
              className={`outline-item ${c.id === claim.id ? "active" : ""} ${c.sources.some((s) => s.kind === "none") ? "has-issue" : ""}`}
              onClick={() => setSelected(c.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(c.id); } }}
            >
              <span className="no">{c.id.slice(1)}</span>
              {c.label.replace(/^权利要求 /, "")}
              {c.sources.some((s) => s.kind === "none") ? <span className="warn" style={{ marginLeft: "auto", fontSize: 11 }}>!无来源</span> : null}
            </div>
          ))}
        </div>

        <div className="wb-col">
          <div className="row-between">
            <span className="col-title">权利要求 1（独立）</span>
            <span className="muted" style={{ fontSize: 11 }}>可编辑</span>
          </div>
          <div className="claim-card">
            <TextArea
              value={claim.text}
              aria-label={`${claim.id} 内容编辑`}
              onChange={(e) =>
                updateProject(project.id, {
                  claims: claims.map((c) => (c.id === claim.id ? { ...c, text: e.target.value } : c)),
                })
              }
              style={{ minHeight: 220, fontSize: 13, lineHeight: 1.9 }}
            />
            <div className="src-tags">
              {claim.sources.map((s, i) => (
                <span key={i} className={`src-tag ${s.kind}`}>{s.label}</span>
              ))}
            </div>
            {claim.stale ? (
              <div className="stale-note">
                已检测到上一阶段答案更新，此段需要重新生成以保持一致性。
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => regenerateClaim(project.id, claim.id)}>
                  重新生成此段
                </Button>
              </div>
            ) : (
              <div className="stale-note" style={{ background: "var(--muted)", color: "var(--muted-foreground)", borderColor: "var(--border)" }}>
                内容与当前事实一致。修改后保存即生成新版本快照。
              </div>
            )}
          </div>
        </div>

        <div className="wb-col">
          <div className="col-title">实时检查</div>
          <div className="card pad-4" style={{ padding: 16 }}>
            <div className="check-item"><span className="ok">✓</span>特征与来源匹配</div>
            <div className="check-item"><span className="ok">✓</span>引用关系合法</div>
            <div className="check-item"><span className="warn">!</span>术语「智慧网关/智能网关」不一致</div>
            <div className="check-item"><span className="ok">✓</span>摘要 294 字（≤300）</div>
            <div className="check-item"><span className="warn">!</span>插卡槽水通路无来源（需确认）</div>
          </div>
          <div className="col-title" style={{ marginTop: 12 }}>其他文档</div>
          <div className="card pad-4" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>说明书（五段式）</div>
            <div className="muted mt-2" style={{ fontSize: 12, lineHeight: 1.7 }}>
              {spec.map((s) => s.title).join(" / ")}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 12 }}>说明书摘要</div>
            <div className="muted mt-2" style={{ fontSize: 12, lineHeight: 1.7 }}>{abstract.slice(0, 60)}…</div>
          </div>
        </div>
      </div>
    </div>
  );
}
