# v6 产品与交互事实采集（只读审计）

日期：2026-11-10。性质：只陈述事实并标出处，不做优先级判断。未修改任何代码或文档（本文件为唯一新增产物），未派发 agent。

## 0. 方法与边界

- A 部分读取主仓库 `/Users/jared/Personal Projects/Patent/docs/` 的工作区当前内容。会话开始时 `git status` 显示这些文档已有未提交修改（如 `docs/product-spec.md`、`docs/plans/...` 为 M），因此引用的是工作区版本，不是某个已提交版本。
- B、C 部分读取工作树 `.claude/worktrees/v6-prototype-alignment`（分支 `codex/v6-prototype-alignment`）的 `apps/web/src/v6`、`packages/rules-cn`、`packages/domain/src/v6`。
- 路径省略前缀：`apps/web/src/v6/` 简写为 `v6/`；`docs/` 简写为主仓库文档路径。
- 「未核实」表示本次只做了静态检索，未读到对应实现，或未在浏览器中验证。未做浏览器实测。
- 行号来自读取时的文件内容。

---

## A. 目标与市场（主仓库文档中明确写下的内容）

### A1. 目标用户画像

- 海外中文硬件团队：90 天内拟发布、众筹或公开演示，可接触决策人或发明人。`docs/mvp-portfolio.md:7`；`docs/plans/patent-beta-mvp.md:9`
- 中国机械、电子硬件、设备控制研发团队。`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:7`
- 中国发明人和研发团队，把已有技术材料整理成申请材料准备包。`docs/patent-saas-evolution-proposal-2026-10-16.md:7`
- 假设中的硬件创业团队、小型制造企业、研发人员；专利代理机构作为专业审阅合作方或后续团队客户。`docs/patent-saas-evolution-proposal-2026-10-16.md:11`
- 中国研发团队出海，需要双语专利材料准备与专业交接。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:7`
- 中国硬件或研发企业、涉外代理团队（买方）；当地专利事务所或企业 IP 团队（另一条路线）；发明人与小团队（海外自助，「暂不作为主入口」）。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md` §1 表（约 :9–19）
- 自助申请用户（发明人/小团队）与专业用户（收件箱、案件、多目标）。`docs/design/patent-saas-v6/README.md:22–35`
- 产品定位原文仅写「中国专利申请文件起草助手」，未限定用户群。`docs/product-spec.md:7`

### A2. 目标市场与法域

- 产品规格：中国实用新型（正式）、发明专利（Beta）；技术领域为机械、电子、通信、IoT、控制系统、简单软硬结合发明。`docs/product-spec.md:41–42`
- 产品规格明确不支持：外观设计、化学/药品/生物/中药、复杂医疗、PCT、审查意见答复。`docs/product-spec.md:46–48`
- 进化方案：首批技术范围限定为机械结构、电子硬件与物联网；发明专利仅开放已建立质量基准的子领域；化学、生物、医药、序列表、外观设计及海外申请「先走明确的不支持或人工」。`docs/patent-saas-evolution-proposal-2026-10-16.md:13`
- 商业实施计划：首期只开中国发明/实用新型受控案件。`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:9`
- MVP 计划：标准包为发明或实用新型二选一，未写其他法域。`docs/plans/patent-beta-mvp.md:13`
- 出海文档：美国为首个目标申请地区；EPO 为第二规则包；加拿大由实际客户需求驱动；墨西哥「不列为当前支持地区」。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:7`；地区表见同文件 §2（约 :23–29）
- 出海文档：PCT 定位为「路由选项，不是第四个授权地区」。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:61`
- v6 基线：R1 路线为 CN 实用新型、CN 发明、US、PCT；EP 不是可生成路线，只保留为人工服务需求。`docs/implementation/patent-saas-v6/00-baseline.md:27`，`:67–68`（B11、B12）
- 代码中的路线枚举：`cn_um`「中国实用新型」、`cn_invention`「中国发明」、`us_nonprovisional`「美国非临时申请」、`pct`「PCT 国际申请」。`v6/features/targets/targets.ts:162–187`
- 代码中 EP 不进入路线枚举，返回提示。`v6/features/targets/targets.ts:89`

### A3. 要解决的问题

- 把散乱交底材料变成有证据来源、会主动补问、可审校和可回溯的申请文件草案包。`docs/product-spec.md:7`
- 减少整理、反复补充、文档一致性检查和专业人员交接的时间；不能以生成速度、文件数量或模型名称作为主要价值。`docs/patent-saas-evolution-proposal-2026-10-16.md:7`、`:9`
- 减少交底整理、反复追问和材料修订成本。`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:7`
- 交付物是供客户或代理人继续复核的中国专利申请准备包。`docs/plans/patent-beta-mvp.md:9`
- 让当地专业人员更快理解发明、发现缺口并接手起草。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:7`
- v6 原型：用户以一份材料或五个回答开始，形成可追溯的事实和草稿。`docs/implementation/patent-saas-v6/00-baseline.md:13`

### A4. 商业模式与定价假设

- MVP 人工服务：首 5 单标准价 US$499，全额预付；发明/实用新型二选一。`docs/plans/patent-beta-mvp.md:13`
- 英文加购 US$199、最多 2 小时。`docs/plans/patent-beta-mvp.md:19`
- 人工按 US$50/小时计；非人工变动成本上限 US$40；贡献毛利至少 40%；标准 Case 最多 4 小时。`docs/plans/patent-beta-mvp.md:17`
- 单位经济推演：US$499 − 4×US$50 − US$40 = US$259，约 51.9% 贡献毛利，距 40% 底线约 US$59.4。`docs/plans/patent-beta-mvp.md:58`
- 交付周期：材料完整、平台确认且付款到账后 5 个工作日。`docs/plans/patent-beta-mvp.md:16`
- 纠错：14 天一次。`docs/plans/patent-beta-mvp.md:18`
- 结案后 30 天删除 QA 副本。`docs/plans/patent-beta-mvp.md:21`
- 另一产品线（Scanner）假设：后续 Deep IP Scan US$29。`docs/mvp-portfolio.md:10`（非本产品，仅列出）
- 进化方案分层：免费体验、单案材料准备包、专业审阅服务、团队方案。`docs/patent-saas-evolution-proposal-2026-10-16.md:19–24`
- 进化方案明确「不沿用旧文档的美元价格作为新中国市场定价结论」。`docs/patent-saas-evolution-proposal-2026-10-16.md:26`
- 进化方案给出单案贡献毛利公式（实收 − 支付手续费 − 模型/解析/检索 − 专业审阅与客服人工 − 退款及重做 − 存储交付成本）。`docs/patent-saas-evolution-proposal-2026-10-16.md:28`
- 进化方案价格实验：先访谈约 10 位目标用户，招募 5–10 个授权试点。`docs/patent-saas-evolution-proposal-2026-10-16.md:30`
- 商品阶段 S0–S4：S0 逐案报价；S1 单案权益；S2 团队基础费加案件用量（「待成本验证」）；S3 按案加当地专业服务分列；S4 按地区计费假设。`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:13–21`
- 出海文档：首期按案收取材料准备费，专业审阅与提交费用分列；团队订阅待复购验证。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:129`
- 出海文档：贡献毛利需扣除模型基础设施、翻译/专业审阅、图稿、支持返工、支付费用、预计退款；获客成本另计。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:131`
- 出海文档：试点规模建议 2–3 个合格合作方、5–10 个案件（「不是统计学证明」）。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:133`
- v6 原型套餐（标注「演示占位」）：免费 ¥0；单案解锁 ¥399/案（含 2 次重新生成）；专业版 ¥299/月（每月 3 案）；人工服务咨询 ¥299、复核 ¥1,200 起。`docs/design/patent-saas-v6/README.md:50–53`
- 原型声明「所有金额为演示占位，未做定价评审」。`docs/design/patent-saas-v6/README.md:55`
- v6 基线：金额只在 sandbox catalog 中，生产价格版本为空时关闭收费按钮。`docs/implementation/patent-saas-v6/03-decisions.md:26`（D18）
- v6 基线：单案使用权无周期到期；订阅额度解锁过的案件保留材料访问。`docs/implementation/patent-saas-v6/00-baseline.md:69`（B13）

