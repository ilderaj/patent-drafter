import { useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, PageHeader } from "../components/ui";

export function History() {
  const { id } = useParams();
  const { projects } = useStore();
  const project = projects.find((p) => p.id === id) ?? null;
  if (!project) return null;
  const versions = project.versions.length > 0 ? project.versions : [
    { version: "v5", note: "审校修正：术语统一、插卡槽水通路确认来源", meta: "2026-08-05 16:20 · deepseek-chat · prompt v1.3 · 规则包 cnipa-2026-01-01" },
    { version: "v4", note: "摘要重写：去除宣传语，294 字", meta: "2026-08-05 15:02 · deepseek-chat · prompt v1.2 · 规则包 cnipa-2026-01-01" },
    { version: "v3", note: "权利要求 4-10 从属树重排", meta: "2026-08-05 11:40 · deepseek-chat · prompt v1.1 · 规则包 cnipa-2026-01-01" },
    { version: "v2", note: "初稿：权利要求骨架 + 说明书", meta: "2026-08-04 17:25 · deepseek-chat · prompt v1.0 · 规则包 2023-baseline" },
    { version: "v1", note: "材料解析完成，事实提取", meta: "2026-08-04 10:05 · 本地解析 · 无模型调用" },
  ];

  return (
    <>
      <PageHeader title="历史版本" sub="每次生成与导出自动建立快照，可回溯查看与恢复" />
      <div className="stack-4" style={{ maxWidth: 720 }}>
        {versions.map((v) => (
          <div className="card pad-4 version-item" key={v.version} style={{ padding: 16, alignItems: "center" }}>
            <span className="vno">{v.version.slice(1)}</span>
            <span className="grow">
              <div style={{ fontSize: 13, fontWeight: 500 }}>{v.note}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{v.meta}</div>
            </span>
            <Button variant="secondary" size="sm">查看快照</Button>
          </div>
        ))}
      </div>
    </>
  );
}
