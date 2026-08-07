import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, Card, PageHeader } from "../components/ui";

export function Strategy() {
  const { id } = useParams();
  const { projects, confirmStrategy, updateProject, runLiveTo } = useStore();
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === id) ?? null;
  if (!project) return null;

  if (project.live) {
    const strategyOut = project.live.ctx.results.propose_claim_strategy?.output as
      | { protectionCore: string[]; dependentExtensions: string[]; exclusions: string[]; riskNotes: string[] }
      | undefined;
    const typeOut = project.live.ctx.results.recommend_patent_type?.output as
      | { patentType: string; rationale: string }
      | undefined;
    const typeLabel = typeOut?.patentType === "invention" ? "发明专利（Beta）" : "实用新型";
    return (
      <>
        <PageHeader title="保护策略建议" sub="由真实管线基于已确认事实生成，请审阅后确认" />
        <Card className="stack-4" style={{ maxWidth: 720 }}>
          <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
            <span className="field-label" style={{ margin: 0, minWidth: 72 }}>建议类型</span>
            <div>
              <span className="badge">{typeLabel}</span>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{typeOut?.rationale}</div>
            </div>
          </div>
          <dl className="stack-3" style={{ margin: 0 }}>
            <div className="kv"><dt>保护核心</dt><dd>{(strategyOut?.protectionCore ?? []).join("；")}</dd></div>
            <div className="kv"><dt>从属扩展</dt><dd>{(strategyOut?.dependentExtensions ?? []).join("；")}</dd></div>
            <div className="kv"><dt>排除范围</dt><dd>{(strategyOut?.exclusions ?? []).join("；") || "无"}</dd></div>
            <div className="kv"><dt>主要风险</dt><dd>{(strategyOut?.riskNotes ?? []).join("；")}</dd></div>
          </dl>
          <label className="check-row" style={{ borderTop: "1px solid var(--border)" }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span style={{ fontSize: 13 }}>我确认以上保护策略，按此起草权利要求与说明书</span>
          </label>
          {busy ? <div className="muted" style={{ fontSize: 12 }}>正在起草权利要求、说明书、附图规划、摘要并完成审校（约 2-3 分钟，请勿关闭页面）…</div> : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => navigate(`/projects/${project.id}/intake`)}>← 返回补充信息</Button>
            <Button
              disabled={!confirmed || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await runLiveTo(project.id, "audit_formal_rules");
                  navigate(`/projects/${project.id}`);
                } catch (e) {
                  alert(`起草失败：${(e as Error).message}`);
                  setBusy(false);
                }
              }}
            >
              {busy ? "起草中…" : "确认并起草"}
            </Button>
          </div>
        </Card>
      </>
    );
  }

  const s = project.strategy ?? {
    type: "实用新型（产品型）",
    reason: "核心创新是三模通讯结构，属于产品形状/构造改进；材料充分性优先支撑实用新型",
    core: "热水表本体 + 控制主板 + 控制器 + 射频/蓝牙mesh/470 三模通讯模块及其连接关系",
    dependentChain: "网关连接方式 → 网关结构 → 主板插接 → 尺寸/固定位 → 插卡槽 → 手动阀门",
    risks: "尺寸参数（87.9mm 等）来源待确认；470 组网细节来自 JMesh 协议资料，需确认属于本发明内容",
    confirmText: "我确认以上保护策略，按此生成权利要求骨架",
  };

  return (
    <>
      <PageHeader title="保护策略建议" sub="基于已确认事实生成的策略草案，请审阅后确认" />
      <Card className="stack-4" style={{ maxWidth: 720 }}>
        <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
          <span className="field-label" style={{ margin: 0, minWidth: 72 }}>建议类型</span>
          <div>
            <span className="badge">{s.type}</span>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{s.reason}</div>
          </div>
        </div>
        <dl className="stack-3" style={{ margin: 0 }}>
          <div className="kv"><dt>保护核心</dt><dd>{s.core}</dd></div>
          <div className="kv"><dt>从属扩展</dt><dd>{s.dependentChain}</dd></div>
          <div className="kv"><dt>主要风险</dt><dd>{s.risks}</dd></div>
        </dl>
        <label className="check-row" style={{ borderTop: "1px solid var(--border)" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>{s.confirmText}</span>
        </label>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => navigate(`/projects/${project.id}/intake`)}>
            ← 返回补充信息
          </Button>
          <Button
            disabled={!confirmed}
            onClick={() => {
              updateProject(project.id, { strategy: s });
              confirmStrategy(project.id);
              navigate(`/projects/${project.id}`);
            }}
          >
            确认并生成权利要求骨架
          </Button>
        </div>
      </Card>
    </>
  );
}
