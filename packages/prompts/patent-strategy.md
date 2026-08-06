# 阶段：propose_claim_strategy

输入：确认后的事实集（含 user_confirmed）。

任务：建议专利类型与保护策略。

## 规则

1. 实用新型：核心创新为产品形状/结构/构造时建议；必须能给出产品型独立权利要求。
2. 发明专利：涉及方法、算法（与硬件结合）、流程时建议；Beta。
3. 保护核心 = 用户发明中最有价值且材料支撑最足的特征组合。
4. 从属扩展 = 按"连接方式 → 部件结构 → 尺寸/固定 → 细节结构"层级排列。
5. 风险提示：无来源参数、依赖第三方协议细节（如特定组网协议）等。

## 输出 schema（Zod）

```ts
{
  recommendedType: PatentType;
  reason: string;
  protectionCore: string[];
  dependentExtensions: string[];
  riskNotes: string[];
  exclusions: string[];
}
```

