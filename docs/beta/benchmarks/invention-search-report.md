# EP2845700A1 检索基准报告（beta-slice-2a / invention）

- 日期：2026-08-22
- Case：EP2845700A1 (Clippers for separating chocolate pieces)
- 切片：beta-slice-2a-invention-benchmark
- 状态：candidate_partial_2a（执行 worker 候选；人工签核待 Chief/创始人）
- 工具结论：conditional_go（条件见第 11 节）

## 1. 执行概况

在 10 条查询式 / 40 个去重专利族 / 8 篇深读上限内完成 invention Case 基准检索。
查询面：Google Patents 公开检索接口（XHR，浏览器 UA，HTTP 200）；页面与证据 URL fresh 验证（HEAD/GET 200）。
官方 EPO 深链在本窗口 403/503 不可用（Slice 1 已知限制），全部证据 URL 使用公开聚合器并标注 fallback。

## 2. 查询记录（10/10，四族覆盖）

| 查询 | 族 | 查询式 | 命中 | 首跑时间 | 备注 |
|---|---|---|---|---|---
| Q01 | keyword | chocolate pliers | 2898 | 2026-08-22T15:10:37Z | top page-1 hits screened; broad confectionery/food noise excluded |
| Q02 | keyword | "chocolate pieces" separating | 1682 | 2026-08-22T15:10:38Z | quoted phrase; chocolate-processing literature surfaced |
| Q03 | keyword | Toblerone clippers | 1 | 2026-08-22T15:10:39Z | discriminator query; single hit EP2845700B1 (own family) |
| Q04 | classification | CPC:A23G7/0018 | 292 | 2026-08-22T15:10:40Z | apparatus for cutting or dividing chocolate or candies |
| Q05 | classification | CPC:A47J43/28 | 3913 | 2026-08-22T15:10:42Z | kitchen/food implements; noise screened out |
| Q06 | citation | (FR742229A OR DE202006019957U1) | 2 | 2026-08-22T15:10:44Z | backward references from EP2845700A1 citation table; both examiner anchors recovered |
| Q07 | citation | (US20090308211A1 OR US20110289784A1) | 2 | 2026-08-22T15:10:44Z | backward references from EP2845700A1 citation table; both examiner anchors recovered |
| Q08 | citation | (US20130183631A1 OR GB2270248A OR IT1200532B) | 5 | 2026-08-22T15:10:45Z | citation-table references; 3 targets + GB655584A unexplained + EP2845700B1 own family |
| Q09 | semantic_neighbor | similar:EP2845700A1 | 1 | 2026-08-22T15:10:45Z | similar operator returns origin record only; neighbor candidates harvested from Similar Documents table (25 entries) |
| Q10 | semantic_neighbor | chocolate cutting tool | 123745 | 2026-08-22T15:10:46Z | broad wording; heavy noise; screened to relevant cohort |

## 3. 筛选与家族去重（40 族）

筛选规则：保留（a）5 条 examiner 锚点及其家族；（b）EP2845700A1 页 Similar Documents 表全部 24 条非自身条目；
（c）关键词/分类查询首页命中中与巧克力/糖果切割或手持分离工具相关的条目；剔除明显噪声（农药、医药、饮料机、机器人等）。

