/**
 * User-facing labels for internal codes and enums.
 *
 * The original code stays available for "技术详情" disclosures; product copy
 * should use `userMessageFor` instead of showing the raw value.
 */
export const USER_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  local_unmetered: "本机保存，不计费",
  CACHE_EXPIRED: "导出文件已超过七天，请重新导出",
  STALE_BINDING: "材料或快照已更新，请刷新后重试",
  FORMAT_UNAVAILABLE: "当前格式不可用",
  CONFIRMATION_REQUIRED: "还需完成内容或风险确认",
  MISSING_BYTES: "有引用的文件缺失",
  RESOURCE_NOT_FOUND: "案件或内容不可用",
  CHECK_REQUIRED: "需要当前材料下有效的检查结果",
  APPROVAL_REQUIRED: "需要与当前检查和确认相符的内部批准",
  INPUT_STALE: "草稿依据的材料已变化",
  BAD_DRAWING: "有附图无法通过文件检查",
  DUPLICATE_FIGURE_NUMBER: "附图编号需要修正",
  INVALID_AST: "草稿结构需要修复",
  GATE_BLOCKED: "当前门禁阻止该操作",
  ENTITLEMENT_REQUIRED: "需要本地完整内容权限",
  STORAGE_UNAVAILABLE: "本机存储暂时不可用",
  HASH_MISMATCH: "文件校验不一致，请重新导入",
  ACTION_FORBIDDEN: "当前角色不能执行该操作",
  VERSION_CONFLICT: "内容已被其他操作更新，请刷新后重试",
  CONSENT_REQUIRED: "需要先完成外发授权",
  CONSENT_REVOKED: "外发授权已撤回",
  RELEASE_GATE_CLOSED: "真实外发尚未开放",
  CHECK_FAILED: "检查未成功完成，结果不能作为无问题的证明",
  CHECK_RUN_FAILED: "检查运行失败，请重试",
  CONFIRMATION_FAILED: "风险确认未保存，请重试",
  STALE_BINDING_DRAFT: "草稿已更新，请刷新后重新核对",
  PROVIDER_UNAVAILABLE: "真实起草服务暂时不可用",
  PROVIDER_TIMEOUT: "真实起草服务响应超时",
  RATE_LIMITED: "真实起草请求过多",
  PROVIDER_AUTH: "模型服务或访问会话未被接受",
  AUTH_REQUIRED: "访问会话已失效",
  PROVIDER_REJECTED: "模型服务拒绝了请求",
  PROVIDER_REQUEST_INVALID: "请求内容或参数不符合模型要求",
  PROVIDER_SCHEMA_INVALID: "模型输出无法解析",
});

/**
 * Next step for a failed real-drafting stage. These are the reasons a user can act on;
 * the English code belongs only in 技术详情.
 */
export const PROVIDER_RECOVERY: Readonly<Record<string, string>> = Object.freeze({
  PROVIDER_UNAVAILABLE: "真实起草服务暂时不可用（服务中断或网络不通）。已完成的阶段会保留；请稍后重试，重试会新建任务。",
  PROVIDER_TIMEOUT: "模型响应超时，属于临时问题。已完成的阶段会保留；请稍后重试，重试会新建任务。",
  RATE_LIMITED: "请求过多，已被限流。请等几分钟后再试，不会自动更换处理方。",
  PROVIDER_AUTH: "访问会话或模型服务凭据未被接受。请先重新输入访问码；仍失败说明服务端凭据有误，请联系部署者检查，不要反复重试。",
  AUTH_REQUIRED: "访问会话已失效。请重新输入访问码后再试。",
  PROVIDER_REJECTED: "模型服务拒绝了这次请求，或服务地址、模型配置有误。重试通常无效，请联系部署者检查服务配置。",
  PROVIDER_REQUEST_INVALID: "请求内容或参数不符合模型要求，请减少材料或检查服务配置。",
  PROVIDER_SCHEMA_INVALID: "模型返回的内容无法按约定结构解析，本次结果没有被使用。可以重试；如反复出现，请联系部署者检查模型配置。不会自动重试。",
});

/** Recovery text for a provider failure code, or null when the code is not a provider failure. */
export function providerRecoveryFor(code: string | null | undefined): string | null {
  return code ? PROVIDER_RECOVERY[code] ?? null : null;
}

const FALLBACK = "当前操作未完成，请按提示重试";

/** Chinese explanation for an internal code; the code itself belongs in 技术详情. */
export function userMessageFor(code: string | null | undefined): string {
  if (!code) return FALLBACK;
  return USER_MESSAGES[code] ?? FALLBACK;
}

/** Label for a 技术详情 disclosure; the raw code stays visible only here. */
export function technicalDetailLabel(code: string): string {
  return `技术详情：${code}`;
}
