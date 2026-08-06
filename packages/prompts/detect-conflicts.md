# 阶段：detect_conflicts

输入：Fact 列表。

任务：检测事实之间的冲突与噪声，输出 FactConflict 列表。

## 冲突类型

- subject_swing：保护主题摇摆（如"系统"与"产品"并存）
- scheme_contradiction：技术方案矛盾（如通讯制式 NB 与 蓝牙/470 并存）
- numeral_mismatch：编号/附图标记不一致
- term_mismatch：同一概念不同术语
- noise_suspect：噪声疑似项（可挂到相关事实）

## 规则

1. 每条冲突给出冲突双方事实 ID 与证据。
2. resolved 初始为 false；禁止自行裁定哪一方正确。
3. 高风险冲突（subject_swing / scheme_contradiction）必须在后续阶段阻塞相应生成，直到用户确认。

## 输出 schema（Zod）

```ts
{
  conflicts: Array<{
    factAId: string;
    factBId: string;
    kind: ConflictKind;
    detail: string;
    resolved: false;
  }>
}
```

