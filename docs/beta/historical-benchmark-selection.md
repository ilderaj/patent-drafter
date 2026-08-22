# 历史基准 Case 选择（Slice 1 固定）

- 日期：2026-08-22
- 用途：首笔收款前，以已知发明 + 已知实用新型各一件验证真实检索管线（Phase B 硬验收）。
- 原则：只使用可合法处理、适合基准验证的公开材料；不执行真实 10/40/8 检索（归属 Slice 2）。

## 1. 客观评分标准

| 标准 | 说明 |
| --- | --- |
| 公开可访问 | 主要公开页面可 fresh 验证（HTTP 200），不含付费/登录墙 |
| 已知接近文献可恢复 | 存在预先记录的已知接近现有技术（引用或技术近邻），可检验 Slice 2 召回 |
| 家族去重可检验 | 同族可见（Also Published As / DocDB 族），可验证去重逻辑 |
| 合法与隐私 | 仅公开书目元数据与公开页面，不涉及 private fixture 内容 |
| 协议适配 | 覆盖 CN/EP 两类文献体系与 evidenceType 三态区分 |

## 2. 发明 Case：EP2845700A1

- 标题：Clippers for separating chocolate pieces；公开页 fresh 200（2026-08-22）。
- 适选理由：公开 Citations 表含 5 条 examinerCited 标记文献（* Cited by examiner 图例），具备强恢复锚点；
  同族可见 DK2845700T3 / EP2845700B1 / DE202013104051U1，可检验家族去重。
- 收录锚点（examiner_citation）：FR742229A、DE202006019957U1、US20090308211A1、US20110289784A1、US20130183631A1
  （均来自 EP2845700A1 公开页 Citations(7) 表 itemprop="examinerCited"，且各自公开页 fresh 200）。
- 排除：US7717017B2 未出现在 EP2845700A1 公开页任何引证/家族区块，无法 fresh 验证，故不收录。

## 3. 实用新型 Case：CN221531624U

- 标题：一种基于三模通讯的共享热水表；公开页 fresh 200（2026-08-22）。
- 适选理由：申请人自己说明书背景技术段（p0005）明示对比文件 CN217157378U，构成 applicant_background 锚点；
  已确认技术近邻 CN209417602U（LoRa + Zigbee 双无线智能流量控制器）可作 technical_neighbor 恢复锚点。
- 与既有已验收材料的对应：定稿说明书背景技术含 CN217157378U，本次选择与其一致。

## 4. 证据类型区分（Evidence Type Distinctions）

- `examiner_citation`：公开检索/审查引用记录中由审查员标记（如 Google Patents * Cited by examiner）的文献。
  本基准仅收录 EP2845700A1 公开页上带 examinerCited 标记的 5 条。
- `applicant_background`：申请人自己在申请文件中引用的背景/对比文献；本基准为 CN221531624U 说明书 p0005 中的 CN217157378U。
- `technical_neighbor`：技术主题接近的文献，用于检验近邻查询召回；不得标记为 examiner_citation。
  本基准为 CN209417602U（不出现在 CN221531624U 公开页引证表，故仅作技术近邻锚点）。

## 5. 已知局限（Known Limitations）

- EPO 深链 403：`https://link.epo.org/elearning/uDYhCZd` 与 `https://register.epo.org/help?lng=en&topic=citations`
  在 2026-08-22 以默认 UA 与浏览器 UA 均返回 HTTP 403；Espacenet 检索页同返回 403。
  因无第二条公开路径证明其内容，全部排除出 evidenceUrl，仅在此披露限制；Slice 2 可用可见浏览器或 OPS 路径复核。
- US7717017B2 未在 EP2845700A1 公开页出现，排除（见第 2 节）。
- 公开页静态 HTML 与 JavaScript 渲染视图可能存在差异，引证标记以页面图例与 itemprop 为准；
- 本切片未运行真实 10/40/8 检索，下述断言均为 Slice 2 预期，未经实测确认。

## 6. Slice 2 预期恢复断言（Expected-Recovery Assertions）

invention（EP2845700A1）：

1. 检索必须找回 FR742229A 并标记为 examiner_citation（引用路径族与关键词族均可）；
2. 检索必须找回 DE202006019957U1、US20090308211A1、US20110289784A1、US20130183631A1 并标记为 examiner_citation；
3. 家族去重后 EP2845700A1 同族（至少 DK2845700T3/EP2845700B1/DE202013104051U1）只占 1 个族；
4. 全部断言须在 10 条查询式/40 个去重专利族/8 篇深读上限内完成。

utility_model（CN221531624U）：

1. 检索必须找回 CN217157378U 并标记为 applicant_background（背景引证路径）；
2. 检索必须找回 CN209417602U 并标记为 technical_neighbor（技术近邻查询族）；
3. 两项断言均不得因公开索引显示"相似文献"而改标为 examiner_citation；
4. 全部断言须在 10/40/8 上限内完成，报告中不提供授权概率、FTO 或法律意见，不表示穷尽全球文献。

