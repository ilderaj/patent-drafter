/**
 * 中文 OCR 术语归一化（spike B 实测驱动的已知易混淆项）。
 * 扩展点：后续从项目术语表动态生成。
 */
export const OCR_TERM_FIXES: Array<[RegExp, string]> = [
  [/\bNB-loT\b/gi, "NB-IoT"],
  [/\bNB-IOT\b/g, "NB-IoT"],
  [/\b4G\s*网络\b/g, "4G网络"],
];

export function normalizeOcrText(text: string): string {
  let out = text;
  for (const [re, replacement] of OCR_TERM_FIXES) out = out.replace(re, replacement);
  return out;
}
