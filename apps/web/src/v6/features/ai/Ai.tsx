/**
 * V6-15 — AI and data panel (S04).
 *
 * `AiPanel` is pure and server-renderable: every value shown comes from the
 * view model produced by `loadAiView`. `AiPage` is the mounted container the
 * orchestrator registers for the top-level `ai` tab; it owns matter/target
 * selection and the grant/revoke commands. All styling is inline in this file;
 * `v6.css` and the shared navigation are untouched.
 *
 * The panel never claims a local model is available, never shows the release
 * gate as open, and the invocation table projects only contract metadata — no
 * prompt, document text, content field or key can reach it (see
 * `toSafeInvocationRow`).
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { v6Path } from "../../routes/navigation.ts";
import { Body, Pane, Toolbar } from "../../components/ui/index.ts";

import type { Actor, LocalRepository, MatterRecord } from "../../lib/repository.ts";
import { readGenerationStatus, type GenerationStatus } from "../generation/remote-provider.ts";
import { endGenerationSession } from "../generation/runtime.ts";
import { technicalDetailLabel, userMessageFor } from "../../lib/user-messages.ts";
import {
  AI_PURPOSES,
  grantConsent,
  loadAiView,
  purposeLabel,
  revokeConsent,
  type AiError,
  type AiView,
  type ConsentView,
  type PayloadManifest,
  type ProviderProfileView,
  type ProviderPurpose,
  type SafeInvocationRow,
} from "./ai.ts";

// The panel needs the concrete capability element type; the module exports the
// view rather than every part of it.
type CapabilityView = AiView["capabilities"][number];

export interface AiPanelProps {
  view: AiView | null;
  loading: boolean;
  loadError: AiError | null;
  purpose: ProviderPurpose;
  busy: boolean;
  actionError?: AiError | null;
  notice?: string | null;
  onPurposeChange?: (purpose: ProviderPurpose) => void;
  onGrant?: (providerProfileId: string) => void;
  onRevoke?: (consentId: string) => void;
  onReload?: () => void;
  onOpenMatter?: () => void;
  onOpenDraft?: () => void;
  /**
   * Live platform status from `GET /api/v6/status`. `undefined` means it was not
   * read (pure render/tests), `null` means the read failed.
   */
  status?: GenerationStatus | null;
  onRefreshStatus?: () => void;
  /** Ends only this browser's drafting session; cases and records stay untouched. */
  onEndSession?: () => void;
  endingSession?: boolean;
  sessionError?: string | null;
}

const UNKNOWN = "未知";

const S = {
  panel: {
    display: "grid",
    gap: "14px",
    color: "var(--foreground, #1b1915)",
  } satisfies CSSProperties,
  page: {
    display: "grid",
    gap: "14px",
    width: "100%",
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "24px",
    boxSizing: "border-box",
    color: "var(--foreground, #1d1d1f)",
  } satisfies CSSProperties,
  banner: {
    border: "1px solid var(--border, #e6e2d8)",
    borderRadius: "8px",
    padding: "12px 14px",
    background: "var(--muted, #f2f0ea)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  warning: {
    border: "1px solid color-mix(in srgb, var(--warning, #865600) 32%, var(--border, #dadada))",
    borderRadius: "8px",
    padding: "12px 14px",
    background: "color-mix(in srgb, var(--warning, #865600) 8%, var(--card, #ffffff))",
    color: "var(--foreground, #1d1d1f)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  error: {
    border: "1px solid color-mix(in srgb, var(--destructive, #c0261b) 32%, var(--border, #dadada))",
    borderRadius: "8px",
    padding: "12px 14px",
    background: "color-mix(in srgb, var(--destructive, #c0261b) 8%, var(--card, #ffffff))",
    color: "var(--foreground, #1d1d1f)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  section: {
    border: "1px solid var(--border, #e6e2d8)",
    borderRadius: "10px",
    padding: "16px",
    background: "var(--card, #ffffff)",
  } satisfies CSSProperties,
  sectionTitle: {
    margin: "0 0 10px",
    fontSize: "16px",
    fontWeight: 600,
  } satisfies CSSProperties,
  muted: {
    color: "var(--muted-foreground, #6f6a60)",
    fontSize: "13px",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
  } satisfies CSSProperties,
  th: {
    textAlign: "left",
    borderBottom: "1px solid var(--border, #e6e2d8)",
    padding: "6px 8px",
    fontWeight: 600,
  } satisfies CSSProperties,
  td: {
    borderBottom: "1px solid var(--border, #e6e2d8)",
    padding: "6px 8px",
    verticalAlign: "top",
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border, #e6e2d8)",
    borderRadius: "8px",
    padding: "14px",
    display: "grid",
    gap: "10px",
  } satisfies CSSProperties,
  cardHeader: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "8px",
  } satisfies CSSProperties,
  fields: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "6px 14px",
    fontSize: "13px",
  } satisfies CSSProperties,
  fieldLabel: {
    color: "var(--muted-foreground, #6f6a60)",
    marginRight: "6px",
  } satisfies CSSProperties,
  tech: {
    marginTop: "4px",
    fontSize: "12px",
    color: "var(--muted-foreground, #6f6a60)",
  } satisfies CSSProperties,
  unknown: {
    color: "var(--warning, #865600)",
    fontWeight: 600,
  } satisfies CSSProperties,
  button: {
    border: "1px solid var(--border, #e6e2d8)",
    borderRadius: "6px",
    padding: "6px 12px",
    background: "var(--card, #ffffff)",
    cursor: "pointer",
    fontSize: "13px",
  } satisfies CSSProperties,
  primaryButton: {
    border: "1px solid var(--primary, #0a64d6)",
    borderRadius: "6px",
    padding: "6px 12px",
    background: "var(--primary, #0a64d6)",
    color: "var(--primary-foreground, #ffffff)",
    cursor: "pointer",
    fontSize: "13px",
  } satisfies CSSProperties,
  disabledButton: {
    border: "1px solid var(--border, #e6e2d8)",
    borderRadius: "6px",
    padding: "6px 12px",
    background: "var(--muted, #f2f0ea)",
    color: "var(--muted-foreground, #6f6a60)",
    cursor: "not-allowed",
    fontSize: "13px",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
  } satisfies CSSProperties,
  hash: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "12px",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  badge: {
    display: "inline-block",
    border: "1px solid var(--border, #e6e2d8)",
    borderRadius: "999px",
    padding: "1px 8px",
    fontSize: "12px",
  } satisfies CSSProperties,
  staleBadge: {
    display: "inline-block",
    border: "1px solid color-mix(in srgb, var(--warning, #865600) 32%, var(--border, #dadada))",
    borderRadius: "6px",
    padding: "1px 8px",
    fontSize: "12px",
    background: "color-mix(in srgb, var(--warning, #865600) 8%, var(--card, #ffffff))",
    color: "var(--warning, #865600)",
  } satisfies CSSProperties,
  grid: {
    display: "grid",
    gap: "12px",
  } satisfies CSSProperties,
  empty: {
    border: "1px dashed var(--border, #e6e2d8)",
    borderRadius: "8px",
    padding: "20px",
    textAlign: "center",
    color: "var(--muted-foreground, #6f6a60)",
    lineHeight: 1.7,
  } satisfies CSSProperties,
} as const;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return UNKNOWN;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusText(status: ConsentView["status"]): string {
  if (status === "active") return "生效中";
  if (status === "revoked") return "已撤回";
  return "已过期";
}

