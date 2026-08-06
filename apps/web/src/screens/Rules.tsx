import { PageHeader } from "../components/ui";
import { Badge, Card } from "../components/ui";

const RULES = [
  { id: "UM-FIG-001", rule: "实用新型必须有附图", sev: "error", src: "指南（2023）第二部分第二章" },
  { id: "COM-SECT-002", rule: "摘要 ≤ 300 字", sev: "error", src: "指南（2023）第一部分第一章" },
  { id: "CLAIM-IND-001", rule: "独立/从属引用关系合法", sev: "error", src: "指南（2023）第一部分第二章" },
  { id: "COM-TERM-001", rule: "术语全篇一致", sev: "warning", src: "指南（2023）第一部分第二章" },
  { id: "AI-INV-001", rule: "发明人必须为自然人，AI 不得署名", sev: "error", src: "指南（2026-01-01）AI 专章" },
  { id: "AI-DISC-001", rule: "AI 类发明说明书充分公开（模型构建/训练）", sev: "error", src: "指南（2026-01-01）AI 专章" },
  { id: "AI-ETH-001", rule: "数据采集/规则设置符合法律、社会公德与公共利益", sev: "warning", src: "指南（2026-01-01）AI 专章" },
];

export function Rules() {
  return (
    <>
      <PageHeader title="规则与规范" sub="版本化 CNIPA 规则包：2023-baseline + 2026-01-01（局令第 84 号，已核对）" />
      <div className="stack-3" style={{ maxWidth: 720 }}>
        <Card>
          <div className="row-between">
            <span style={{ fontSize: 13, fontWeight: 600 }}>规则包</span>
            <span className="badge mono" style={{ fontSize: 11 }}>cnipa-2026-01-01</span>
          </div>
          <p className="muted mt-2" style={{ fontSize: 12, margin: 0 }}>
            《专利审查指南》2025 修改（局令第 84 号，2026-01-01 施行）：首设"人工智能、大数据"专章，含伦理审查、
            申请文件披露要求与创造性判断案例化标准。规则元数据已核对，逐条节号待官方全文。
          </p>
        </Card>
        <Card className="pad-4">
          {RULES.map((r) => (
            <div className="row-between" key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div className="grow">
                <div className="row" style={{ gap: 10 }}>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{r.id}</span>
                  <Badge tone={r.sev === "error" ? "err" : "warn"}>{r.sev === "error" ? "必须处理" : "需关注"}</Badge>
                </div>
                <div style={{ fontSize: 13, marginTop: 3 }}>{r.rule}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r.src}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
