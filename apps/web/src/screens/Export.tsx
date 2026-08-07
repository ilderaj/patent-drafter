import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, Notice, PageHeader } from "../components/ui";

const FILES = [
  { name: "专利申请文件草案合集.docx", note: "全部文件打包", fmt: "DOCX" },
  { name: "权利要求书.docx", note: "10 条权利要求", fmt: "DOCX" },
  { name: "说明书.docx", note: "五段式完整", fmt: "DOCX" },
  { name: "说明书摘要.docx", note: "294 字", fmt: "DOCX" },
  { name: "说明书附图.pdf", note: "图1-6", fmt: "PDF/SVG" },
  { name: "起草审阅报告.pdf", note: "含支持矩阵与 AI 辅助标识", fmt: "PDF" },
  { name: "项目备份.patentpack（加密）", note: "可选，含快照与来源", fmt: "加密" },
];

export function ExportScreen() {
  const { id } = useParams();
  const { projects, updateProject } = useStore();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === id) ?? null;
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(FILES.map((f) => [f.name, true])),
  );
  const [done, setDone] = useState(false);
  const [unsupportedBlocked, setUnsupportedBlocked] = useState(false);
  if (!project) return null;
  const audit = project.audit;
  const noneFeatures = (audit?.rows ?? []).filter((r) => r.status === "none").map((r) => r.feature);

  return (
    <>
      <PageHeader title="导出申请文件草案包" sub="选择需要导出的文件，全部在本机生成" />
      <div className="stack-3" style={{ maxWidth: 720 }}>
        {FILES.map((f) => {
          const isBlocked = f.name.includes("专利") && !f.name.includes("patentpack") && unsupportedBlocked;
          return (
            <label
              key={f.name}
              className="file-row"
              style={{ cursor: "pointer", opacity: isBlocked ? 0.5 : 1 }}
            >
              <input
                type="checkbox"
                style={{ width: 16, height: 16, accentColor: "var(--primary)" }}
                checked={!!selected[f.name]}
                disabled={isBlocked}
                onChange={(e) => setSelected((s) => ({ ...s, [f.name]: e.target.checked }))}
              />
              <span className="grow">
                <span style={{ fontSize: 13, fontWeight: 500 }}>{f.name}</span>
                <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>{f.note}</span>
              </span>
              <span className="badge mono" style={{ fontSize: 11 }}>{f.fmt}</span>
            </label>
          );
        })}
      </div>
      {unsupportedBlocked ? (
        <div className="notice mt-4" style={{ borderColor: "var(--destructive)" }}>
          <span className="ic">!</span>
          审校门禁：存在无来源特征（{noneFeatures.join("、")}）。正式申请文件导出已被阻止，请先在工作台确认该特征来源。
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${project.id}`)}>
            去处理
          </Button>
        </div>
      ) : null}
      <div className="mt-4">
        <Notice>
          申请文件正文不含 AI 声明；AI 辅助标识仅出现在审阅报告与项目元数据中。导出前请人工审阅全部内容。
        </Notice>
      </div>
      <div className="row mt-5" style={{ justifyContent: "flex-end" }}>
        <Button
          onClick={() => {
            const anyFormal = Object.entries(selected).some(([n, v]) => v && !n.includes("patentpack"));
            if (anyFormal && audit && audit.errors > 0) {
              setUnsupportedBlocked(true);
              return;
            }
            setUnsupportedBlocked(false);
            setDone(true);
            if (project.live) {
              const ctx = project.live.ctx;
              const claimsOut = ctx.results.draft_claims?.output as { claims: Array<{ text: string }> } | undefined;
              const specOut = ctx.results.draft_specification?.output as { sections: Array<{ section: string; content: string }> } | undefined;
              const abstractOut = ctx.results.draft_abstract?.output as { abstract: string } | undefined;
              const lines: string[] = ["# 专利申请文件草案包（本机生成）", ""];
              lines.push("## 权利要求书", ...(claimsOut?.claims.map((c) => c.text) ?? []), "");
              const titles: Record<string, string> = {
                technical_field: "技术领域",
                background: "背景技术",
                summary: "发明内容",
                figures_desc: "附图说明",
                embodiments: "具体实施方式",
              };
              lines.push("## 说明书", ...(specOut?.sections.flatMap((s) => [`### ${titles[s.section] ?? s.section}`, s.content, ""]) ?? []));
              if (abstractOut?.abstract) lines.push("## 说明书摘要", abstractOut.abstract, "");
              const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${project.name || "patent-draft"}-草案包.md`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }
            updateProject(project.id, {
              versions: [
                {
                  version: `v${project.versions.length + 1}`,
                  note: `导出：${Object.entries(selected).filter(([, v]) => v).length} 个文件`,
                  meta: `2026-08-06 · 本机导出 · 规则包 cnipa-2026-01-01`,
                },
                ...project.versions,
              ],
            });
          }}
        >
          {done ? "✓ 已在本机生成导出包" : "在本机生成导出包"}
        </Button>
      </div>
    </>
  );
}
