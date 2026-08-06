# 阶段：assess_readiness

输入：Fact + FactConflict。

任务：评估交底是否足以起草，输出覆盖度报告与缺口清单。

## 评估维度

- 保护主题明确性
- 技术方案完整度（结构/连接/流程）
- 参数来源
- 效果与特征对应
- 噪声与矛盾残留

## 规则

1. 存在未解决的 subject_swing 或 scheme_contradiction → readiness = blocked（对应维度）。
2. 覆盖率 = source_backed+user_confirmed 事实 / 总事实。
3. 输出 readiness：ready / partial / blocked，及每维度的状态与理由。
4. 不在此阶段补写任何内容。

## 输出 schema（Zod）

```ts
{
  readiness: "ready" | "partial" | "blocked";
  coverage: { total: number; sourceBacked: number; confirmed: number; percent: number };
  dimensions: Array<{ name: string; status: "ok" | "needs_input" | "conflict" | "noise"; note: string }>;
  blockers: string[];
}
```

