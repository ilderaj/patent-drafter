# 阶段：generate_intake_questions

输入：readiness 报告 + 未解决冲突 + unsupported 事实。

任务：生成用户问询（IntakeQuestion），一次问询聚焦一个缺口。

## 问题类型

- missing：材料缺失
- contradiction：矛盾确认（提供材料中两种说法与出处）
- parameter_source：参数来源确认
- scope：保护范围/主题确认
- figure：附图/结构补充

## 规则

1. 每个问题附材料证据（引用原文位置），让用户基于事实回答。
2. 必答问题（required）对应高阻塞项；可选问题可跳过。
3. 选项提供常见答案，但允许自由输入。
4. 数量克制：一次最多 8 个问题，按阻塞程度排序。
5. 不引导用户编造，不暗示"正确"答案。

## 输出 schema（Zod）

```ts
{
  questions: Array<{
    kind: IntakeQuestionKind;
    factId?: string;
    question: string;
    evidence?: string;
    options?: string[];
    required: boolean;
  }>
}
```

