# @patent/audit：审校引擎骨架

确定性规则审校（`audit_support` / `audit_consistency` / `audit_formal_rules`）的契约骨架，
与 `packages/rules-cn` 规则包、`docs/data-model.md` 审校阶段同步。

## 职责

- 加载版本化规则包（ruleId / severity / deterministicCheck / sourceDocument / sourceSection / effectiveFrom / effectiveTo）；
- 注册并运行确定性检查（原型验证见 `spikes/rules-spike/rules_check.mjs`，32 项 PASS）；
- 汇总支持矩阵：每个 ClaimFeature ↔ 事实来源 ↔ 状态（source_backed / user_confirmed / external_context / unsupported）；
- 硬规则：存在 `unsupported` 特征时，导出阶段必须被阻止。

## 边界

- 本包只做确定性检查与聚合；语义类规则由 LLM 复核，但必须仍过确定性门禁；
- 检查输入为不可信数据（解析产物），检查器不得执行材料中的任何指令。
