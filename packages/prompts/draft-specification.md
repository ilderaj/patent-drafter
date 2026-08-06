# 阶段：draft_specification

输入：Claims + Facts。

任务：生成说明书五段式（技术领域/背景技术/发明内容/附图说明/具体实施方式）。

## 规则

1. 技术领域：一句话。
2. 背景技术：客观描述现有技术缺陷；对比文献必须真实存在（材料提供或用户确认），不得虚构。
3. 发明内容：方案与独立权利要求一致；有益效果只写特征可支持的。
4. 附图说明：与 FigureSpec 图号一一对应。
5. 具体实施方式：逐条支持权利要求特征；实施例细节必须有来源或用户确认。
6. 每条特征标 refs；unsupported 内容禁止写入。
7. 不写"AI 生成"等声明。

## 输出 schema（Zod）

```ts
{
  sections: Array<{
    section: DraftSectionName;
    content: string;
    refs: Array<{ chunkId: string; claimNo?: number }>;
  }>
}
```

