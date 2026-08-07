import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, Card, Notice, PageHeader } from "../components/ui";
import type { ProjectFile } from "../lib/types";
import { fetchStatus, type BridgeStatus } from "../lib/bridge";
import { extractFileText } from "../lib/extract";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_TEXT: Record<ProjectFile["parseStatus"], string> = {
  parsing: "解析中",
  ocr: "OCR 中",
  done: "✓ 已提取",
  failed: "解析失败",
};

export function Upload() {
  const { id } = useParams();
  const { projects, updateProject, patchFile, startLive } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [bridgeState, setBridgeState] = useState<BridgeStatus | null>(null);
  const project = projects.find((p) => p.id === id) ?? null;

  useEffect(() => {
    void fetchStatus().then((s) => setBridgeState(s));
  }, []);

  const onFiles = async (list: FileList | null) => {
    if (!list || !project) return;
    const incoming = Array.from(list);
    // Insert rows first so the UI shows progress, then parse in place.
    updateProject(project.id, {
      files: [
        ...(project.files ?? []),
        ...incoming.map((f) => ({
          id: `${f.name}-${f.size}-${f.lastModified}`,
          name: f.name,
          kind: f.name.split(".").pop()?.toUpperCase() ?? "FILE",
          sizeLabel: fmtSize(f.size),
          parseStatus: "parsing" as const,
          detail: "正在本机解析",
        })),
      ],
      status: "uploading",
      statusLabel: "解析中",
    });
    for (const f of incoming) {
      const fileId = `${f.name}-${f.size}-${f.lastModified}`;
      const result = await extractFileText(f);
      patchFile(project.id, fileId, {
        parseStatus: result.text ? "done" : "failed",
        detail: result.note,
        text: result.text ?? undefined,
      });
    }
  };

  const removeFile = (fileId: string) => {
    if (!project) return;
    updateProject(project.id, { files: (project.files ?? []).filter((f) => f.id !== fileId) });
  };

  const fileText = (project?.files ?? [])
    .map((f) => f.text ?? "")
    .filter((t) => t.trim().length > 0)
    .join("\n\n");
  const pasted = pasteText.trim();
  const combined = [fileText, pasted].filter((t) => t.length > 0).join("\n\n");
  const readyChars = combined.length;
  const parsing = (project?.files ?? []).some((f) => f.parseStatus === "parsing");

  const startDraft = async () => {
    if (!project || readyChars < 20 || busy || parsing) return;
    if (bridgeState && !bridgeState.authenticated) {
      if (bridgeState.mode === "cloud") {
        navigate(`/unlock?next=${encodeURIComponent(location.pathname)}`);
      } else {
        // Local bridge mode: pairing/key entry lives on the Settings screen.
        navigate("/settings");
      }
      return;
    }
    setBusy(true);
    try {
      await startLive(project.id, project.name, combined);
      navigate(`/projects/${project.id}/intake`);
    } catch (e) {
      alert(`起草管线启动失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="上传交底材料"
        sub="支持 DOCX / PDF / TXT / MD 附件与直接粘贴文本，可同时使用。附件仅在本机浏览器中解析，不会上传。"
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
        <div className="hint">DOCX · PDF · TXT · MD（单个 ≤ 50MB）；旧版 .doc 与图片请另存或粘贴文字</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".docx,.pdf,.txt,.md"
          aria-label="选择交底材料文件（DOCX、PDF 或纯文本）"
          style={{ display: "none" }}
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = "";
          }}
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
              <span className="muted" style={{ fontSize: 12, color: f.parseStatus === "failed" ? "var(--destructive)" : undefined }}>
                {STATUS_TEXT[f.parseStatus]}
              </span>
              <button
                className="link-button"
                style={{ fontSize: 12 }}
                aria-label={`移除附件 ${f.name}`}
                onClick={() => removeFile(f.id)}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Card className="mt-5">
        <div style={{ fontSize: 14, fontWeight: 600 }}>粘贴交底文本（可与附件同时使用）</div>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 12px", lineHeight: 1.7 }}>
          附件提取的文字会与这里粘贴的内容合并为一份材料，经安全通道调用 DeepSeek 逐阶段起草。
          {bridgeState && !bridgeState.bridgeConnected
            ? bridgeState.mode === "cloud"
              ? " 当前云端服务不可达，请稍后再试。"
              : " 当前未检测到 Bridge，请先启动并配对。"
            : ""}
          {bridgeState && bridgeState.bridgeConnected && !bridgeState.authenticated && bridgeState.mode === "local"
            ? " 已连接 Bridge，但尚未配对或配置 API Key。"
            : ""}
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={8}
          placeholder="在此粘贴技术交底内容（例如：产品结构、通讯方式、技术效果等）。支持多个段落，每段一行。"
          aria-label="粘贴交底文本"
          style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
        />
        <div className="row-between mt-3">
          <span className="muted" style={{ fontSize: 12 }}>
            {readyChars > 0 ? `已就绪材料共 ${readyChars.toLocaleString()} 字` : "请先添加附件或粘贴文本（至少 20 字）"}
            {parsing ? " · 附件解析中…" : ""}
          </span>
          {bridgeState?.mode === "cloud" && !bridgeState.authenticated ? (
            <Button onClick={() => navigate(`/unlock?next=${encodeURIComponent(location.pathname)}`)}>输入访问密码</Button>
          ) : (
            <Button disabled={!project || readyChars < 20 || busy || parsing || !bridgeState?.bridgeConnected} onClick={() => void startDraft()}>
              {busy ? "分析中…" : "开始真实起草"}
            </Button>
          )}
        </div>
      </Card>

      <div className="mt-5">
        <Notice>
          附件与粘贴的内容仅在本机浏览器中解析与合并；起草时经加密通道发送给模型服务，服务端不保存你的材料。
          想先逛逛？回到项目首页可以载入示例项目（热水表）。
        </Notice>
      </div>
    </>
  );
}
