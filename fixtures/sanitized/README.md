# 脱敏结构化 Fixture

本目录用于规则回归与 baseline 对账测试，**不包含原始交底/定稿的连续原文**。

规则：
- 只保留结构元数据（章节、条数、引用关系、图号、字数）。
- 技术特征用占位符描述（如 `[三模通信模块]`），不复制原文句子。
- 原文件名只保留脱敏别名。

## 文件

- `baseline-claims-graph.json`：定稿权利要求树（编号/类型/引用关系/特征占位）。
- `baseline-spec-structure.json`：说明书章节结构（章节名/段落数/是否含噪声标记）。
- `baseline-problems.json`：交底问题清单（供 detect_conflicts 回归）。

