# 规则包覆盖核实（2026-11-10，修正后）

范围：`packages/rules-cn` 五份规则 JSON，共 28 条；执行实现为 `packages/domain/src/v6/checks.ts` 的 `evaluatePackRule` / 内置检查，经 `adaptCnRulePacks` 归一后由 `runChecks` 使用。

## 活动规则包

- 2023 基线的两条重复 id 已分别改为 `AI-POL-001`（原 AI-INV-001）和 `AI-POL-002`（原 AI-INV-002，产品内部规则）。2026 版 `AI-INV-001`、`AI-INV-002` 保留原 id。
- 重复 id 消除后，`adaptCnRulePacks` 合并结果保留 **28 条**，`AI-POL-002` 以 `policy` 类别留在“产品政策”组。
- `AI-POL-002` 的 `deterministicCheck`（`aiAssistedReviewConfirmed`）本版尚未实现，作为“本版未自动检查”的 policy 条目展示；其 action 归入 `prepare`，不会进入导出门禁的 blocking 列表。

## 执行覆盖

- **执行 19/28**：19 条规则的 `deterministicCheck` 有实际实现，其中 18 条按 AST/事实/图集/人员数据产出条件性 finding；`AI-POL-001`、`AI-INV-001` 的自然人语义由内置检查 `inventor.natural_person` 实现（组织被勾为发明人 → blocker）。
- **未执行 9/28**：为每条产出一条 `category: "unverified"` 的“本版未自动检查这条规则，需人工核对”条目（`AI-POL-002` 保持 `policy` 组），不带确认要求、不阻断导出门禁、不显示为通过。
- 新增实现的形式类规则（均为规则包原类别，法律条目仍为 `unverified`，不新增阻断语义）：
  - `titleNoPromoWords`、`abstractNoPromoNoNoise`、`noPromoNoiseContent`（宣传/噪声用语表）
  - `numeralBidirectionalMatch`（正文引用图与图集双向匹配）
  - `atLeastOneIndependent`、`refsExistAndForward`、`multiDependentNotBaseOfMulti`、`noCircularRefs`
- 已有实现：`titleLengthMax25`、`specSectionsComplete`、`abstractMax300`、`figureNumbersSequential`、`figuresRequired`、`aiDisclosureConfirmed`、`aiDisclosureComplete`、`aiEthicsStatement`、`aiInventiveContribution`、`inventorsNaturalPerson` / `inventorNaturalPerson`（后者由内置自然人检查承接）。
- 数据字段：`CheckRunResult.ruleCoverage` 仍提供 `totalRules/executedRules/rulesThatCanReport/handledWithoutFindingRules/unexecutedRules` 及 ruleId 数组。建议检查页摘要位置不变：`data-testid="checks-summary"` 内、规则包版本/有效状态之后、现有技术检索之前，显示“本版执行 N/28 条规则”（N=`ruleCoverage.executedRules`）。

## 逐条覆盖

