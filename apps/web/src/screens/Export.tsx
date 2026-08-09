import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, FileText, Loader2, ShieldAlert } from "lucide-react";
import { useStore } from "../lib/store";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Notice,
  PageHeader,
} from "../components/ui";
import { RULE_PACK_VERSION } from "../lib/pipeline";
import { renderFigurePage, renderReportPages } from "../lib/export-render";
import {
  DEFAULT_EXPORT_SELECTION,
  EXPORT_FILE_NAMES,
  EXPORT_ORDER,
  exportFileNotes,
  exportedFileNames,
  type ExportArtifactKey,
  type ExportProjectData,
  type ExportSelection,
} from "@patent/export/notes";

const FILE_LABELS: Record<ExportArtifactKey, string> = {
  bundle: "专利申请文件草案合集.docx",
  claims: "权利要求书.docx",
  specification: "说明书.docx",
  abstract: "说明书摘要.docx",
  figures: "说明书附图.pdf",
  report: "起草审阅报告.pdf",
  patentpack: "项目备份.patentpack（加密）",
};

const FILE_FMT: Record<ExportArtifactKey, string> = {
  bundle: "DOCX",
  claims: "DOCX",
  specification: "DOCX",
  abstract: "DOCX",
  figures: "PDF",
  report: "PDF",
  patentpack: "加密",
};

