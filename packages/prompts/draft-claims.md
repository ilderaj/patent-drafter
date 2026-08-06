# 阶段：draft_claims

输入：骨架 + 事实。

任务：按骨架生成完整权利要求文本。

## 规则

1. 逐条生成，格式："1、一种[主题]，包括[上位部件]，其特征在于，…"。
2. 每条特征必须与骨架特征一一对应，不增不减。
3. 从属引用格式："根据权利要求X所述的…，其特征在于，…"；多项引用用"根据权利要求1-3任一项所述"。
4. 术语与事实一致（使用已确认术语表）。
5. 禁止写入 unsupported 特征；骨架中的"待确认"特征在未确认前不得写入。
6. 附图标记（如适用）与说明书/附图保持一致。

## 输出 schema（Zod）

```ts
{
  claims: Array<{
    number: number;
    independent: boolean;
    parentRefs: number[];
    text: string;
    features: Array<{ text: string; factId?: string; status: FactStatus }>;
  }>
}
```