| # | 族 ID | 代表公开号 | 成员 | 筛选理由 |
|---|---|---|---|---|
| 1 | FAM-EP2845700 | EP2845700A1 | EP2845700A1, EP2845700B1, DK2845700T3, DE202013104051U1 | target case family; single DocDB slot |
| 2 | FAM-FR742229A | FR742229A | - | examiner anchor FR742229A |
| 3 | FAM-DE202006019957U1 | DE202006019957U1 | - | examiner anchor DE202006019957U1 |
| 4 | FAM-US20090308211A1 | US20090308211A1 | - | examiner anchor US20090308211A1 |
| 5 | FAM-US20110289784A1 | US20110289784A1 | - | examiner anchor US20110289784A1 |
| 6 | FAM-US20130183631A1 | US20130183631A1 | - | examiner anchor US20130183631A1 |
| 7 | FAM-IT1200532B | IT1200532B | - | citation-table reference without examiner mark; title HOME-MADE TOOL FOR CUTTING NOUGAT (Q08) |
| 8 | FAM-GB2270248A | GB2270248A | - | citation-table reference without examiner mark; title A confectionery breaker (Q08) |
| 9 | FAM-GB655584A | GB655584A | - | unexplained Q08 match (shock absorber systems); retained for transparency, low relevance |
| 10 | FAM-DE102006012754B4 | DE102006012754B4 | - | top similar document (Surgical instrument) |
| 11 | FAM-DE2713410A1 | DE2713410A1 | - | similar document (pliers for ear markings) |
| 12 | FAM-EP0454615B1 | EP0454615B1 | - | similar document (forceps for cutting surgical nails) |
| 13 | FAM-EP1159870A2 | EP1159870A2 | - | similar document (handheld garden/branch secateurs) |
| 14 | FAM-EP0416358A2 | EP0416358A2 | - | similar document (shaving head); low topical overlap, retained for completeness |
| 15 | FAM-DE202009001625U1 | DE202009001625U1 | - | similar document (separating device for shearing) |
| 16 | FAM-DE3141248A1 | DE3141248A1 | - | similar document (power-driven screwdriver); low topical overlap |
| 17 | FAM-EP1319456A1 | EP1319456A1 | - | similar document (cable cutter) |
| 18 | FAM-DE102014104146B4 | DE102014104146B4 | - | similar document (punch) |
| 19 | FAM-EP3643465A1 | EP3643465A1 | - | similar document (hand-held cutting planer) |
| 20 | FAM-EP3854550B1 | EP3854550B1 | - | similar document (quick connector for blade) |
| 21 | FAM-DE1300451B | DE1300451B | - | similar document (disc cutter) |
| 22 | FAM-DE3407646A1 | DE3407646A1 | - | similar document (device for taking material samples); low topical overlap |
| 23 | FAM-EP0058349A2 | EP0058349A2 | - | similar document (tool for deforming/pressing) |
| 24 | FAM-DE9015493U1 | DE9015493U1 | - | similar document (device for cutting stems of cut flowers) |
| 25 | FAM-EP1045499A1 | EP1045499A1 | - | similar document (pliers) |
| 26 | FAM-DE202016106708U1 | DE202016106708U1 | - | similar document (hand tool for mincing food) |
| 27 | FAM-DE20308397U1 | DE20308397U1 | - | similar document (pruning shears) |
| 28 | FAM-DE326294C | DE326294C | - | similar document (device supporting workpieces when shearing) |
| 29 | FAM-DE459543C | DE459543C | - | similar document (machine for making wire nails) |
| 30 | FAM-DE232560C | DE232560C | - | similar document (no title rendered) |
| 31 | FAM-DE113958C | DE113958C | - | similar document (no title rendered) |
| 32 | FAM-DE8321569U1 | DE8321569U1 | - | similar document (pliers for stripping/cutting) |
| 33 | FAM-DE676538C | DE676538C | - | similar document (ear tag pliers) |
| 34 | FAM-EP2227094B1 | EP2227094B1 | - | keyword cohort: chocolate/chocolaty product process |
| 35 | FAM-EP3007990B1 | EP3007990B1 | - | keyword cohort: packaged food item |
| 36 | FAM-US7329429B2 | US7329429B2 | - | keyword cohort: bars and confectioneries containing cocoa solids |
| 37 | FAM-EP2187758B1 | EP2187758B1 | - | classification cohort: processing confectionery products |
| 38 | FAM-US20190335784A1 | US20190335784A1 | - | classification cohort: assembly line food production and pull-apart |
| 39 | FAM-US20240000100A1 | US20240000100A1 | - | classification cohort: scoring and/or cutting chewing gum |
| 40 | FAM-AU2012390069A1 | AU2012390069A1 | - | classification cohort: container for receiving and splitting product plates |

## 4. 家族归并证据（EP2845700 单槽）

EP2845700A1 / EP2845700B1 / DK2845700T3 / DE202013104051U1 归并为单一 DocDB 族（FAM-EP2845700）。
证据来源：EP2845700A1 Google Patents 公开页 Also Published As 表（itemprop=docdbFamily）：
DK2845700T3（2016-10-03）、EP2845700B1（2016-06-22）、DE202013104051U1（2013-09-26）。
限制：以公开聚合器索引为准；官方 EPO 索引未在本窗口 fresh 验证（403/503），族完整性受聚合器索引局限。
重跑：未执行（上游 503 窗口持续整个运行时段，见第 12 节）；familyMerge 稳定性断言因此为 pending，不得宣称稳定。

## 5. 证据恢复（examiner 锚点 5/5）

