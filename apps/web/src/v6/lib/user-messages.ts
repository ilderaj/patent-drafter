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
});

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