| # | 文件 | ruleId | 严重度 | deterministicCheck | 界面类别 | v6 执行 | 未执行时界面表现 |
|---:|---|---|---|---|---|---|---|
| 1 | 2023-baseline/common.json | COM-TITLE-001 | warning | titleLengthMax25 | 待核实 | 执行，可产出 | — |
| 2 | 2023-baseline/common.json | COM-TITLE-002 | warning | titleNoPromoWords | 待核实 | 执行，可产出 | — |
| 3 | 2023-baseline/common.json | COM-SECT-001 | error | specSectionsComplete | 待核实 | 执行，可产出 | — |
| 4 | 2023-baseline/common.json | COM-SECT-002 | error | abstractMax300 | 待核实 | 执行，可产出 | — |
| 5 | 2023-baseline/common.json | COM-SECT-003 | warning | abstractNoPromoNoNoise | 待核实 | 执行，可产出 | — |
| 6 | 2023-baseline/common.json | COM-TERM-001 | warning | termConsistency | 待核实 | 未执行（需语言判断） | “本版未自动检查，需人工核对” |
| 7 | 2023-baseline/common.json | COM-REF-001 | error | numeralBidirectionalMatch | 待核实 | 执行，可产出 | — |
| 8 | 2023-baseline/common.json | COM-REF-002 | error | figureNumbersSequential | 待核实 | 执行，可产出 | — |
| 9 | 2023-baseline/common.json | COM-NOISE-001 | warning | noPromoNoiseContent | 待核实 | 执行，可产出 | — |
| 10 | 2023-baseline/common.json | COM-EFFECT-001 | warning | effectSupportedByFeatures | 待核实 | 未执行（需实质判断） | “本版未自动检查，需人工核对” |
| 11 | 2023-baseline/common.json | AI-POL-001 | error | inventorsNaturalPerson | 待核实 | 执行（内置自然人检查） | — |
| 12 | 2023-baseline/common.json | AI-POL-002 | info | aiAssistedReviewConfirmed | 产品政策 | 未执行（缺少确认数据入口） | 产品政策组“本版未自动检查，需人工核对”，不阻断 |
| 13 | 2023-baseline/claims.json | CLAIM-IND-001 | error | atLeastOneIndependent | 待核实 | 执行，可产出 | — |
| 14 | 2023-baseline/claims.json | CLAIM-REF-001 | error | refsExistAndForward | 待核实 | 执行，可产出 | — |
| 15 | 2023-baseline/claims.json | CLAIM-REF-002 | error | multiDependentNotBaseOfMulti | 待核实 | 执行，可产出 | — |
| 16 | 2023-baseline/claims.json | CLAIM-REF-003 | error | noCircularRefs | 待核实 | 执行，可产出 | — |
| 17 | 2023-baseline/claims.json | CLAIM-SUP-001 | error | featuresSupportedInSpec | 待核实 | 未执行（需实质判断） | “本版未自动检查，需人工核对” |
| 18 | 2023-baseline/claims.json | CLAIM-SUP-002 | warning | specNotBeyondDisclosure | 待核实 | 未执行（需法律判断） | “本版未自动检查，需人工核对” |
| 19 | 2023-baseline/invention.json | INV-OBJ-001 | error | objectEligible | 待核实 | 未执行（需法律判断） | “本版未自动检查，需人工核对” |
| 20 | 2023-baseline/invention.json | INV-ALGO-001 | warning | algorithmBoundToTechnical | 待核实 | 未执行（需技术/法律判断） | “本版未自动检查，需人工核对” |
| 21 | 2023-baseline/utility-model.json | UM-OBJ-001 | error | productObjectEligible | 待核实 | 未执行（需法律判断） | “本版未自动检查，需人工核对” |
| 22 | 2023-baseline/utility-model.json | UM-FIG-001 | error | figuresRequired | 待核实 | 执行，可产出 | — |
| 23 | 2023-baseline/utility-model.json | UM-CLAIM-001 | error | independentClaimProductOnly | 待核实 | 未执行（需法律判断） | “本版未自动检查，需人工核对” |
| 24 | 2026-01-01/ai-related.json | AI-INV-001 | error | inventorNaturalPerson | 待核实 | 执行（内置自然人检查） | — |
| 25 | 2026-01-01/ai-related.json | AI-INV-002 | warning | aiDisclosureConfirmed | 待核实 | 执行，可产出 | — |
| 26 | 2026-01-01/ai-related.json | AI-DISC-001 | error | aiDisclosureComplete | 待核实 | 执行，可产出 | — |
| 27 | 2026-01-01/ai-related.json | AI-ETH-001 | warning | aiEthicsStatement | 待核实 | 执行，可产出 | — |
| 28 | 2026-01-01/ai-related.json | AI-EXAM-001 | info | aiInventiveContribution | 待核实 | 执行，可产出 | — |

## 语义边界

- 规则包法律条目仍受 G-RULES closed 限制：所有非产品条目为 `unverified`，即使 `deterministicCheck` 命中也不形成 blocker，与既有“法律规则不阻断”语义一致。
- 新实现只读取现有 AST、事实、图集、优先权和人员数据；未实现项分为“需要法律/实质判断”和“当前缺少确认数据入口”两类，统一按未执行条目展示。
- 内置工程检查（`BUILTIN_CHECKS`，如 `ast.invalid`、`claim.dependency_cycle`、新增 `inventor.natural_person`）不属于 28 条规则包行，未计入本表的 19/28；它们仍按工程规则产出阻断/风险项。