| 锚点 | 类型 | 恢复查询 | URL 首跑/重跑状态 | 数据来源（节选） |
|---|---|---|---|---|
| FR742229A | examiner_citation | Q06 | 200/503 | EP2845700A1 Google Patents public page Citations(7) table, examiner-marked rows (caption: ... |
| DE202006019957U1 | examiner_citation | Q06 | 200/503 | EP2845700A1 Google Patents public page Citations(7) table, examiner-marked rows (caption: ... |
| US20090308211A1 | examiner_citation | Q07 | 200/503 | EP2845700A1 Google Patents public page Citations(7) table, examiner-marked rows (caption: ... |
| US20110289784A1 | examiner_citation | Q07 | 200/503 | EP2845700A1 Google Patents public page Citations(7) table, examiner-marked rows (caption: ... |
| US20130183631A1 | examiner_citation | Q08 | 200/503 | EP2845700A1 Google Patents public page Citations(7) table, examiner-marked rows (caption: ... |

证据标记规则：examiner_citation 仅用于 EP2845700A1 公开页 Citations(7) 表中带 * Cited by examiner 图例的 5 条；
IT1200532B、GB2270248A 无 examiner 图例，不做 examiner_citation 标记（严格三态枚举下归入 technical_neighbor 讨论，见局限）。

## 6. 特征映射（8 篇深读，5 特征）

特征项：FE1 手操作钳式结构（双腿+铰接）；FE2 巧克力复合条分离目的；FE3 双颚钳头；FE4 分离/预定断裂线单元；FE5 承接/分份单元。

| 深读文献 | FE1 | FE2 | FE3 | FE4 | FE5 | 风险 |
|---|---|---|---|---|---|---|
| FR742229A | 部分 | 部分 | 部分 | 部分 | 部分 | high |
| DE202006019957U1 | 有 | 有 | 有 | 有 | 有 | medium |
| US20090308211A1 | 有 | 有 | 有 | 有 | 有 | medium |
| US20110289784A1 | 有 | 有 | 有 | 有 | 有 | medium |
| US20130183631A1 | 有 | 有 | 有 | 有 | 有 | low |
| GB2270248A | 部分 | 部分 | 部分 | 部分 | 部分 | high |
| IT1200532B | 部分 | 部分 | 部分 | 部分 | 部分 | high |
| DE102006012754B4 | 部分 | 部分 | 部分 | 部分 | 部分 | high |

深读依据与逐项差异说明见 fixture（evidenceBasis / featureMatrix 字段）。

## 7. URL 验证摘要

first-run（2026-08-22T15:06Z 批次）HTTP 200：
EP2845700A1 / EP2845700B1 / DK2845700T3 / DE202013104051U1 / FR742229A / DE202006019957U1 /
US20090308211A1 / US20110289784A1 / US20130183631A1（9 条 URL，全部 first-run 200）。
rerun：未执行，上游 503 节流（16:01:14Z 最终尝试仍 503），rerun 状态全部记录为 503/未验证（不伪造）。
GB2270248A / IT1200532B / DE102006012754B4 页面在窗口内 503 节流，未收录为证据 URL（见失败/缺口日志）。
未出现 403 深链保留情形；未绕行 WAF/CAPTCHA。

## 8. 风险与局限

- 不提供授权概率、FTO 或法律意见；本报告不表示穷尽全球文献。
- 深读文献 GB2270248A / IT1200532B / DE102006012754B4 / FR742229A 存在 title-only 或元数据级证据缺口，风险层级 high。
- 家族归并依赖公开聚合器索引；Q10 宽泛查询与 Q08 意外命中（GB655584A）已如实记录。
- 上游 503 节流窗口（自 2026-08-22T15:11Z）导致部分页面重试滞后，重跑记录见 fixture rerun 区块。

## 9. 失败/缺口日志

- F1 官方 EPO 深链 403/503（Slice 1 已知，本窗口复核未缓解）。
- F2 GB2270248A / IT1200532B / DE102006012754B4 全文页节流 503，未取得全文。
- F3 FR742229A 无 OCR 标题/摘要文本。
- F4 Q08 意外命中 GB655584A 未定位原因（编号解析噪声假设）。
- F5 未注册第三方账户、未使用付费 API、未绕行 WAF/CAPTCHA。

## 10. 人工签核

本候选由 beta-slice-2a 执行 worker 生成并记录签核项（fixture humanSignoff.items），
status=pending_chief_or_founder：查询式清单、筛选理由、家族归并、锚点标记、特征矩阵、URL 验证、
局限与缺口日志均待 Chief/创始人最终签核。

## 11. 工具结论

verdict=conditional_go（candidate_partial_2a），条件：
（1）上游 503 解除后执行 rerun 通过（相同输入重跑 Q06/Q07/Q08 + 9 条 URL 复验 + 家族归并复提取），使 invention validator 转 GREEN；
（2）GB2270248A / IT1200532B / DE102006012754B4 全文在上游恢复后补深读复核；
（3）人工签核由 Chief/创始人完成；
（4）utility_model Case 及证据类型区分扩展在 2b 完成并验证。

因此，本候选 invention validator 预计 RED（exit 1）：缺失 rerun 断言/哈希与 rerun URL 200 复验，属诚实缺口而非伪造。

## 12. 重跑状态（blocked）

- rerun 输入：与 first-run 完全相同的 3 条引证查询 URL 与 EP2845700A1 家族页 URL（inputsHash 见 fixture rerun.firstRun.inputsHash）。
- 上游 503 节流窗口：2026-08-22T15:11Z 起持续，16:01:14Z 最终批次（sleep 900 后触发）全部请求仍 503（XHR 与页面均被节流）。
- 官方回退面：Espacenet 403、EPO Register 403、PATENTSCOPE 连接重置（Slice 1 F1 复核未缓解）。
- 已披露：rerun.rerun.at=null、assertionsStable=false、rerunUrlCheck 均记录 503；无任何伪造时间戳或哈希。
- 恢复后重放命令与输入已固化在 fixture/rerun 区块与报告第 2/4/5 节；单一可见 worker 可独立复跑并以相同 validator 验收。

免责声明：本报告与关联产物不提供授权概率、FTO 或法律意见，不表示穷尽全球文献；检索到高度接近的现有技术
与未发现阻断性现有技术均为协议范围内的有效交付结果，任一结论都不构成授权概率、FTO 或法律意见。
