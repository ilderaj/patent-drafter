/**
 * 轻量 cn：合并 class 字符串（shadcn 契约的 class-variance-authority 搭配）。
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
