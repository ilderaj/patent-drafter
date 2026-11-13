import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { loadAiView, grantConsent, requestRealInvocation, type PayloadManifest, type ProviderProfileConfig } from "../ai/ai.ts";
import type { GenerationEngineOptions } from "./generation.ts";
import { LOCAL_TEST_GENERATION_OPTIONS } from "./local-runtime.ts";
import { RemoteGenerationProvider, readGenerationStatus, issueConsentCredential, createGenerationSession as openGenerationSession,
  type RemoteConsentCredential, type GenerationStatus } from "./remote-provider.ts";
import { loadTargetsView } from "../targets/targets.ts";
export { readGenerationStatus } from "./remote-provider.ts";

/** Tab memory only. Refresh/login/logout/cancel requires another explicit consent action. */
const credentials = new Map<string, RemoteConsentCredential>();
/** Invalidates runtime objects too, even if a later grant reuses the same digest or login fails. */
let sessionEpoch = 0;
export async function createGenerationSession(accessCode: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  sessionEpoch += 1;
  credentials.clear();
  await openGenerationSession(accessCode, fetchImpl);
}
export async function endGenerationSession(fetchImpl: typeof fetch = fetch): Promise<void> {
  sessionEpoch += 1;
  credentials.clear();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl("/api/v6/session", { method: "DELETE", credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("退出未完成");
  } catch {
    throw new Error("服务器会话尚未退出，请重试。本机凭证已清除；当前浏览器暂不能继续真实起草。");
  } finally { clearTimeout(timer); }
}

export interface RuntimeProcessor {
  name: string;
  region: string;
  retention: string;
  trainingPolicy: "no_training" | "allowed" | "unknown";
  termsVersion: string | null;
  model: string | null;
}
export interface GenerationRuntime {
  mode: "real" | "test";
  engineOptions: Omit<GenerationEngineOptions, "repository" | "actor">;
  consent: { required: boolean; manifest: PayloadManifest | null; grant(): Promise<GenerationRuntime> };
  processor: RuntimeProcessor;
  unavailableReason: string | null;
}
/** Injection seam for deterministic tests; normal pages pass only the four public arguments. */
export interface RuntimeDependencies {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  loadPrompts?: () => Promise<NonNullable<GenerationEngineOptions["pipeline"]["prompts"]>>;
}
const PROFILE_ID = "a1000000-0000-4000-8000-000000000006";
const unknownProcessor: RuntimeProcessor = { name: "未知", region: "未知", retention: "未知", trainingPolicy: "unknown", termsVersion: null, model: null };
export function statusProfileConfig(status: GenerationStatus): ProviderProfileConfig {
  return { configVersion: `v6-remote-${status.profileVersion}`, releaseGate: status.available && status.authenticated ? "open" : "closed",
    profiles: [{ id: PROFILE_ID, version: status.profileVersion, mode: "platform", adapterId: "v6-same-origin",
      modelId: status.model ?? "unavailable", processorName: status.processor.name, processingRegion: status.processor.region,
      retentionPolicyVersion: status.processor.retention, trainingPolicy: status.processor.trainingPolicy,
      termsVersion: status.processor.termsVersion, allowedPurposes: ["draft"], credentialRef: null,
      capabilities: { structuredOutput: true, visionInput: false, imageGeneration: false, contextWindowTokens: 100_000, maxOutputTokens: 8192 },
      status: status.available ? "approved" : "disabled" }] };
}
function unavailable(reason: string, processor = unknownProcessor): GenerationRuntime {
  return { mode: "test", engineOptions: LOCAL_TEST_GENERATION_OPTIONS, processor, unavailableReason: reason,
    consent: { required: false, manifest: null, grant: async () => { throw new Error(reason); } } };
}
function coded(code: string, message: string): Error { return Object.assign(new Error(message), { code }); }
async function statusWithinTimeout(fetchImpl?: typeof fetch): Promise<GenerationStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try { return await readGenerationStatus(fetchImpl, controller.signal); }
  finally { clearTimeout(timer); }
}
export async function resolveGenerationRuntime(
  repository: LocalRepository, actor: Actor, matterId: string, targetId: string, dependencies: RuntimeDependencies = {},
): Promise<GenerationRuntime> {
  const epoch = sessionEpoch;
  let status: GenerationStatus;
  try { status = await statusWithinTimeout(dependencies.fetchImpl); }
  catch { return unavailable("无法连接真实起草服务。当前可使用带测试标记的本机流程。"); }
  if (epoch !== sessionEpoch) return unavailable("访问会话已变化，请重新打开起草入口。");
  const processor: RuntimeProcessor = { ...status.processor, model: status.model };
  if (!status.available || !status.model) return unavailable(status.unavailableReason ?? "真实起草服务尚未配置完整。", processor);
  if (!status.authenticated) return unavailable("真实起草需要访问码。建立访问会话后可重新选择真实起草。", processor);
  if (!status.sessionId) return unavailable("服务端尚未提供新会话校验，请更新服务后重新输入访问码。", processor);
  if ([processor.name, processor.region, processor.retention].some(v => !v || v === "未知" || v === "unknown")
    || processor.trainingPolicy === "unknown" || !processor.termsVersion) return unavailable("处理方披露信息尚未完整，暂不能外发材料。", processor);
  const targets = await loadTargetsView(repository, actor, matterId);
  if (!targets.ok) return unavailable(targets.error.message, processor);
  const target = targets.view.targets.find(item => item.id === targetId);
  if (target?.config?.route !== "cn_um" || target.config.language !== "zh-CN") return unavailable("当前真实起草仅接入中国实用新型中文准备稿。", processor);
  const config = statusProfileConfig(status);
  const now = () => (dependencies.now?.() ?? new Date()).toISOString();
  const view = await loadAiView(repository, actor, matterId, { targetId, config, now });
  if (!view.ok) return unavailable(view.error.message, processor);
  if (view.data.kind !== "ready" || view.data.matter.status !== "active") return unavailable("当前案件或材料清单不可用。", processor);
  const manifest = view.data.manifest;
  // Material is either parsed documents or the user's own five saved answers (labelled as such).
  const answerChunkIds = new Set(manifest.answers.items.map((item) => item.chunkId).filter((id): id is string => id !== null));
  const documentChunks = manifest.chunkIds.filter((id) => !answerChunkIds.has(id)).length;
  if (documentChunks === 0 && !manifest.answers.complete) {
    return unavailable(manifest.answers.answered === 0
      ? "真实起草需要已解析的文档，或完整的五题回答。请先上传并解析文档，或回答全部五个问题；现在只能走带测试标记的本机流程。"
      : `没有已解析的文档，且五个问题还没答完，缺：${manifest.answers.missing.join("、")}。答完后才能真实起草；现在只能走带测试标记的本机流程。`, processor);
  }
  const existing = view.data.consents.find(consent => consent.providerProfileId === PROFILE_ID
    && consent.providerProfileVersion === status.profileVersion && consent.purpose === "draft"
    && consent.scope.targetId === targetId && consent.status === "active" && !consent.stale);
  const consentId = existing?.id ?? null;
  const credentialPrefix = `${actor.tenantId}/${actor.userId}/${matterId}/${targetId}/`;
  const credentialKey = `${credentialPrefix}${status.sessionId}/${status.profileVersion}/${manifest.payloadManifestHash}/${consentId ?? "missing"}`;
  const invalidate = () => { credentials.delete(credentialKey); };
  const credentialAvailable = () => {
    if (epoch !== sessionEpoch) return false;
    const proof = credentials.get(credentialKey);
    if (!proof || Date.parse(proof.expiresAt) <= Date.parse(now())) { invalidate(); return false; }
    return true;
  };
  // Keep only the original ids and manifest. Every actual call reloads consent and status, without changing the disclosed scope.
  const beforeCall = async () => {
    if (!credentialAvailable()) throw coded("CONSENT_REQUIRED", "请明确确认当前外发清单，以获取本次会话的同意凭证。");
    const checked = await requestRealInvocation(repository, actor, matterId, {
      consentId, providerProfileId: PROFILE_ID, providerProfileVersion: status.profileVersion, purpose: "draft", targetId,
    }, { config, now });
    if (!checked.ok) { invalidate(); throw coded(checked.error.code, checked.error.message); }
    let fresh: GenerationStatus;
    try { fresh = await statusWithinTimeout(dependencies.fetchImpl); }
    catch { throw coded("PROVIDER_UNAVAILABLE", "真实起草服务状态无法验证。"); }
    if (!fresh.available || !fresh.authenticated) { invalidate(); throw coded("PROVIDER_UNAVAILABLE", "真实起草服务或访问会话已不可用。"); }
    if (fresh.profileVersion !== status.profileVersion || fresh.sessionId !== status.sessionId) {
      invalidate(); throw coded("CONSENT_REQUIRED", "访问会话、处理方、模型或政策已变化，请重新确认。");
    }
    // Status may take time; recheck expiry and material changes immediately before the chat request.
    const finalCheck = await requestRealInvocation(repository, actor, matterId, {
      consentId, providerProfileId: PROFILE_ID, providerProfileVersion: status.profileVersion, purpose: "draft", targetId,
    }, { config, now });
    if (!finalCheck.ok) { invalidate(); throw coded(finalCheck.error.code, finalCheck.error.message); }
    if (!credentialAvailable()) throw coded("CONSENT_REQUIRED", "本次会话的同意凭证已过期，请重新确认。");
    return { credential: credentials.get(credentialKey)!.credential, manifestHash: manifest.payloadManifestHash };
  };
  const prompts = await (dependencies.loadPrompts ?? (async () => (await import("./real-prompts.ts")).REAL_PIPELINE_PROMPTS))();
  return { mode: "real", processor, unavailableReason: null,
    engineOptions: {
      pipeline: { prompts, promptVersion: "v6-real-cn-um-2026-11-12", rulePackVersion: "cnipa-2026-01-01" },
      limits: { maxInputTokens: 100_000, maxOutputTokens: 20_000, maxCostMinor: 100, maxUnknownCostCalls: 16, maxDurationSeconds: 1200 },
      execution: "provider", allowTestAdoption: false,
      provider: new RemoteGenerationProvider({ model: status.model, profileVersion: status.profileVersion, fetchImpl: dependencies.fetchImpl, beforeCall, onCancel: invalidate }),
      profileId: PROFILE_ID, profileVersion: status.profileVersion, consentId, config,
    },
    consent: { required: consentId === null || !credentialAvailable(), manifest,
      grant: async () => {
        if (epoch !== sessionEpoch) throw coded("CONSENT_REQUIRED", "访问会话已结束或变化，请重新打开起草入口后确认。");
        // A visible manifest is not silently replaced with newer material when the user clicks confirm.
        const fresh = await statusWithinTimeout(dependencies.fetchImpl);
        if (!fresh.available || !fresh.authenticated || fresh.profileVersion !== status.profileVersion || fresh.sessionId !== status.sessionId) {
          invalidate(); throw coded("CONSENT_REQUIRED", "访问会话或服务配置已变化，请重新查看外发信息。");
        }
        const result = await grantConsent(repository, actor, matterId, { providerProfileId: PROFILE_ID,
          providerProfileVersion: status.profileVersion, purpose: "draft", targetId, manifestHash: manifest.payloadManifestHash, scope: manifest.scope,
          expiresAt: new Date(Date.parse(now()) + 2 * 60 * 60 * 1000).toISOString(),
        }, { config, now, requestKey: crypto.randomUUID() });
        if (!result.ok) throw coded(result.error.code, result.error.message);
        // This is the only credential-issuing path: an explicit grant of the manifest the user saw.
        // Validate again after the local write; a changed title/material must not acquire a proof for the old digest.
        const grantedId = result.data.consent.id;
        const confirmed = await requestRealInvocation(repository, actor, matterId, {
          consentId: grantedId, providerProfileId: PROFILE_ID, providerProfileVersion: status.profileVersion, purpose: "draft", targetId,
        }, { config, now });
        if (!confirmed.ok) throw coded(confirmed.error.code, confirmed.error.message);
        if (epoch !== sessionEpoch) throw coded("CONSENT_REQUIRED", "访问会话已结束，请重新确认。");
        const proof = await issueConsentCredential(status.profileVersion, manifest.payloadManifestHash, dependencies.fetchImpl);
        if (epoch !== sessionEpoch) throw coded("CONSENT_REQUIRED", "访问会话已结束，凭证未被保存。请重新确认。");
        for (const key of credentials.keys()) if (key.startsWith(credentialPrefix)) credentials.delete(key);
        const grantedKey = `${credentialPrefix}${status.sessionId}/${status.profileVersion}/${manifest.payloadManifestHash}/${grantedId}`;
        credentials.set(grantedKey, proof);
        return resolveGenerationRuntime(repository, actor, matterId, targetId, dependencies);
      },
    },
  };
}
