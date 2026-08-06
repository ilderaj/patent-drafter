# 阶段：draft_abstract

输入：Claims + Spec。

任务：生成说明书摘要（≤300 字）。

## 规则

1. 概述技术方案与主要用途，可含一个主要参数。
2. 不得含宣传语、背景技术评论、噪声内容。
3. 与权利要求/说明书术语一致。
4. 字数校验：≤300 字（硬性）。

## 输出 schema（Zod）

```ts
{
  abstract: string;
  charCount: number;
}
```

