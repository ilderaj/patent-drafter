# 阶段：extract_invention_facts

输入：解析后的 SourceChunk 列表。

任务：从材料中提取发明相关事实（Fact），逐条给出来源引用（SourceRef）。

## 事实类别

- subject（保护主题）
- structure（结构）
- comm_scheme（通讯/连接方案）
- effect（效果）
- parameter（参数）
- material（材料/制造）

## 规则

1. 每条事实必须引用具体 chunk（页码/段落/表格/图像位置）。
2. 区分：
   - source_backed：材料中有明确描述；
   - unsupported：只有结论性断言、宣传语、或与其他段落矛盾的内容；
   - noise_suspect：疑似页脚残留、模板文本、主题外领域内容（如电表网关规格混入热水表交底）。
3. 参数（尺寸、数值）单列事实并标注来源；无来源的参数标记 unsupported。
4. 宣传式效果（"彻底解决""尽显"）提取为 effect 但标记 unsupported，等待 intake 或剔除。
5. 不合并材料中相互矛盾的说法；矛盾双方各成事实，由 detect_conflicts 处理。

## 输出 schema（Zod）

```ts
{
  facts: Array<{
    category: FactCategory;
    statement: string;
    status: FactStatus;       // source_backed | unsupported
    refs: Array<{ chunkId: string; page?: number }>;
    noiseFlag?: "promo" | "footer" | "other_domain";
  }>
}
```

## 禁止

- 用模型常识补充材料中没有的特征；
- 将噪声内容当作发明事实；
- 忽略明显矛盾（可注释但不得擅自选边）。

