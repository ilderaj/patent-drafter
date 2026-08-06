# 阶段：audit_consistency

输入：Claims + Spec + Figures。

任务：一致性审计——权利要求/说明书/附图/摘要/术语/图号/标记。

## 检查项

- 术语一致（同义替换检测）
- 附图标记双向一致
- 图号连续且与附图说明对应
- 权利要求特征在说明书中有对应描述
- 摘要与正文无冲突

## 输出 schema（Zod）

```ts
{
  findings: Array<{
    ruleId: string;
    severity: "error" | "warning" | "info";
    scope: AuditScope;
    message: string;
    remediation: string;
  }>
}
```