### A5. 成功指标

- MVP 通过门（21 天 Beta，P5）：5 实付；至少 3 按 SLA 交付；整体毛利 ≥ 40%；至少 3 包交代理且无核心缺项 P0 退回。`docs/plans/patent-beta-mvp.md:43`
- P6 决策：同时达到既有四项成功条件才评估 SaaS；失败则冻结平台建设。`docs/plans/patent-beta-mvp.md:44`
- 进化方案早期指标：关键事实新增错误数、无来源特征漏检、引用可定位率、人工修订时间、一次交付可用率、追问数量与完成率。`docs/patent-saas-evolution-proposal-2026-10-16.md:128`
- 进化方案 §7.4 漏斗：公开内容 → 开始诊断 → 材料合格 → 付款 → 完成交付 → 修订/退款。`docs/patent-saas-evolution-proposal-2026-10-16.md:165`
- 出海文档衡量顺序：有效咨询 → 合格案件 → 付费 → 合作方接受 → 贡献毛利；搜索曝光与 AI 引用「不独立当作商业成功」。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:150`
- 路线图分阶段指标：阶段 1 保存失败可见性、版本检查一致性；阶段 2 事实追溯率、补问数量；阶段 3 付费到交付、退款原因、贡献毛利；阶段 4 回填凭证完整性；阶段 5 复购与海外合作方接受度。`docs/plans/patent-product-roadmap-2026-10-18.md:50–57`
- 商用验收合同（S1 收费开放前）列出 9 项条件，含支付回调验签与幂等、用户数据隔离、至少一个全流程授权案件。`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:27–41`
- v6 原型与 v6 基线未写商业指标。

### A6. MVP 范围定义

- 产品规格「支持」：实用新型（正式）、发明专利（Beta）；技术领域；DOC、DOCX、PDF、扫描 PDF、TXT、Markdown、PNG、JPEG；多附件；草案包输出与 .patentpack 导入导出。`docs/product-spec.md:37–44`
- 产品规格「不支持（MVP）」：外观设计、化学/药品/生物/中药、复杂医疗、PCT、审查意见答复、自动申报、授权概率预测；ChatGPT subscription 仅接口预留。`docs/product-spec.md:46–49`
- MVP 计划「四个必要交付面」：可信检索；最小运营包；一次完整干跑；条件式产品修补。`docs/plans/patent-beta-mvp.md:27–30`
- MVP 计划：现有 18 阶段起草管线、审校和多文件导出作为操作者工具保留；不以完成更多屏幕、全量视觉重构、SaaS 账户或自动支付为 MVP 目标。`docs/plans/patent-beta-mvp.md:32`
- 商业计划首期不投入：全自动代申请、授权预测分数、全球多语种模板、自动微调、复杂团队管理、内置支付渠道大全、全套微服务。`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:25`（段落 `首期不投入`）
- v6 覆盖表：27 个页面键、每页标注 R1–R4 阶段。`docs/implementation/patent-saas-v6/00-baseline.md:17–51`
- v6 能力范围表：R1 为本地可用准备包；R2 为 Web SaaS；R3 为专业协作与人工服务；R4 为原生 macOS。`docs/implementation/patent-saas-v6/00-baseline.md:78–86`
- v6 本轮不实现：自动法律期限、自动递交、授权保证、EP 全案。`docs/implementation/patent-saas-v6/00-baseline.md:86`

### A7. 已知未决决策

- v6 原型列出 6 项「需要评审的决定」：自助与专业分界；单案价与订阅关系；公开历史风险处理；人工服务入口数量；专业版默认案件与多目标；Web 与 macOS 付费差异。`docs/design/patent-saas-v6/README.md:77–82`
- v6 决策登记 G-REGION、G-AUTH、G-MODEL、G-PAY、G-EXPERT、G-RULES、G-XML、G-SEARCH、G-MAC、G-RELEASE 十个发布门，每项列 owner 与证据要求。`docs/implementation/patent-saas-v6/03-decisions.md:33–44`
- 决策登记规定：执行者遇到未覆盖决定返回 `NEEDS_DECISION`，不能默认开放功能。`docs/implementation/patent-saas-v6/03-decisions.md:3`
- 商业计划 §8「仍需业务侧落定的事项」：经营与收款主体、专业审阅责任人、实际交付 SLA、可承接领域、供应商/数据地域、退款和修订合同。`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:154`
- MVP 计划：限定专业审阅仍是首笔收款前门。`docs/plans/patent-beta-mvp.md:23`
- MVP 计划：P1 若无可用来源则保持暂停；仅 Owner 明确同意另定义交付商品或放宽硬门后，才能重写合同。`docs/plans/patent-beta-mvp.md:46`
- 进化方案「推荐的下一步」。`docs/patent-saas-evolution-proposal-2026-10-16.md:210`（段落标题行）
- 出海文档 §8 暂停扩量信号：合作方重写成本不低于原流程；需要模型补造事实；不能满足数据处理条件；无合格责任方；持续负贡献毛利。`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:161`

### A8. 暂停 Beta 的原因（文档原文）

- 「执行仍暂停；本轮完成规划修订，不自动解除历史数据门或启动客户 Beta。」`docs/plans/patent-beta-mvp.md:3`
- 审计结论：当前关键门是族归并证据、实际数据流与完整干跑；「继续重做界面或开发完整 SaaS 无法关闭这些门」。`docs/patent-beta-audit-2026-09-07.md:3`
- 「历史执行暂停保持，非取消产品。」`docs/patent-beta-audit-2026-09-07.md:5`
- 两条产品线表：当前执行状态「继续暂停；本轮完成规划不自动恢复」。`docs/mvp-portfolio.md:13`
- v6 基线：旧文件中「暂停 Beta」限制真实客户试点、检索与商业开放。`docs/implementation/patent-saas-v6/00-baseline.md:9`
- v6 基线 B08：真实付费试点仍保留旧检索商业发布门，不宣称高质量检索已通过。`docs/implementation/patent-saas-v6/00-baseline.md:64`

### A9. 检索基准结论

- 检索协议上限：10 条查询、40 个去重专利族、8 篇深读。`docs/beta/search-protocol.md:32–35`；族去重以 DocDB 同族为基准。`docs/beta/search-protocol.md:38–41`
- 发明基准（EP2845700A1）`docs/beta/benchmarks/invention-search-report.md:7`：工具结论 `conditional_go`。
- 同文件 §11 `:148–154`：转 GREEN 的条件为上游 503 解除后重跑、GB2270248A / IT1200532B / DE102006012754B4 补深读、人工签核、实用新型扩展。
- 同文件 §12 `:156–160`：重跑状态 `blocked`；2026-08-22 起上游持续 503；Espacenet、EPO Register 403；PATENTSCOPE 连接重置。
- 发明 UI 快照 `docs/beta/benchmarks/invention-ui-search-report.md:14`：`candidate_partial`；旧验证器仍为 48/54 PASS（RED，exit 1）。`:62` 声明快照不建立可复现性。
- 实用新型族去重报告 `docs/beta/benchmarks/utility-model-family-dedup-report.md:18`：边界仅限固定 28 篇候选出版物池。`:61–63`：28 个单件组，未观察到池内重复 priority key；「不是全球专利族谱结论」。
- 实用新型 UI 快照（CN221531624U）`docs/beta/benchmarks/utility-model-search-report.md:1–11`：快照基线，`isFreshFutureRerun=false`；`:71–78` 列出未来重跑程序。
- 历史切片说明 `docs/beta/historical-benchmark-selection.md:48`：「本切片未运行真实 10/40/8 检索，下述断言均为 Slice 2 预期，未经实测确认。」
- MVP 审计 P-S1 `docs/patent-beta-audit-2026-09-07.md:15`：族证据报告只证明固定 28 个候选 priority key，不满足 DocDB 族去重要求。
- 当前审计 §4 A12（P0，若销售检索）：旧检索 fixture 检查 48/54，6 项失败涉及 fresh URL 与一致重跑。`docs/patent-saas-current-audit-2026-10-16.md` §4 表 A12 行。

### A10. 文档间矛盾（单列）

1. **目标用户**：海外中文硬件团队（`docs/mvp-portfolio.md:7`；`docs/plans/patent-beta-mvp.md:9`）｜中国机械/电子/设备控制研发团队（`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:7`）｜中国发明人（`docs/patent-saas-evolution-proposal-2026-10-16.md:7`）｜中国研发团队出海（`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:7`）。
2. **定价货币与价格**：US$499 + US$199（`docs/plans/patent-beta-mvp.md:13`、`:19`）｜¥399 单案 / ¥299 月（`docs/design/patent-saas-v6/README.md:50–53`）｜「不沿用旧文档的美元价格」（`docs/patent-saas-evolution-proposal-2026-10-16.md:26`）。
3. **检索是否包含在商品内**：「检索、FTO、代理提交和授权不作为默认包含项」（`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:9`）｜MVP 商品内含检索上限 10/40/8（`docs/plans/patent-beta-mvp.md:15`）｜产品规格「互联网研究默认关闭」（`docs/product-spec.md:20`）｜v6 允许「准备包」带风险、无检索时标「未检索」（`docs/implementation/patent-saas-v6/00-baseline.md:64`）。
4. **发明专利状态**：「发明专利（Beta）」（`docs/product-spec.md:41`）｜「发明专利仅开放已建立质量基准的子领域」（`docs/patent-saas-evolution-proposal-2026-10-16.md:13`）｜「首期只开中国发明/实用新型受控案件」（`docs/plans/patent-saas-commercial-implementation-2026-10-17.md:9`）。
5. **PCT / 美国**：不支持 PCT（`docs/product-spec.md:48`）｜v6 路线含 US 与 PCT（`docs/implementation/patent-saas-v6/00-baseline.md:27`；`v6/features/targets/targets.ts:178–187`）｜出海文档以美国为首个目标（`docs/patent-saas-europe-north-america-expansion-2026-10-16.md:7`）。
6. **产品形态**：本地优先，公网只分发静态资源（`docs/product-spec.md:10`）｜人工服务 + 加密包、结案后删除（`docs/plans/patent-beta-mvp.md:21`）｜R1 本地、R2 服务端权威存储（`docs/implementation/patent-saas-v6/03-decisions.md:12`，D04）｜Node 22 + Fastify + PostgreSQL + S3（`docs/implementation/patent-saas-v6/03-decisions.md:13`，D05）。
7. **视觉与组件框架**：延续暖纸色与橙色主操作，并迁移到 shadcn 组件（`docs/patent-saas-ux-spec-2026-10-17.md:11`，§5 见 :141）｜v6「不同时迁移到另一组件框架」（`docs/implementation/patent-saas-v6/03-decisions.md:17`，D09）。
8. **交付物**：产品规格输出物不含 XML（`docs/product-spec.md:11`）｜v6 交付页说明 XML 需按官方工具校验（`docs/design/patent-saas-v6/README.md:30`）｜v6 基线 XML 标 `unavailable`（`docs/implementation/patent-saas-v6/00-baseline.md:66`，B10）。
9. **删除与保留**：结案后 30 天删除 QA 副本（`docs/plans/patent-beta-mvp.md:21`）｜单案使用权无周期到期，删除后不承诺恢复（`docs/implementation/patent-saas-v6/00-baseline.md:69`，B13）。两者针对不同场景，但文档未说明互相关系。
10. **免费预览内容**：原型 self.js 称含摘要；原型 README 称前三部分；v6 基线裁决为仅权利要求、技术领域、背景技术（`docs/implementation/patent-saas-v6/00-baseline.md:58`，B02）。基线已裁决，但原型文件内部矛盾已记录。
11. **检索与商业门**：旧检索硬门仍在（`docs/implementation/patent-saas-v6/03-decisions.md:42`，G-SEARCH）｜v6 普通准备包允许带风险确认下载（`docs/implementation/patent-saas-v6/00-baseline.md:64`，B08）。

---

## B. 当前实现的功能清单（工作树 `v6/`）

状态定义：**可用**＝有真实本地逻辑；**仅测试输出**＝只能走固定测试引擎，结果标「测试输出」；**说明性占位**＝界面可见但显示「尚未开放」或「不收费」等说明，无业务结果；**不存在**＝源码中无对应实现。

| 能力 | 状态 | 代码位置 | 说明 |
|---|---|---|---|
| 材料上传（PDF/DOCX/TXT/MD/PNG/JPEG） | 可用 | `v6/features/sources/Upload.tsx:59`、`:295`；`v6/features/sources/ingest.ts:47–53`、`:167` | 文档上限 50 MiB；图片 8 MiB 且 ≤16 MP（`ingest.ts:112–113`）；同时最多读取 3 个（`Upload.tsx:295`） |
| 加密文件拒绝 | 可用 | `ingest.ts:148–149`（加密 DOCX）、`:298`（加密 PDF） | 拒绝并给出提示 |
| 其他格式（如旧版 .doc） | 不存在（拒绝） | `ingest.ts:158–167` | 「只接受 PDF、DOCX、TXT、MD、PNG、JPEG」 |
| OCR（扫描件） | 说明性占位 | `v6/features/sources/parse.ts:88–91`（`OCR_PROVIDER_AVAILABLE = false`）；`:130` 提示文案 | 扫描页记为 `partial` 并提示手工补充文字；AI 配置有 `ocr` 用途枚举（`v6/features/ai/ai.ts:78`、`:218`、`:243`）但无提供方 |
| 解析流水线 | 可用 | `v6/features/sources/parse.ts:46`（stages：upload → verify → extract_text → ocr_check → chunk）；`:254`（chunk 类型） | 文字层检查；扫描页不冒充成功 |
| 附图（图片）上传 | 可用（语义未核实） | `v6/features/sources/Figures.tsx:299` | 仅见 `accept` 绑定；确定性附图生成未核实 |
| 五题问询 | 可用 | `v6/features/intake/intake.ts:84–120`（五题 key：problem、difference、inventorIds、disclosure、maturity）；`v6/features/self-service/QuestionsStep.tsx:122`、`:156–161` | 未完成本题时「请先完成这一题，再继续」 |
| 事实录入与冲突 | 可用 | `v6/features/intake/Intake.tsx:1016`（事实输入）、`:1149`（「保留冲突的理由（必填）」）；`v6/features/workbench/Workbench.tsx:149` | 冲突需填写理由才能保留 |
| 路线选择 | 可用 | `v6/features/targets/targets.ts:162–187`；`v6/features/self-service/RouteStep.tsx:236`（「保存路线并继续」） | 4 个路线；EP 不在枚举（`targets.ts:89`） |
| 英文（en-US）准备稿 | 不存在 | `v6/features/targets/targets.ts:85–86`、`:464–472` | 「R1 本机构没有可用的英文翻译与适格人员核对能力」 |
| 中文界面 | 可用（唯一语言） | 全部 TSX 为中文文案 | 界面内仍夹杂英文枚举，见 C 节 |
| 草稿生成（五阶段） | 仅测试输出 | `v6/features/generation/local-runtime.ts:1–35`（固定提示词，如「本地测试输出」「生成供人工审阅的测试说明书草稿」）；`v6/features/generation/generation.ts:30`（`MockProvider`）；`v6/features/ai/ai.ts:210–213`、`:448` | 「只返回固定测试输出，不连接模型、不发出网络请求」 |
| 真实模型（平台/本机/自带密钥） | 说明性占位 / 不存在 | `ai.ts:429–431`（平台：`RELEASE_GATE_CLOSED`）；`:356`、`:423`（本机模型仅桌面版）；`:357`、`:439`（自带密钥仅 R2/R4，浏览器不保存密钥） | 本构建无真实外发 |
| 草稿手工编辑 | 可用 | `v6/features/draft/Editor.tsx:887–999`（标题、权利要求编号与依赖、段落增删改）；`:951`（保存条件） | 生成内容为测试输出，编辑本身为真实本地保存 |
| 草稿审阅与逐段确认 | 可用 | `v6/features/draft/Review.tsx:151–168`（仅 AI/混合段落可确认）；`:620`、`:717` | 确认绑定修订，修订变化后失效（`:168`「修订或输入已变化」） |
| 支持表（要素与段落对应） | 可用 | `v6/features/draft/Review.tsx:301`（`buildSupportTable`） | 与 product-spec「支持矩阵」对应，未核实细节 |
| 检查（确定性规则） | 部分可用 | `v6/features/checks/Checks.tsx:309–345`；`v6/features/checks/rule-pack.vite.ts:3–11`；`packages/rules-cn/` | 28 条规则，见下表 B-检查 |
| 现有技术检索 | 不存在 | `v6/features/checks/Checks.tsx:345`（「现有技术检索：未检索」） | 只显示状态文字 |
| 风险确认 / 请专家 | 可用（专业检查页） | `Checks.tsx:54–56`（「确认风险」「请专家」「查看产品规则」）；`:163` | 自助页是否有同等按钮未核实 |
| 内部批准 | 可用（本地记录，非法定签名） | `v6/features/delivery/Approval.tsx:173–312`（`GATE_BLOCKED` :312；角色限制 :302）；`:759`（「当前 SnapshotRef」） | 批准绑定快照；界面有英文对象名 |
| 导出 DOCX | 可用 | `v6/features/delivery/export-adapter.ts:701`（MIME 映射）；依赖 `packages/export` | 测试输出时文件名加「测试输出-」前缀（`:748`） |
| 导出 PDF | 可用 | `export-adapter.ts:702`；`:771`（「提交检查清单.pdf」） | 同上 |
| 导出 .patentpack（加密包） | 可用 | `export-adapter.ts:703`；`:813`（「项目备份.patentpack」）；`v6/features/delivery/Done.tsx:233–239`（口令） | 口令必填，「不会保存」（`Done.tsx:235`） |
| 导出 JSON 清单 | 可用 | `export-adapter.ts:704` | — |
| XML 导出 | 不存在 | v6 源码检索无结果 | 原型与基线均标为需官方工具校验或 `unavailable` |
| 导出门禁 | 可用 | `Done.tsx:39`（`APPROVAL_REQUIRED`）、`:181–182`（`CACHE_EXPIRED`、`STALE_BINDING`） | 错误码与中文说明并列 |
| 备份与恢复（.patentpack） | 可用（本机） | `v6/features/recovery/Recovery.tsx:191`（不恢复批准、身份、权益、分享）、`:218–226`（三种访问模式）、`:240–257`；`v6/routes/V6App.tsx:274`（挂在「设置」） | 恢复写入新案件，不覆盖原案 |
| 案件列表 | 可用 | `v6/features/matters/Matters.tsx:154`、`:174–175`（空状态「创建案件」） | — |
| 收件箱 | 可用 | `v6/features/inbox/Inbox.tsx:111`（标记已读）、`:117–120`（显示 ID） | — |
| 动态（活动记录） | 可用 | `v6/features/workbench/ActivityFeed.tsx` | — |
| 目标（多路线配置） | 可用 | `v6/features/targets/Targets.tsx:497–520`、`:542–564`（禁用原因文字） | — |
| 自助五步流程 | 可用（测试引擎） | `v6/features/self-service/SelfService.tsx:43–47`（上传材料、补充信息、选择路线、生成材料、预览与下载）；`v6/routes/V6App.tsx:121–122` | — |
| 专业工作台（八标签） | 可用（测试引擎） | `v6/routes/navigation.ts:55–64`；`v6/features/workbench/Workbench.tsx:147–153` | 概览、材料、事实、草稿、检查、审阅、交付、申请；「申请」为占位（见下） |
| 申请页签 | 说明性占位 | `Workbench.tsx:154`（末尾分支）、`:372–375`（「此工作台尚未接入申请记录功能」） | — |
| 跨案件申请列表 | 说明性占位 | `navigation.ts:93`（`unavailable`，「需要专业协作功能」） | — |
| 协作 / 共享 / 通知 | 不存在 | `v6/features/settings/Appearance.tsx:246`（「云协作与邮件通知尚未配置」） | — |
| 账户 / 登录 / 多设备 | 不存在 | v6 源码无登录逻辑；`v6/routes/V6App.tsx:242`（「当前为本地准备功能，不收费、不自动递交」） | 数据存于浏览器（`v6/lib/indexeddb-repository.ts`） |
| 人工服务 | 说明性占位 | `navigation.ts:96`（`unavailable`，「尚未开放，暂不能下单」）；`V6App.tsx:278–280`（「未来服务范围」） | — |
| 套餐与价格 | 说明性占位 | `V6App.tsx:285–286`（「当前不收费」） | — |
| 账单 | 说明性占位 | `navigation.ts:97`；`V6App.tsx:293` | — |
| 外观 / 主题 | 可用 | `v6/styles/preferences.ts:21`、`:50`、`:55–56`（native / graphite / cyan / celadon） | 原生主题为默认 |
| AI 与数据页 | 可用（展示配置） | `v6/features/ai/ai.ts:416–450`；`V6App.tsx:126` | 只说明能力，不连接真实模型 |

### B-检查：规则包实际内容

来源：`packages/rules-cn/` 的五个 JSON 文件，由 `v6/features/checks/rule-pack.vite.ts:3–11` 加载，版本号 `cnipa-2026-01-01`（`v6/features/checks/rule-pack.ts:4`）。

- 规则总数 **28 条**：`2023-baseline/common.json` 12 条；`2023-baseline/claims.json` 6 条；`2023-baseline/invention.json` 2 条；`2023-baseline/utility-model.json` 3 条；`2026-01-01/ai-related.json` 5 条。
- 严重程度：`error` 16 条，`warning` 10 条，`info` 2 条。
- `sourceSection` 字段含「待填充」：**22 / 28 条**（例：`packages/rules-cn/2023-baseline/common.json` 的 COM-TITLE-001 为「待填充（名称一般不超过25个字）」）。`packages/rules-cn/2026-01-01/README.md` 写明「需联网核对官方文本后填充差异」。
- **ruleId 重复**：`AI-INV-001`、`AI-INV-002` 同时出现在 `2023-baseline/common.json` 与 `2026-01-01/ai-related.json`，严重程度不同（如 AI-INV-002：common 为 `info`，ai-related 为 `warning`）。
- 规则按前缀分类（数量）：名称 COM-TITLE 2；说明书 COM-SECT 3；术语 COM-TERM 1；引用 COM-REF 2；宣传/噪声 COM-NOISE 1；效果 COM-EFFECT 1；AI 相关 7（common 2 + ai-related 5：AI-INV ×2 与 AI-DISC-001、AI-ETH-001、AI-EXAM-001）；权利要求 CLAIM 6（IND 1、REF 3、SUP 2）；发明 INV 2；实用新型 UM 3。
- 规则 JSON 字段：`ruleId`、`patentType`、`severity`、`deterministicCheck`、`sourceDocument`、`sourceSection`、`effectiveFrom`、`effectiveTo`、`userMessage`、`remediation`；没有 `category` 或核实状态字段。
- 检查界面四类：阻断、风险、待核实、产品政策（`Checks.tsx:46–49`）。`category` 来源未在本次读取的规则 JSON 中找到。
- 确定性检查实现：`packages/domain/src/v6/checks.ts` 中可见 `figuresRequired`（:832）、`specSectionsComplete`（:843）、`titleLengthMax25`（:850）、`abstractMax300`（:854）等。28 个 `deterministicCheck` 名中 **11 个**在该文件中出现，**17 个未出现**（如 `termConsistency`、`refsExistAndForward`、`noCircularRefs`、`atLeastOneIndependent`、`objectEligible`、`productObjectEligible`、`aiAssistedReviewConfirmed` 等）。其中部分名称出现在 `packages/audit/src/registry.ts`（旧审校路径）；v6 是否经由该路径执行未核实。
- 检查未成功完成时界面写明「结果不能作为无问题的证明」（`Checks.tsx:245`）。
- 规则包为空时的回退：`v6/features/checks/rule-pack.ts:12–15`（`rules: []`）。

---

## C. 交互摩擦走查（静态）

### C1. 上传 → 下载的最少步骤（静态估计，未在浏览器实测）

路径：首页 → 自助 → 上传 → 补充信息 → 选择路线 → 生成 → 预览与通读 → 导出 → 下载。

1. 首页「自助准备」卡片的「开始准备」按钮，新建空案件（`v6/routes/V6App.tsx:218–221`）。 1 次点击。
2. 上传页：选择文件（`Upload.tsx:279`）；文件可省略，「没有现成文档也能开始」（`V6App.tsx:219`）。 1 次点击 + 等待解析。
3. 补充信息：5 题，每题一次「下一步」（`QuestionsStep.tsx:252`）；未完成本题不能前进（`:122`）。 5 次点击 + 5 次输入。
4. 选择路线：`RouteStep.tsx:236`「保存路线并继续」。 1–2 次。
5. 生成材料：`SelfService.tsx:225`（第 4 步）。 1 次。
6. 预览并通读：通读确认与「继续」（`SelfService.tsx:256–264`）。 2 次。
7. 导出前确认：输入口令（`Done.tsx:233–235`，必填，`:106`、`:239`）；点击「创建导出」（`Done.tsx:239`）。 2 次。
8. 下载：每个文件一次（`Done.tsx`，`status !== "ready"` 时不可下载，`Done.tsx:115`）。 N 次（DOCX、PDF、patentpack 等）。

估计：约 **7 个视图**（首页、上传、补充信息 ×5 题、路线、生成、预览、导出）；约 **16 次点击/输入 + 每个下载文件 1 次**。必填项：5 题各自须完成；口令必填；通读确认须完成后才能进入「继续」（`SelfService.tsx:263–264`，按钮逻辑未逐一核实）。

### C2. disabled 按钮与解除条件的界面说明

| 位置 | 解除条件（代码） | 界面是否说明 |
|---|---|---|
| `v6/features/draft/Editor.tsx:79` 「生成草稿」 | `canGenerate` | 有（`:77` 段落文字；`:80` title「当前工作台没有可用的生成面板；可先手工撰写。」） |
| `Editor.tsx:951` 「保存」 | `!dirty \|\| conflict \|\| saving` | 未核实 |
| `Editor.tsx:955`、`:957` 「预览」「导出」 | `!baseRevision` 等 | 未核实 |
| `Review.tsx:620` | `!state.isCurrent` | 未核实 |
| `Review.tsx:717` 确认 | 理由为空 | 未核实（输入框标签未检索） |
| `v6/features/delivery/Done.tsx:239` 「创建导出」 | `busy`、`!gate.allowed`、口令为空 | 部分：口令字段有提示（`:235`）；门禁原因经 `:39` 等错误码映射显示 |
| `v6/features/recovery/Recovery.tsx:226` 生成备份 | 无来源案件或口令为空 | 未核实 |
| `Recovery.tsx:245` 校验 | 未选文件或口令为空 | 文件选择处有提示（`:242`） |
| `Recovery.tsx:257` 提交导入 | 未通过校验、未确认、已提交 | 未核实 |
| `v6/features/self-service/QuestionsStep.tsx:209` 添加姓名 | 姓名为空 | 无 |
| `v6/features/targets/Targets.tsx:512`、`:556` | 语言不可用或归档 | 有（`:518–520`、`:562–564` 文字原因） |
| `Targets.tsx:388–415` 路线/语言选项 | `option.disabled` | 有（`:415` 与 `data-disabled-reason`） |
| `v6/features/inbox/Inbox.tsx:111` 「标记已读」 | `busyId` | 不需要说明（仅忙碌态） |
| `v6/features/checks/Checks.tsx:169`、`:181`、`:316`、`:340` | `busy` / `initialLoading` | 忙碌态，无需说明 |

以上未列全。源码中共约 50 处 `disabled` 绑定（`grep -rn disabled v6/`）。

### C3. 仍向用户显示的内部术语、英文枚举、错误码、UUID

| 位置 | 显示内容 |
|---|---|
| `v6/features/recovery/Recovery.tsx:218–222` | 选项文字含 `local_unmetered`、`C10 裁剪`、`full` |
| `v6/features/delivery/Done.tsx:181–182` | 「（CACHE_EXPIRED）」「（STALE_BINDING）」 |
| `v6/features/delivery/Done.tsx:194` | 「当前 SnapshotRef、检查和确认记录允许生成材料。」 |
| `v6/features/delivery/Approval.tsx:759` | 「当前 SnapshotRef」 |
| `v6/features/delivery/Done.tsx:233` | 「patentpack 备份口令」（字段标签） |
| `v6/features/recovery/Recovery.tsx:240–242` | `.patentpack` 文件扩展名与 `application/json` 等 accept 说明 |
| `v6/features/checks/Checks.tsx:329` | 「规则包版本」显示 `cnipa-2026-01-01` |
| `v6/features/checks/Checks.tsx:330` | 「绑定修订」显示修订 ID |
| `v6/features/checks/Checks.tsx:149` | 「查看原始校验错误」折叠区，显示原始错误 |
| `v6/features/inbox/Inbox.tsx:117–120` | 案件 ID、目标 ID、资源 ID、动作类型（原始枚举）直接显示 |
| `v6/features/recovery/Recovery.tsx:289` | 资产 ID 与 SHA-256 前 12 位 |
| `v6/features/targets/Targets.tsx:357` | `field.path` 原始路径 |
| `v6/features/targets/Targets.tsx:738` | `rule.ruleId` 原始规则 ID |
| `v6/features/targets/Targets.tsx:474` | 「查看材料标识」折叠区，显示 `evidenceAssetId` |
| `v6/features/ai/ai.ts:211–213` | `fixture-stub`、`fixture-stub-output`、`Synthetic Stub Output`（定义处；界面展示位置未核实） |
| `v6/features/ai/ai.ts:236` | 「测试处理方」 |
| `v6/features/workbench/Workbench.tsx:335` | 「本工作台没有配置可用的生成执行引擎」 |
| `v6/features/draft/Review.tsx:655` 等 | 「定位来源片段」（中文，无问题） |

错误码映射表（`v6/routes/navigation.ts:245–251`）以中文为主，但错误码本身仍在部分页面文字中出现（见上）。

### C4. 空状态与下一步引导

| 位置 | 文案 | 是否给出下一步 |
|---|---|---|
| `v6/features/matters/Matters.tsx:174–175` | 「还没有案件。」+「创建案件」按钮 | 有 |
| `v6/features/inbox/Inbox.tsx:79` | 收件箱空状态（`data-testid="inbox-empty"`） | 文案未核实 |
| `v6/features/draft/Editor.tsx:77` | 「此目标还没有草稿。可以生成候选稿，或直接手工撰写。」 | 有 |
| `v6/features/draft/Editor.tsx:892` | 「暂无权利要求。」 | 无 |
| `v6/features/draft/Review.tsx:511` | 「此目标还没有可审阅的草稿修订。」 | 无 |
| `v6/features/targets/Targets.tsx:430`、`:441` | 「本案尚无人员。请先在「事实」中添加申请人…」 | 有 |
| `v6/features/checks/Checks.tsx:325` | 「尚无可检查的草稿。请先前往「草稿」创建或生成测试草稿，再返回运行检查。」 | 有 |
| `v6/routes/V6App.tsx:227–244` | 案件不可用页：打开案件列表、查看服务范围、查看处理能力、套餐与价格、设置 | 有 |

### C5. 需要用户重复操作的环节

1. **导出口令**：每次导出前在 `Done.tsx:233–239` 输入；口令不保存（`:235`）。
2. **备份恢复口令**：生成（`Recovery.tsx:226`）与校验（`:245`）各需一次。
3. **通读确认**：预览页「通读确认」（`SelfService.tsx:263`）绑定当前草稿、事实和附图版本，内容变化后需重新确认。
4. **逐段 AI 段落确认**：仅当前修订中的 AI/混合段落可确认（`Review.tsx:155`），修订或输入变化后失效（`:168`）。
5. **风险确认**：「确认风险」（`Checks.tsx:54`）；已确认后显示「已确认」（`:163`）。
6. **内部批准**：`Approval.tsx:302–312`（角色限制与门禁），与检查、确认记录相符才可批准。
7. **补充信息逐题**：5 题逐题「下一步」（`QuestionsStep.tsx:252`）。

### C6. 自助流程中跳到专业工作台的出口

- 完成页：「进入同一案件的专业工作台」链接（`v6/features/self-service/SelfService.tsx:285`）；说明「可回到专业工作台继续编辑、检查或处理其他目标」（`:284`）。
- 自助流程中某一处导航到同案草稿页签：`SelfService.tsx:134`（`tab: "draft"`）。
- 路线步骤的错误提示引导「请在专业工作台检查后再继续」（`RouteStep.tsx:73`、`:230`；文字提示，不是链接）。
- 上传路由重定向进入自助（`V6App.tsx:119–120`）；已有案件从 `/matter/...` 进入专业页。

---

## D. 文档声明的 MVP/R1 能力 与 实际能力 对照

| 声明 | 实际 | 出处 |
|---|---|---|
| 材料格式 DOC、DOCX、PDF、扫描 PDF、TXT、MD、PNG、JPEG；多附件（产品规格） | DOC 拒绝；扫描 PDF OCR 不可用；其余可用；多附件同时读取上限 3 | `docs/product-spec.md:43`；`v6/features/sources/parse.ts:91`、`Upload.tsx:295`、`ingest.ts:158–167` |
| 本地解析，扫描件与图纸进入明确处理路径（进化方案） | 扫描页记为 partial，提示手工补充文字 | `docs/patent-saas-evolution-proposal-2026-10-16.md:72`；`parse.ts:88–91`、`:130` |
| 五题问询（v6 README）、按来源标出（v6 README） | 五题可用；题目来源显示未核实 | `docs/design/patent-saas-v6/README.md:24–26`；`intake.ts:84–120` |
| 公开历史与技术成熟度由人选择，不预填（v6 README） | 五题 key 含 disclosure、maturity；预填规则未核实 | `docs/design/patent-saas-v6/README.md:26`；`intake.ts` |
| 路线：CN 实用新型、CN 发明、US、PCT（baseline，R1） | 四个路线可选；生成仅测试输出 | `docs/implementation/patent-saas-v6/00-baseline.md:27`；`targets.ts:162–187` |
| EP 只保留人工服务需求（B12） | 不在路线枚举，有提示 | `00-baseline.md:68`；`targets.ts:89` |
| 英文准备稿（B11：US/PCT 初期提供明确标识的中文准备稿） | 英文 en-US 不可用；无标识的中文准备稿未核实 | `00-baseline.md:67`；`targets.ts:86`、`:472` |
| 单案解锁 ¥399、专业订阅 ¥299/月（原型，演示占位） | 本地版不收费、无套餐或订单 | `design/patent-saas-v6/README.md:50–55`；`V6App.tsx:285–294` |
| 免费预览含权利要求、技术领域、背景技术；说明书后半段锁定（baseline B02） | 未核实 | `00-baseline.md:58` |
| 下载前「知悉风险」或「请专家」（v6 README） | 专业检查页有「确认风险」「请专家」按钮；自助下载路径未核实 | `design/patent-saas-v6/README.md:28`；`Checks.tsx:54–56` |
| 下载前通读确认，记录确认人、时间与草稿版本（v6 README） | 通读确认绑定草稿、事实、附图版本；确认人与时间记录未核实 | `design/patent-saas-v6/README.md:29`；`SelfService.tsx:263` |
| XML 需按官方工具校验，产品不代提交（v6 README） | 无 XML 导出；说明文字未核实 | `design/patent-saas-v6/README.md:30`；`00-baseline.md:66` |
| 检查分四级：阻断、风险、待核实、产品政策（v6 README） | 四类分组存在；规则 JSON 无 category 字段，分类来源未核实 | `design/patent-saas-v6/README.md:38`；`Checks.tsx:46–49` |
| 检查「阻断（本次为 0）」（v6 README） | 运行结果未核实 | `design/patent-saas-v6/README.md:38` |
| 规则包版本化：2023-baseline + 2026-01-01，每条带来源（product-spec） | 两目录存在；2026 目录仅 5 条（ai-related）；22/28 条来源章节为「待填充」；ruleId 重复 | `docs/product-spec.md:30`；`packages/rules-cn/` |
| 每条规则带来源、章节、版本（product-spec） | `sourceSection` 多为「待填充」；`effectiveFrom` 字段存在 | `packages/rules-cn/2023-baseline/common.json` 等 |
| 互联网研究默认关闭；不做检索报告（product-spec） | 检索显示「未检索」 | `docs/product-spec.md:20`；`Checks.tsx:345` |
| 支持矩阵、一致性、形式规则审校（product-spec） | 支持表与检查存在；检查规则 28 条，其中 17 条名称未在 v6 checks.ts 中出现 | `docs/product-spec.md:56`；`Review.tsx:301`；`checks.ts` |
| 加密项目包 .patentpack 导入导出（product-spec） | 可用（备份与恢复） | `docs/product-spec.md:44`；`Recovery.tsx`、`Done.tsx:233` |
| 每次模型生成可预览将发送内容、可取消、可回溯快照（product-spec §4） | 预览、取消、快照回溯未核实；真实外发门关闭 | `docs/product-spec.md:59`；`ai.ts:429–431` |
| 本机 Key 存 OS Keychain；浏览器只持短期配对 token（product-spec §2） | 浏览器版不保存模型密钥；桌面版（R4）未实现 | `docs/product-spec.md:29`；`ai.ts:357`、`:439` |
| 本地优先，公网只分发静态资源（product-spec:10） | 数据存于浏览器 IndexedDB；无服务端存储 | `docs/product-spec.md:10`；`v6/lib/indexeddb-repository.ts`；`V6App.tsx:242` |
| 八标签持续存在（v6 README；baseline） | 八标签渲染；「申请」为占位；「审阅」有页面但 `TAB_CAPABILITIES` 标为不可用（该常量未被引用） | `design/patent-saas-v6/README.md:34`；`Workbench.tsx:147–154`、`:372–375`；`navigation.ts:78–86` |
| 三入口：自助、专业、人工服务（baseline） | 首页三卡片；人工服务为「未来服务范围」说明页 | `00-baseline.md:23`；`V6App.tsx:213–231`、`:278–280` |
| 生成 R1（baseline 覆盖表：generate R1） | 仅测试输出，固定文案，无真实模型 | `00-baseline.md:28`；`local-runtime.ts`；`ai.ts:448` |
| 导出 R1（baseline：deliver R1） | DOCX、PDF、patentpack、JSON 清单可导出；导出内容为测试输出时带「测试输出-」前缀 | `00-baseline.md:39`；`export-adapter.ts:701–704`、`:748` |
| 设置含数据导出与删除（baseline：settings S01/S13） | 备份导出在交付页，恢复在设置页；删除数据功能未核实 | `00-baseline.md:49`；`V6App.tsx:274`；`Done.tsx:233` |
| 检索（MVP 商品内含 10/40/8，patent-beta-mvp:15） | 未检索；检索协议为文档，代码中无检索执行 | `docs/plans/patent-beta-mvp.md:15`；`Checks.tsx:345` |
| 多语言：中文 + 英文准备稿（evolution / europe：中英双语） | 仅中文 | `docs/patent-saas-europe-north-america-expansion-2026-10-16.md:7`；`targets.ts:85–86` |
| 协作（R3：多人协作、团队/受限分享） | 不存在 | `00-baseline.md:81`；`Appearance.tsx:246` |
| 账户（R2 登录、云存储、跨设备） | 不存在（R1 本地预览限制） | `00-baseline.md:81`；`V6App.tsx:242` |
| 支付（R1 不展示伪支付成功） | 不收费；无支付流程 | `00-baseline.md:82`；`V6App.tsx:286` |
| 人工服务（R1 入口和能力说明） | 说明页存在，无下单 | `00-baseline.md:83`；`V6App.tsx:278–280`；`navigation.ts:96` |
| 回执、期限、现有技术台账（R1 不预填示例回执） | 申请页为占位；无期限计算 | `00-baseline.md:84`；`Workbench.tsx:372–375` |
| 本机模型/钥匙串（R1 浏览器不冒充原生能力） | 本机模型标为「仅桌面版」，未冒充 | `00-baseline.md:85`；`ai.ts:356`、`:423` |
| 主题：Native 默认，保留四主题（baseline §5） | 四主题可选，native 默认 | `00-baseline.md:76`；`preferences.ts:21`、`:50` |
| 不实现自动法律期限、自动递交、授权保证、EP 全案（baseline:86） | 符合（无期限引擎、无递交） | `00-baseline.md:86`；`export-adapter.ts`（无递交逻辑） |

---

## E. 未核实项（本次未覆盖）

- 未在浏览器中运行任何页面；C 节步骤数为静态估计。
- 未读取 `Matters.tsx`、`Inbox.tsx`、`ActivityFeed.tsx`、`Review.tsx` 的完整实现，仅取检索到的片段。
- 未核实自助页内是否存在「风险确认 / 请专家」按钮。
- 未核实确定性附图生成（SVG/Mermaid）是否存在。
- 未核实 `packages/domain/src/v6/checks.ts` 之外是否有 17 个未命中规则的实现，以及 v6 是否调用 `packages/audit`。
- 未核实 `category` 的生成位置。
- 未核实各 disabled 按钮的界面文字（C2 中「未核实」项）。
- 未检索主仓库 `planning/`、`docs/qa-plan.md` 等其他文档。
- 主仓库文档为工作区未提交版本，见 §0。