function now(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

export function ExportScreen() {
  const { id } = useParams();
  const { projects, updateProject } = useStore();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === id) ?? null;
  const [selected, setSelected] = useState<ExportSelection>({ ...DEFAULT_EXPORT_SELECTION });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unsupportedBlocked, setUnsupportedBlocked] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [pwdError, setPwdError] = useState("");

  const data = useMemo<ExportProjectData | null>(() => {
    if (!project) return null;
    const liveMeta = project.live
      ? Object.values(project.live.ctx.results).find((r) => r?.meta)?.meta
      : undefined;
    const aiRecord = liveMeta
      ? `${liveMeta.provider}${liveMeta.model ? ` · ${liveMeta.model}` : ""} · prompt ${liveMeta.promptVersion} · 规则包 ${liveMeta.rulePackVersion}`
      : project.versions[0]?.meta ?? `规则包 ${RULE_PACK_VERSION}`;
    return {
      name: project.name,
      patentType: project.patentType,
      claims: project.claims.map((c) => ({ id: c.id, label: c.label, text: c.text })),
      specSections: project.specSections.map((s) => ({ id: s.id, title: s.title, body: s.body })),
      abstractText: project.abstractText,
      figures: project.figures.map((f) => ({
        id: f.id,
        title: f.title,
        mode: f.mode,
        badge: f.badge,
        previewLabel: f.previewLabel,
      })),
      audit: project.audit
        ? {
            passed: project.audit.passed,
            warnings: project.audit.warnings,
            errors: project.audit.errors,
            rows: project.audit.rows.map((r) => ({ feature: r.feature, status: r.status, source: r.source })),
            checks: project.audit.checks.map((c) => ({ icon: c.icon, text: c.text })),
          }
        : null,
      versions: project.versions,
      rulePackVersion: RULE_PACK_VERSION,
      aiRecord,
    };
  }, [project]);

  const notes = useMemo(() => (data ? exportFileNotes(data) : null), [data]);
  if (!project || !data || !notes) return null;

  const audit = project.audit;
  const noneFeatures = (audit?.rows ?? []).filter((r) => r.status === "none").map((r) => r.feature);
  const errorChecks = (audit?.checks ?? []).filter((c) => c.icon === "err").map((c) => c.text);
  const anyFormalSelected = EXPORT_ORDER.some((k) => k !== "patentpack" && selected[k]);

  const doExport = async (pwd?: string) => {
    setError("");
    setBusy(true);
    try {
      const { assembleExportArtifacts, buildZip, sanitizeFileName } = await import("@patent/export");
      const artifacts = await assembleExportArtifacts(data, selected, {
        passphrase: pwd,
        renderReport: renderReportPages,
        renderFigure: renderFigurePage,
      });
      const zip = buildZip(artifacts.map((a) => ({ name: a.fileName, data: a.data })));
      const zipBuf = new ArrayBuffer(zip.byteLength);
      new Uint8Array(zipBuf).set(zip);
      const blob = new Blob([zipBuf], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFileName(project.name)}-草案包.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      updateProject(project.id, {
        versions: [
          {
            version: `v${project.versions.length + 1}`,
            note: `导出：${exportedFileNames(artifacts)}`,
            meta: `${now()} · 本机导出 · 规则包 ${RULE_PACK_VERSION}`,
          },
          ...project.versions,
        ],
      });
      setDone(true);
      setPwdOpen(false);
      setPassphrase("");
    } catch (e) {
      setError((e as Error).message || "导出失败");
      setPwdError((e as Error).message || "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const onExportClick = () => {
    if (!anyFormalSelected && !selected.patentpack) {
      setError("请至少选择一个文件后再导出");
      return;
    }
    setError("");
    if (anyFormalSelected && audit && audit.errors > 0) {
      setUnsupportedBlocked(true);
      return;
    }
    setUnsupportedBlocked(false);
    if (selected.patentpack) {
      setPwdError("");
      setPwdOpen(true);
      return;
    }
    void doExport();
  };

  return (
    <>
      <PageHeader title="导出申请文件草案包" sub="选择需要导出的文件，全部在本机生成" />
      <div className="stack-3" style={{ maxWidth: 720 }}>
        {EXPORT_ORDER.map((key) => {
          const isBlocked = key !== "patentpack" && unsupportedBlocked;
          return (
            <label
              key={key}
              className="file-row"
              style={{ cursor: "pointer", opacity: isBlocked ? 0.5 : 1 }}
            >
              <input
                type="checkbox"
                style={{ width: 16, height: 16, accentColor: "var(--primary)" }}
                checked={selected[key]}
                disabled={isBlocked}
                onChange={(e) => setSelected((s) => ({ ...s, [key]: e.target.checked }))}
              />
              <span className="ficon">
                <FileText size={16} />
              </span>
              <span className="grow">
                <span style={{ fontSize: 13, fontWeight: 500 }}>{FILE_LABELS[key]}</span>
                <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>{notes[key]}</span>
              </span>
              <Badge variant="outline" className="mono" style={{ fontSize: 11 }}>{FILE_FMT[key]}</Badge>
            </label>
          );
        })}
      </div>
      {unsupportedBlocked ? (
        <div className="notice mt-4" style={{ borderColor: "color-mix(in srgb, var(--destructive) 45%, transparent)" }}>
          <span className="ic">
            <ShieldAlert size={14} />
          </span>
          审校门禁：
          {noneFeatures.length > 0
            ? `存在无来源特征（${noneFeatures.join("、")}）。`
            : `存在 ${audit?.errors ?? 0} 项必须处理的审校问题${
                errorChecks.length > 0 ? `（如：${errorChecks[0].slice(0, 48)}…）` : ""
              }。`}
          正式申请文件导出已被阻止，请先在审校矩阵确认已处理或在工作台处理问题。
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${project.id}/audit`)}>
            去处理
          </Button>
        </div>
      ) : null}
      <div className="mt-4">
        <Notice>
          申请文件正文不含 AI 声明；AI 辅助标识仅出现在审阅报告与项目元数据中。导出前请人工审阅全部内容。文件在浏览器本机生成，打包为单个 zip 下载。
        </Notice>
      </div>
      {error && !pwdOpen ? (
        <div className="notice mt-3" style={{ borderColor: "color-mix(in srgb, var(--destructive) 45%, transparent)" }}>
          <span className="ic">
            <ShieldAlert size={14} />
          </span>
          {error}
        </div>
      ) : null}
      <div className="row mt-5" style={{ justifyContent: "flex-end" }}>
        <Button onClick={onExportClick} disabled={busy}>
          {busy ? (
            <>
              <Loader2 size={15} className="spin" />
              正在生成…
            </>
          ) : done ? (
            <>
              <CheckCircle2 size={15} />
              已在本机生成导出包
            </>
          ) : (
            "在本机生成导出包"
          )}
        </Button>
      </div>

      <Dialog open={pwdOpen} onOpenChange={(open) => { setPwdOpen(open); if (!open) setPwdError(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置备份口令</DialogTitle>
            <DialogDescription>
              已勾选「项目备份.patentpack（加密）」。请设置口令用于加密备份文件：PBKDF2-SHA-256（20 万次迭代）+ AES-256-GCM，口令不会保存，请务必牢记。
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={passphrase}
            placeholder="输入导出口令"
            aria-label="导出口令"
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && passphrase.trim()) void doExport(passphrase.trim());
            }}
          />
          {pwdError ? (
            <div className="muted" style={{ fontSize: 12, color: "var(--destructive)" }}>{pwdError}</div>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>取消</Button>
            </DialogClose>
            <Button onClick={() => doExport(passphrase.trim())} disabled={busy || !passphrase.trim()}>
              确认导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