function matterStatusText(status: MatterRecord["status"]): string {
  if (status === "active") return "进行中";
  if (status === "archived") return "已归档";
  return "待删除";
}

function capabilityStateText(state: CapabilityView["state"]): string {
  return state === "available" ? "可用" : "不可用";
}

type ServiceState = "unknown" | "unreachable" | "unconfigured" | "unavailable" | "auth_required" | "ready";

/** Everything shown here comes from the status endpoint; nothing is assumed. */
function servicePresentation(status: GenerationStatus | null | undefined): { state: ServiceState; title: string; body: string } {
  if (status === undefined) return {
    state: "unknown",
    title: "平台起草服务：正在读取状态",
    body: "读取完成之前不声称真实外发可用。",
  };
  if (status === null) return {
    state: "unreachable",
    title: "平台起草服务：无法读取状态",
    body: "状态接口没有返回结果；真实起草不可用。稍后可以重试。",
  };
  if (!status.configured) return {
    state: "unconfigured",
    title: "平台起草服务：未配置",
    body: status.unavailableReason ?? "服务端配置不完整，真实起草不可用。",
  };
  if (!status.available) return {
    state: "unavailable",
    title: "平台起草服务：当前不可用",
    body: status.unavailableReason ?? "限流存储或处理方披露不满足要求，真实起草不可用。",
  };
  if (!status.authenticated) return {
    state: "auth_required",
    title: "平台起草服务：可用，需要访问码",
    body: "服务端配置与处理方披露完整；在起草页建立访问会话后才能选择真实起草。",
  };
  return {
    state: "ready",
    title: "平台起草服务：可用",
    body: "访问会话已建立。真实起草目前只覆盖中国实用新型中文准备稿，且每次调用前都会重新核对授权与材料范围。",
  };
}

function knownValue(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && text !== "unknown" && text !== "未知" ? text : null;
}

