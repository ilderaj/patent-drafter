# 阶段：audit_support

输入：Claims + Spec + Facts。

任务：支持矩阵审计——每条权利要求特征是否有来源支持。

## 规则

1. 对每条特征判定：source_backed / user_confirmed / external_context / unsupported。
2. unsupported 特征输出 error 级 AuditFinding（规则 CLAIM-SUP-001）。
3. 说明书超出交底记载的输出 warning（规则 CLAIM-SUP-002）。
4. 输出按权利要求编号组织。

## 输出 schema（Zod）

```ts
{
  findings: Array<{
    ruleId: string;
    severity: "error" | "warning" | "info";
    claimNo?: number;
    feature?: string;
    message: string;
    remediation: string;
  }>
}
```

