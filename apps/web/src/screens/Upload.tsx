import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, Card, Notice, PageHeader } from "../components/ui";
import type { ProjectFile } from "../lib/types";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_TEXT: Record<ProjectFile["parseStatus"], string> = {
  parsing: "解析中",
  ocr: "OCR 中",
  done: "✓ 解析完成",
  failed: "解析失败",
};

export function Upload() {
  const { id } = useParams();
  const { projects, addFiles, runParse, updateProject } = useStore();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const project = projects.find((p) => p.id === id) ?? null;

  const onFiles = (list: FileList | null) => {
    if (!list || !project) return;
    const files: ProjectFile[] = Array.from(list).map((f) => ({
      id: f.name,
      name: f.name,
      kind: f.name.split(".").pop()?.toUpperCase() ?? "FILE",
      sizeLabel: fmtSize(f.size),
      parseStatus: "parsing",
      detail: "等待解析",
    }));
    addFiles(project.id, files);
  };

  return (
    <>
      <PageHeader
        title="上传交底材料"
        sub="支持 Office 文档、PDF、图片与纯文本，最多 10 个附件。文件仅在本机解析。"
        actions={
          <Button variant="ghost" onClick={() => navigate("/projects")}>
            ← 返回项目
          </Button>
        }
      />
      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onFiles(e.dataTransfer.files);
        }}
      >
        <div>拖放文件到此处，或点击选择</div>
        <div className="hint">DOC · DOCX · PDF · TXT · MD · PNG · JPEG（单个 ≤ 50MB）</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".doc,.docx,.pdf,.txt,.md,.png,.jpeg,.jpg"
          aria-label="选择交底材料文件（Office 文档、PDF、图片或纯文本）"
          style={{ display: "none" }}
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      {project && project.files.length > 0 ? (
        <div className="stack-3 mt-5">
          {project.files.map((f) => (
            <div className="file-row" key={f.id}>
              <span className="ficon">▤</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {f.name}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {f.kind} · {f.sizeLabel} · {f.detail}
                </div>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>{STATUS_TEXT[f.parseStatus]}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-5">
        <Notice>
          文件内容仅在本机 Bridge 中解析与存储，不会上传到服务器。旧版 .doc 将自动在本机转换。
        </Notice>
      </div>

      <div className="row mt-5" style={{ justifyContent: "flex-end" }}>
        <Button
          variant="secondary"
          onClick={() => {
            if (!project) return;
            // 演示模式：无文件也可用示例材料进入分析
            updateProject(project.id, {
              files: [
                {
                  id: "sample-doc",
                  name: "技术交底：一种基于三模通讯的共享热水表（冯立平） 2022.12.14.doc",
                  kind: "DOC",
                  sizeLabel: "450 KB",
                  parseStatus: "done",
                  detail: "已解析 12 页 · 提取文本 5,306 字",
                },
              ],
            });
          }}
        >
          载入示例交底
        </Button>
        <Button
          disabled={!project || (project.files.length === 0 && !project.demo)}
          onClick={() => {
            if (!project) return;
            runParse(project.id);
            navigate(`/projects/${project.id}/readiness`);
          }}
        >
          开始解析
        </Button>
      </div>
    </>
  );
}