function ServiceStatus({
  status,
  onRefresh,
  onEndSession,
  endingSession = false,
  sessionError = null,
}: {
  status: GenerationStatus | null | undefined;
  onRefresh?: () => void;
  onEndSession?: () => void;
  endingSession?: boolean;
  sessionError?: string | null;
}) {
  const presentation = servicePresentation(status);
  const fields: readonly { label: string; value: string | null; testId: string }[] = status ? [
    { label: "处理方", value: knownValue(status.processor.name), testId: "ai-service-processor" },
    { label: "区域", value: knownValue(status.processor.region), testId: "ai-service-region" },
    { label: "保留", value: knownValue(status.processor.retention), testId: "ai-service-retention" },
    {
      label: "训练用途",
      value: status.processor.trainingPolicy === "no_training"
        ? "不用于训练"
        : status.processor.trainingPolicy === "allowed" ? "处理方政策允许训练用途" : null,
      testId: "ai-service-training",
    },
    { label: "模型", value: knownValue(status.model), testId: "ai-service-model" },
  ] : [];
  const tone = presentation.state === "ready" ? S.banner : S.warning;
  return (
    <div style={tone} data-testid="ai-service-status" data-state={presentation.state}>
      <strong>{presentation.title}</strong>
      <div>{presentation.body}</div>
      {fields.length > 0 && (
        <div style={{ ...S.fields, marginTop: "8px" }}>
          {fields.map((field) => (
            <div key={field.testId} data-testid={field.testId} data-known={field.value === null ? "false" : "true"}>
              <span style={S.fieldLabel}>{field.label}</span>
              <span style={field.value === null ? S.unknown : undefined}>{field.value === null ? `「${UNKNOWN}」` : field.value}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
        {onRefresh && (
          <button type="button" style={S.button} data-testid="ai-service-refresh" onClick={onRefresh}>
            重新读取服务状态
          </button>
        )}
        {onEndSession && status?.authenticated === true && (
          <button type="button" style={S.button} data-testid="ai-service-end-session"
            disabled={endingSession} onClick={onEndSession}>
            {endingSession ? "正在退出…" : "退出起草会话"}
          </button>
        )}
      </div>
      {status?.authenticated === true ? (
        <div style={S.muted} data-testid="ai-session-scope">
          退出只清除当前浏览器中的起草会话，不删除案件、草稿或授权记录。已复制到其他位置的访问凭证无法在这里吊销。
        </div>
      ) : null}
      {sessionError !== null ? (
        <div style={{ ...S.error, marginTop: "8px" }} role="alert" data-testid="ai-session-error">{sessionError}</div>
      ) : null}
    </div>
  );
}

/** The platform capability is reported from the live status, not from configuration defaults. */
function platformCapability(
  status: GenerationStatus | null | undefined,
): { state: CapabilityView["state"]; reason: string } {
  if (status === undefined) return { state: "unavailable", reason: "正在读取平台服务状态；读取完成前不声称真实外发可用。" };
  if (status === null) return { state: "unavailable", reason: "无法读取平台服务状态；真实起草不可用。" };
  if (!status.configured) return { state: "unavailable", reason: status.unavailableReason ?? "平台起草服务未配置。" };
  if (!status.available) return { state: "unavailable", reason: status.unavailableReason ?? "平台起草服务当前不可用。" };
  if (!status.authenticated) return { state: "available", reason: "平台处理方已配置；需要访问码建立会话后才能发起真实起草。" };
  return { state: "available", reason: "平台处理方已配置，访问会话已建立；真实起草只在中国实用新型中文准备稿上使用本次授权的材料。" };
}

const EXECUTION_LABELS: Readonly<Record<"stub" | "provider", string>> = Object.freeze({
  stub: "测试",
  provider: "真实",
});

/** ISO time in the viewer's locale; null (rows from older builds) is shown as 「—」. */
export function invocationTimeText(at: string | null): string {
  if (at === null || at.trim().length === 0) return "—";
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function invocationExecutionText(row: Pick<SafeInvocationRow, "execution" | "executionLocation">): string {
  if (row.execution === null) return "—";
  return EXECUTION_LABELS[row.execution];
}

function invocationStatusText(status: SafeInvocationRow["status"]): string {
  if (status === "started") return "进行中";
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  return "已取消";
}

function Field({
  label,
  field,
  testId,
}: {
  label: string;
  field: ProviderProfileView["fields"][keyof ProviderProfileView["fields"]];
  testId: string;
}) {
  return (
    <div data-testid={testId} data-known={field.known ? "true" : "false"}>
      <span style={S.fieldLabel}>{label}</span>
      <span style={field.known ? undefined : S.unknown}>{field.known ? field.display : `「${UNKNOWN}」`}</span>
    </div>
  );
}

function CapabilityList({ capabilities, status }: { capabilities: readonly CapabilityView[]; status: GenerationStatus | null | undefined }) {
  const modes = [
    { mode: "local" as const, title: "本机模型", description: "模型和材料都留在本机处理。" },
    { mode: "platform" as const, title: "平台模型", description: "由已配置的平台处理方处理；使用前需要明确外发授权。" },
    { mode: "byok" as const, title: "自带密钥", description: "使用者自行管理模型密钥；此浏览器版不保存密钥。" },
  ];
  const testMode = capabilities.find((capability) => capability.mode === "stub");
  const platform = servicePresentation(status);
  return (
    <section style={S.section} data-testid="ai-capabilities">
      <h2 style={S.sectionTitle}>处理方式</h2>
      <p style={S.muted} data-testid="ai-current-mode">
        当前版本：R1 本地浏览器版。测试处理方产生标记为「测试输出」的固定结果，不调用真实模型。平台起草服务{platform.state === "ready"
          ? "可用，但只覆盖中国实用新型中文准备稿"
          : platform.state === "auth_required" ? "可用，需要访问码建立会话"
            : platform.state === "unavailable" ? "当前不可用"
              : platform.state === "unconfigured" ? "尚未配置"
                : platform.state === "unreachable" ? "状态无法读取，真实外发不可用"
                  : "状态正在读取"}。
      </p>
      <div className="v6-ai-methods">
        {modes.map(({ mode, title, description }) => {
          const capability = capabilities.find((item) => item.mode === mode);
          const shown = mode === "platform" ? platformCapability(status) : null;
          const state = shown?.state ?? capability?.state ?? "unavailable";
          const reason = shown?.reason ?? capability?.reason ?? "当前没有能力记录。";
          return <div key={mode} className="v6-ai-method" style={S.card} data-testid={`ai-capability-${mode}`} data-state={state}>
            <div style={S.cardHeader}><strong>{title}</strong><span style={S.badge}>{capabilityStateText(state)}</span></div>
            <p style={S.muted}>{description}</p>
            <p style={S.muted}>{reason}</p>
          </div>;
        })}
      </div>
      <div className="v6-ai-method-test" data-testid="ai-test-mode" data-state={testMode?.state ?? "unavailable"}>
        <strong>本地测试处理</strong>
        <p style={S.muted}>{testMode?.reason ?? "没有配置可用的测试处理方。"}</p>
      </div>
    </section>
  );
}

function ProfileCard({
  profile,
  purpose,
  busy,
  hasManifest,
  matterArchived,
  onGrant,
}: {
  profile: ProviderProfileView;
  purpose: ProviderPurpose;
  busy: boolean;
  hasManifest: boolean;
  matterArchived: boolean;
  onGrant: () => void;
}) {
  const purposeAllowed = profile.allowedPurposes.includes(purpose);
  const grantable = profile.consent.canGrant && purposeAllowed && hasManifest && !matterArchived;
  let reason = profile.consent.reason;
  if (grantable) reason = `将为「${purposeLabel(purpose)}」用途保存外发授权；保存不会发起调用。`;
  else if (profile.consent.canGrant && !matterArchived && !hasManifest) reason = "先建立案件并查看材料清单，才能保存授权。";
  else if (profile.consent.canGrant && matterArchived) reason = "案件已归档，不能新增授权。";
  else if (profile.consent.canGrant && !purposeAllowed) reason = `该处理方没有声明「${purposeLabel(purpose)}」用途。`;

  return (
    <div style={S.card} data-testid={`ai-profile-${profile.id}`} data-grantable={grantable ? "true" : "false"}>
      <div style={S.cardHeader}>
        <div>
          <strong>{profile.fields.processorName.display}</strong>{" "}
          <span style={S.muted}>
            v{profile.version} · {profile.modeLabel} · {profile.statusLabel}
          </span>
        </div>
        <span style={S.badge}>{profile.consent.required ? "需要外发授权" : "不需要外发授权"}</span>
      </div>
      <div style={S.fields}>
        <Field
          label="处理方"
          field={profile.fields.processorName}
          testId={`ai-profile-processor-${profile.id}`}
        />
        <Field label="处理地区" field={profile.fields.processingRegion} testId={`ai-profile-region-${profile.id}`} />
        <Field
          label="保留策略"
          field={profile.fields.retentionPolicyVersion}
          testId={`ai-profile-retention-${profile.id}`}
        />
        <Field label="训练策略" field={profile.fields.trainingPolicy} testId={`ai-profile-training-${profile.id}`} />
        <Field label="条款版本" field={profile.fields.termsVersion} testId={`ai-profile-terms-${profile.id}`} />
        <div>
          <span style={S.fieldLabel}>模型</span>
          {profile.modelId}
        </div>
        <div>
          <span style={S.fieldLabel}>可用用途</span>
          {profile.allowedPurposes.length > 0
            ? profile.allowedPurposes.map((value) => profile.purposeLabels[value]).join("、")
            : "无"}
        </div>
        <div data-testid={`ai-profile-capabilities-${profile.id}`}>
          <span style={S.fieldLabel}>能力</span>
          结构化输出 {profile.capabilities.structuredOutput ? "是" : "否"} · 视觉输入{" "}
          {profile.capabilities.visionInput ? "是" : "否"} · 上下文{" "}
          {profile.capabilities.contextWindowTokens ?? `「${UNKNOWN}」`} · 最大输出{" "}
          {profile.capabilities.maxOutputTokens ?? `「${UNKNOWN}」`}
        </div>
      </div>
      <div style={S.row}>
        <button
          type="button"
          style={grantable && !busy ? S.primaryButton : S.disabledButton}
          disabled={!grantable || busy}
          data-testid={`ai-grant-${profile.id}`}
          data-grantable={grantable ? "true" : "false"}
          onClick={onGrant}
        >
          保存外发授权
        </button>
        <span style={S.muted} data-testid={`ai-grant-reason-${profile.id}`}>
          {reason ?? (grantable ? "可以保存授权。" : "当前不能保存授权。")}
        </span>
      </div>
    </div>
  );
}

function ManifestSection({ manifest }: { manifest: PayloadManifest }) {
  return (
    <section style={S.section} data-testid="ai-manifest">
      <h2 style={S.sectionTitle}>将外发的材料</h2>
      <p style={S.muted}>
        以下清单由案件当前状态生成。清单摘要绑定文件、事实、段落、草稿与附图；任何一项变化都会让旧授权失效（S04-A02）。
      </p>
      {manifest.files.length === 0 ? (
        <div style={S.empty} data-testid="ai-manifest-files-empty">
          当前没有可外发的来源文件。
        </div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>文件</th>
              <th style={S.th}>页数</th>
              <th style={S.th}>大小</th>
            </tr>
          </thead>
          <tbody>
            {manifest.files.map((file) => (
              <tr key={file.assetId} data-testid={`ai-manifest-file-${file.assetId}`}>
                <td style={S.td}>{file.name}</td>
                <td style={S.td} data-testid={`ai-manifest-pages-${file.assetId}`}>
                  {file.pageCount === null ? `「${UNKNOWN}」` : file.pageCount}
                </td>
                <td style={S.td}>{formatBytes(file.byteLength)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ ...S.fields, marginTop: "10px" }}>
        <div data-testid="ai-manifest-source-version">
          <span style={S.fieldLabel}>来源版本</span>
          {manifest.sourceVersion}
        </div>
        <div data-testid="ai-manifest-facts">
          <span style={S.fieldLabel}>事实数量</span>
          {manifest.factCount}
        </div>
        <div data-testid="ai-manifest-chunks">
          <span style={S.fieldLabel}>段落数量</span>
          {manifest.chunkIds.length}
        </div>
        <div data-testid="ai-manifest-drafts">
          <span style={S.fieldLabel}>草稿版本</span>
          {manifest.draftRevisionIds.length}
        </div>
        <div data-testid="ai-manifest-figures">
          <span style={S.fieldLabel}>附图版本</span>
          {manifest.figureRevisionIds.length}
        </div>
      </div>
      <div style={{ marginTop: "10px" }}>
        <span style={S.fieldLabel}>清单摘要</span>
        <code style={S.hash} data-testid="ai-manifest-hash">
          {manifest.payloadManifestHash}
        </code>
      </div>
    </section>
  );
}

function ConsentSection({
  consents,
  staleConsentIds,
  busy,
  onRevoke,
}: {
  consents: readonly ConsentView[];
  staleConsentIds: readonly string[];
  busy: boolean;
  onRevoke: (consentId: string) => void;
}) {
  const stale = new Set(staleConsentIds);
  return (
    <section style={S.section} data-testid="ai-consent-list">
      <h2 style={S.sectionTitle}>外发授权记录</h2>
      <p style={S.muted} data-testid="ai-revocation-note">
        撤回只阻止后续调用；已经发出的调用无法撤回。撤回是追加记录，历史授权仍保留在记录中。
      </p>
      {consents.length === 0 ? (
        <div style={S.empty} data-testid="ai-consents-empty">
          还没有保存外发授权。
        </div>
      ) : (
        <div style={S.grid}>
          {consents.map((consent) => {
            const isStale = stale.has(consent.id) || consent.stale;
            return (
              <div key={consent.id} style={S.card} data-testid={`ai-consent-${consent.id}`}>
                <div style={S.cardHeader}>
                  <strong>
                    {consent.processorName} · {purposeLabel(consent.purpose)}
                  </strong>
                  <span style={isStale ? S.staleBadge : S.badge}>
                    {statusText(consent.status)}
                    {isStale && consent.status === "active" ? " · 材料已变化" : ""}
                  </span>
                </div>
                <div style={S.muted}>
                  处理地区 {consent.processingRegion} · 保留 {consent.retentionPolicyVersion} · 训练{" "}
                  {consent.trainingPolicy === "no_training" ? "不用于训练" : "允许用于训练"} · 条款{" "}
                  {consent.termsVersion}
                </div>
                <div style={S.muted} data-testid={`ai-consent-scope-${consent.id}`}>
                  范围：来源版本 {consent.scope.sourceVersion} · 文件 {consent.scope.assetCount} · 事实{" "}
                  {consent.scope.factCount} · 段落 {consent.scope.chunkCount} · 草稿{" "}
                  {consent.scope.draftRevisionCount} · 附图 {consent.scope.figureRevisionCount}
                </div>
                <div style={S.row}>
                  <button
                    type="button"
                    style={consent.status === "active" && !busy ? S.button : S.disabledButton}
                    disabled={consent.status !== "active" || busy}
                    data-testid={`ai-revoke-${consent.id}`}
                    onClick={() => onRevoke(consent.id)}
                  >
                    撤回授权
                  </button>
                  <span style={S.muted}>
                    保存于 {consent.createdAt}
                    {consent.revokedAt ? ` · 撤回于 ${consent.revokedAt}` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function InvocationSection({ rows }: { rows: readonly SafeInvocationRow[] }) {
  return (
    <section style={S.section} data-testid="ai-invocations">
      <h2 style={S.sectionTitle}>模型调用记录</h2>
      <p style={S.muted}>
        本表只列当前案件的调用元数据，不含提示词、案件正文或密钥。本机测试输出与真实外发分开标记；失败原因
        以中文显示，英文错误码放在「技术详情」里。
      </p>
      {rows.length === 0 ? (
        <div style={S.empty} data-testid="ai-invocations-empty">
          没有调用记录。
        </div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>时间</th>
              <th style={S.th}>测试 / 真实</th>
              <th style={S.th}>阶段</th>
              <th style={S.th}>作业 / 尝试</th>
              <th style={S.th}>处理方</th>
              <th style={S.th}>模型</th>
              <th style={S.th}>授权</th>
              <th style={S.th}>状态</th>
              <th style={S.th}>用量</th>
              <th style={S.th}>费用</th>
              <th style={S.th}>请求摘要</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-testid={`ai-invocation-${row.id}`}>
                <td style={S.td} data-testid={`ai-invocation-time-${row.id}`}>{invocationTimeText(row.at)}</td>
                <td style={S.td} data-testid={`ai-invocation-execution-${row.id}`}>
                  {invocationExecutionText(row)}
                  {row.executionLocation !== null ? <div style={S.tech}>{row.executionLocation}</div> : null}
                </td>
                <td style={S.td}>{row.stage}</td>
                <td style={{ ...S.td, ...S.hash }}>
                  {row.jobId.slice(0, 8)}… / {row.attempt}
                </td>
                <td style={S.td}>{row.providerProfileId}</td>
                <td style={S.td}>{row.modelId}</td>
                <td style={{ ...S.td, ...S.hash }}>{row.consentId ?? "无"}</td>
                <td style={S.td} data-testid={`ai-invocation-status-${row.id}`}>
                  {invocationStatusText(row.status)}
                  {row.status === "failed" ? (
                    <>
                      <span> · {userMessageFor(row.errorCode)}</span>
                      {row.errorCode !== null ? (
                        <details style={S.tech}>
                          <summary>技术详情</summary>
                          <code>{technicalDetailLabel(row.errorCode)}</code>
                        </details>
                      ) : null}
                    </>
                  ) : null}
                </td>
                <td style={S.td}>
                  {row.usageUnknown
                    ? "用量未知"
                    : `输入 ${row.inputTokens ?? UNKNOWN} · 输出 ${row.outputTokens ?? UNKNOWN}`}
                </td>
                <td style={S.td}>
                  {row.costMinor === null ? UNKNOWN : `${row.costMinor} ${row.currency ?? ""}`.trim()}
                </td>
                <td style={{ ...S.td, ...S.hash }}>{row.requestHash.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ShellSections({
  view,
  status,
  purpose,
  busy,
  hasManifest,
  matterArchived,
  onGrant,
}: {
  view: AiView;
  status: GenerationStatus | null | undefined;
  purpose: ProviderPurpose;
  busy: boolean;
  hasManifest: boolean;
  matterArchived: boolean;
  onGrant: (providerProfileId: string) => void;
}) {
  return (
    <>
      <CapabilityList capabilities={view.capabilities} status={status} />
      <section style={S.section} data-testid="ai-profiles">
        <h2 style={S.sectionTitle}>处理方与授权</h2>
        <p style={S.muted}>
          信息不完整（「未知」）的处理方不能确认真实外发；保存按钮会保持禁用。BYOK 与本地模型在浏览器版不可用。
        </p>
        <div style={S.grid}>
          {view.profiles.map((profile) => (
            <ProfileCard
              key={`${profile.id}:${profile.version}`}
              profile={profile}
              purpose={purpose}
              busy={busy}
              hasManifest={hasManifest}
              matterArchived={matterArchived}
              onGrant={() => onGrant(profile.id)}
            />
          ))}
        </div>
      </section>
    </>
  );
}

/** Pure, server-renderable panel. */
export function AiPanel({
  view,
  loading,
  loadError,
  purpose,
  busy,
  actionError = null,
  notice = null,
  onPurposeChange,
  onGrant,
  onRevoke,
  onReload,
  onOpenMatter,
  onOpenDraft,
  status,
  onRefreshStatus,
  onEndSession,
  endingSession,
  sessionError,
}: AiPanelProps) {
  if (loading) {
    return (
      <div style={S.panel} data-testid="ai-panel" data-ai-state="loading" aria-busy="true">
        <div style={S.banner} data-testid="ai-loading">
          正在读取本地 AI 设置与外发授权…
        </div>
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div style={S.panel} data-testid="ai-panel" data-ai-state="error">
        <div style={S.error} data-testid="ai-load-error" data-code={loadError.code}>
          <strong>无法读取 AI 与数据页。</strong>
          <div>{loadError.message}</div>
          <button type="button" style={{ ...S.button, marginTop: "8px" }} onClick={onReload}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (view === null) {
    return (
      <div style={S.panel} data-testid="ai-panel" data-ai-state="loading" aria-busy="true">
        <div style={S.banner} data-testid="ai-loading">
          正在读取本地 AI 设置与外发授权…
        </div>
      </div>
    );
  }

  const matterArchived = view.kind === "ready" && view.matter.status !== "active";
  const hasManifest = view.kind === "ready";
  const grant = onGrant ?? (() => {});
  const revoke = onRevoke ?? (() => {});

  return (
    <div style={S.panel} data-testid="ai-panel" data-ai-state={view.kind}>
      <ServiceStatus status={status} onRefresh={onRefreshStatus} onEndSession={onEndSession}
        endingSession={endingSession} sessionError={sessionError} />

      {actionError !== null && (
        <div style={S.error} data-testid="ai-action-error" data-code={actionError.code}>
          <strong>操作未完成。</strong>
          <div>{actionError.message}</div>
        </div>
      )}
      {notice !== null && (
        <div style={S.banner} data-testid="ai-notice">
          {notice}
        </div>
      )}

      {view.kind === "empty" ? (
        <div style={S.empty} data-testid="ai-empty" data-reason={view.emptyReason}>
          <div>{view.message}</div>
          <div style={{ marginTop: "10px" }}>
            <button type="button" className="v6-ai-link-button" data-testid="ai-manual-writing" onClick={onOpenMatter}>
              前往案件页手工处理材料
            </button>
            <div style={S.muted}>
              草稿编辑器可在专业工作台使用；没有案件时可先创建案件。
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={S.banner} data-testid="ai-matter" data-status={view.matter.status}>
            <strong>案件：{view.matter.title}</strong>{" "}
            <span style={S.badge}>{matterStatusText(view.matter.status)}</span>{" "}
            <button type="button" className="v6-ai-link-button" data-testid="ai-matter-link" onClick={onOpenMatter}>
              返回案件页
            </button>{" "}
            {onOpenDraft ? <button type="button" className="v6-ai-link-button" data-testid="ai-draft-link" onClick={onOpenDraft}>打开草稿工作台</button> : null}
          </div>
          {matterArchived && (
            <div style={S.warning} data-testid="ai-matter-archived">
              案件已归档：可以查看历史授权与记录，但不能新增或撤回授权。
            </div>
          )}
          {view.staleConsentIds.length > 0 && (
            <div style={S.warning} data-testid="ai-stale">
              材料已变化，{view.staleConsentIds.length}{" "}
              个仍生效的授权不再覆盖当前文件。旧授权不会自动扩大范围，请重新查看清单并保存新授权（S04-A02）。
            </div>
          )}
          <div style={S.row} data-testid="ai-purpose-row">
            <label htmlFor="ai-purpose" style={S.muted}>
              本次用途
            </label>
            <select
              id="ai-purpose"
              data-testid="ai-purpose-select"
              value={purpose}
              disabled={busy}
              onChange={(event) => onPurposeChange?.(event.target.value as ProviderPurpose)}
              style={S.button}
            >
              {AI_PURPOSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <ManifestSection manifest={view.manifest} />
        </>
      )}

      <ShellSections
        view={view}
        status={status}
        purpose={purpose}
        busy={busy}
        hasManifest={hasManifest}
        matterArchived={matterArchived}
        onGrant={grant}
      />

      {view.kind === "ready" && (
        <>
          <ConsentSection
            consents={view.consents}
            staleConsentIds={view.staleConsentIds}
            busy={busy}
            onRevoke={revoke}
          />
          <InvocationSection rows={view.invocations} />
        </>
      )}
    </div>
  );
}

function navigateToV6(path: string): void {
  if (typeof window === "undefined") return;
  const marker = window.location.pathname.indexOf("/v6");
  const basePath = marker < 0 ? "" : window.location.pathname.slice(0, marker);
  window.location.assign(`${basePath}${path}`);
}

function newRequestKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function listMattersError(): AiError {
  return { code: "STORAGE_UNAVAILABLE", message: "无法读取本机案件列表。请稍后重试。" };
}

export interface AiPageProps {
  repository: LocalRepository;
  actor: Actor;
}

/** Mounted container for the top-level `ai` tab (registered by the orchestrator). */
export function AiPage({ repository, actor }: AiPageProps) {
  const [matters, setMatters] = useState<readonly MatterRecord[]>([]);
  const [matterId, setMatterId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [view, setView] = useState<AiView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<AiError | null>(null);
  const [actionError, setActionError] = useState<AiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [purpose, setPurpose] = useState<ProviderPurpose>("extract");
  const [refreshToken, setRefreshToken] = useState(0);
  // `undefined` until the first read finishes; `null` when the status endpoint failed.
  const [service, setService] = useState<GenerationStatus | null | undefined>(undefined);
  const [endingSession, setEndingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    setService(undefined);
    readGenerationStatus(undefined, controller.signal)
      .then((value) => { if (!cancelled) setService(value); })
      .catch(() => { if (!cancelled) setService(null); })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refreshToken]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    async function run() {
      const listed = await repository.listMatters(actor);
      if (cancelled) return;
      if (!listed.ok) {
        setLoadError(listMattersError());
        setLoading(false);
        return;
      }
      const items = listed.data.items.map((item) => item.matter);
      setMatters(items);

      let effectiveMatterId = matterId;
      if (effectiveMatterId === null || !items.some((matter) => matter.id === effectiveMatterId)) {
        effectiveMatterId = items.find((matter) => matter.status === "active")?.id ?? items[0]?.id ?? null;
        if (effectiveMatterId !== matterId) {
          setMatterId(effectiveMatterId);
          setTargetId(null);
          if (effectiveMatterId !== null) return;
        }
      }

      const loaded = await loadAiView(repository, actor, effectiveMatterId, { targetId });
      if (cancelled) return;
      if (!loaded.ok) {
        if (loaded.error.code === "RESOURCE_NOT_FOUND" && targetId !== null) {
          setTargetId(null);
          return;
        }
        setLoadError(loaded.error);
        setLoading(false);
        return;
      }
      setView(loaded.data);
      setLoading(false);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [repository, actor.tenantId, actor.userId, matterId, targetId, refreshToken]);

  const reload = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const openMatter = useCallback(() => {
    navigateToV6(v6Path(matterId === null
      ? { kind: "matters" }
      : { kind: "matter", matterId, targetId: null, tab: "overview" }));
  }, [matterId]);
  const openDraft = useCallback(() => {
    if (matterId === null) {
      navigateToV6(v6Path({ kind: "matters" }));
      return;
    }
    const selectedTargetId = targetId ?? (view?.kind === "ready" ? view.targets[0]?.id ?? null : null);
    navigateToV6(v6Path({ kind: "matter", matterId, targetId: selectedTargetId, tab: selectedTargetId === null ? "overview" : "draft" }));
  }, [matterId, targetId, view]);

  const handleGrant = useCallback(
    async (providerProfileId: string) => {
      if (view === null || view.kind !== "ready" || busy) return;
      if (view.matter.status !== "active") return;
      const profile = view.profiles.find((candidate) => candidate.id === providerProfileId);
      if (!profile || !profile.consent.canGrant || !profile.allowedPurposes.includes(purpose)) return;
      setBusy(true);
      setActionError(null);
      setNotice(null);
      const result = await grantConsent(
        repository,
        actor,
        view.matter.id,
        {
          providerProfileId: profile.id,
          providerProfileVersion: profile.version,
          purpose,
          targetId: view.manifest.targetId,
          manifestHash: view.manifest.payloadManifestHash,
          scope: view.manifest.scope,
          expiresAt: null,
        },
        { requestKey: newRequestKey() },
      );
      setBusy(false);
      if (!result.ok) {
        setActionError(result.error);
        if (result.error.code === "STALE_BINDING") reload();
        return;
      }
      setNotice(
        result.data.created
          ? service?.available && service.authenticated
            ? "已保存外发授权。真实起草只在本次授权范围内使用材料，每次调用前都会核对。"
            : "已保存外发授权。平台起草服务当前不可用，不会发起真实调用。"
          : "已存在覆盖当前材料的同类授权，未重复保存。",
      );
      reload();
    },
    [repository, actor, view, busy, purpose, reload, service],
  );

  const handleRevoke = useCallback(
    async (consentId: string) => {
      if (view === null || view.kind !== "ready" || busy) return;
      setBusy(true);
      setActionError(null);
      setNotice(null);
      const result = await revokeConsent(
        repository,
        actor,
        view.matter.id,
        { consentId },
        { requestKey: newRequestKey() },
      );
      setBusy(false);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setNotice(result.data.alreadyRevoked ? "该授权此前已撤回，未重复记录。" : "已撤回授权；历史记录保留。");
      reload();
    },
    [repository, actor, view, busy, reload],
  );

  const handleEndSession = useCallback(async () => {
    if (endingSession) return;
    setEndingSession(true);
    setSessionError(null);
    setNotice(null);
    try {
      await endGenerationSession();
      // Re-read the status: this browser no longer holds an authenticated session.
      // Cases, drafts and saved consents are untouched.
      setNotice("已退出当前浏览器的起草会话。案件、草稿和授权记录都保留；再次真实起草需要重新输入访问码。");
      reload();
    } catch (error) {
      setSessionError(error instanceof Error && error.message
        ? error.message
        : "退出未完成，请重试。该操作仅清除当前浏览器会话。");
    } finally {
      setEndingSession(false);
    }
  }, [endingSession, reload]);

  const targets = view !== null && view.kind === "ready" ? view.targets : [];

  return (
    <>
      <Toolbar title="AI 与数据" subtitle="处理方式、外发授权与本机记录" />
      <Body><Pane>
      <div style={{ ...S.page, padding: 0 }} data-testid="ai-page">

      {matters.length > 0 && (
        <div style={S.row} data-testid="ai-selectors">
          <label style={S.muted}>
            案件{" "}
            <select
              data-testid="ai-matter-select"
              value={matterId ?? ""}
              disabled={busy}
              onChange={(event) => {
                setMatterId(event.target.value || null);
                setTargetId(null);
                setActionError(null);
                setNotice(null);
              }}
              style={S.button}
            >
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title}
                  {matter.status === "active" ? "" : `（${matterStatusText(matter.status)}）`}
                </option>
              ))}
            </select>
          </label>
          <label style={S.muted}>
            范围{" "}
            <select
              data-testid="ai-target-select"
              value={targetId ?? ""}
              disabled={busy}
              onChange={(event) => {
                setTargetId(event.target.value || null);
                setActionError(null);
                setNotice(null);
              }}
              style={S.button}
            >
              <option value="">全部活动目标</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" style={S.button} disabled={busy} data-testid="ai-refresh" onClick={reload}>
            刷新
          </button>
        </div>
      )}

      <AiPanel
        view={view}
        loading={loading}
        loadError={loadError}
        status={service}
        onRefreshStatus={reload}
        onEndSession={() => { void handleEndSession(); }}
        endingSession={endingSession}
        sessionError={sessionError}
        purpose={purpose}
        busy={busy}
        actionError={actionError}
        notice={notice}
        onPurposeChange={(value) => {
          setPurpose(value);
          setActionError(null);
          setNotice(null);
        }}
        onGrant={(providerProfileId) => {
          void handleGrant(providerProfileId);
        }}
        onRevoke={(consentId) => {
          void handleRevoke(consentId);
        }}
        onReload={reload}
        onOpenMatter={openMatter}
        onOpenDraft={openDraft}
      />
      </div></Pane></Body>
    </>
  );
}
