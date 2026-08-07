import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, Card, Notice, PageHeader } from "../components/ui";
import type { ProjectFile } from "../lib/types";
import { fetchStatus } from "../lib/bridge";

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
  const { projects, addFiles, runParse, updateProject, startLive } = useStore();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [bridgeState, setBridgeState] = useState<{ ok: boolean; configured: boolean } | null>(null);
  const project = projects.find((p) => p.id === id) ?? null;

  useEffect(() => {
    void fetchStatus().then((s) => setBridgeState({ ok: s.bridgeConnected, configured: s.credentialConfigured }));
  }, []);

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

      <Card className="mt-5">
        <div style={{ fontSize: 14, fontWeight: 600 }}>直接粘贴交底文本（真实起草）</div>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 12px", lineHeight: 1.7 }}>
          经本机 Bridge 调用 DeepSeek 逐阶段起草，材料与 Key 均不离开本机。
          {bridgeState && !bridgeState.ok ? " 当前未检测到 Bridge，请先启动并配对。" : ""}
          {bridgeState && bridgeState.ok && !bridgeState.configured ? " 已连接 Bridge，但尚未配置 API Key。" : ""}
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={8}
          placeholder="在此粘贴技术交底内容（例如：产品结构、通讯方式、技术效果等）。支持多个段落，每段一行。"
          aria-label="粘贴交底文本"
          style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
        />
        <div className="row mt-3" style={{ justifyContent: "flex-end" }}>
          <Button
            disabled={!project || pasteText.trim().length < 20 || busy || !bridgeState?.ok}
            onClick={async () => {
              if (!project) return;
              setBusy(true);
              try {
                await startLive(project.id, project.name, pasteText.trim());
                navigate(`/projects/${project.id}/intake`);
              } catch (e) {
                alert(`起草管线启动失败：${(e as Error).message}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "分析中…" : "开始真实起草"}
          </Button>
        </div>
      </Card>

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
