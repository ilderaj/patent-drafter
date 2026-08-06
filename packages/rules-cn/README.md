# packages/rules-cn：CNIPA 规则包

版本化确定性规则包（与 `docs/rules-mapping.md` 同步）。

## 结构

```text
2023-baseline/    # 以 2023 版《专利审查指南》为基准（附件引用占位）
2026-01-01/       # CNIPA 2025 修改、2026-01-01 施行（需联网核对官方文本后填充差异）
```

每条规则：

```json
{
  "ruleId": "UM-FIG-001",
  "patentType": ["utility_model"],
  "severity": "error",
  "deterministicCheck": "figuresRequired",
  "sourceDocument": "专利审查指南（2023）",
  "sourceSection": "待填充（需官方文本）",
  "effectiveFrom": "2023-01-01",
  "effectiveTo": null,
  "userMessage": "...",
  "remediation": "..."
}
```

## 校验双轨

1. 确定性检查（代码实现，见 spikes/rules-spike/rules_check.mjs 原型）
2. LLM 复核（语义类规则辅助，仍须通过确定性门禁）

## 待办

- [x] 核对 2025 修改元数据：局令第 84 号、2025-11-10 公布、2026-01-01 施行、三大修改方向（AI 专章/比特流/植物品种）——2026-08-06 完成，来源见 2026-01-01/ai-related.json meta.sources
- [ ] 获取决定全文逐条文本，填充 sourceSection 精确章节（微信/CNIPA PDF 需验证码，待后续轮次）
- [ ] 生成 2023 → 2026 差异清单
- [ ] 生成脱敏 fixture 用于规则回归测试
