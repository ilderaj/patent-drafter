# 阶段：draft_claim_skeleton

输入：PatentStrategy。

任务：生成权利要求骨架（不写完整句子，只定结构与特征槽）。

## 规则

1. 一条独立权利要求（产品型），特征按"上位 → 连接关系"组织。
2. 从属权利要求层级：
   - 层 1：模块间连接/扩展（如网关上行方式）
   - 层 2：部件结构（如网关本体、主板插接）
   - 层 3：尺寸/固定/插卡/阀门等实施细节
3. 每个特征槽标注来源（source_backed / user_confirmed / 待确认）。
4. 引用关系树必须满足：引用在前；多项从属不得作为另一项多项从属的引用基础。
5. 数量建议：实用新型 8-12 条。

## 输出 schema（Zod）

```ts
{
  independent: { features: Array<{ text: string; source: FactStatus }> };
  dependents: Array<{ parentRefs: number[]; features: Array<{ text: string; source: FactStatus }> }>;
}
```

