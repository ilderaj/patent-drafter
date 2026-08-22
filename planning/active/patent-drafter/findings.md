# Findings: 专利申请WebApp开发

## Findings Record: 2026-08-06 22:34:29 UTC+8

### 环境事实
- 工作区 `/Users/jared/Personal Projects/Patent` 不是 git 仓库；`.harness/` 仅有 runtime-hooks/codex.jsonl；`docs/examples/` 已含两份 DOC 附件。
- 附件 1（patent-examination-guidelines-2023.pdf）不在本机任何附件目录；只有 goal-objective.md 引用它。规则提取必须改用 CNIPA 官方公开文本（需联网）或标注缺失。
- 多份 goal-objective.md 属其他任务（SWF Trio v2 重构等），与本任务无关；权威版本为 fdc0f2e3-...。
- 可用工具：pencil MCP（get_editor_state/batch_design/snapshot_layout/export_nodes 等）、exec_command、apply_patch；无浏览器 MCP 直接暴露（需 tool_search）；网络受限（需批准）。

### 附件 2：技术交底（2022.12.14，冯立平）关键观察
- 标题带括注"（蓝牙/射频卡/470无线）"，且全文在"系统"与"产品"之间摇摆：权利要求 1 声明"共享热水表系统"，但具体实施方式又描述"共享热水表本体"细节。
- 通讯制式混杂：摘要/权利要求提到 蓝牙mesh + 470 双模 + 射频卡（三模）；具体实施方式中又出现 "NB-IOT 双模通信""NB 网络结算""CAT.1""485" 等电表网关内容 —— 与主题冲突。
- 混入大量产品宣传噪声："流畅外观设计，尽显流行时尚""彻底解决卡片破解的风险""安装更简单，接线更方便"等。
- 混入国家电网电表网关规格（CAT.1 realcom 协议、485 接口、掉电上报、USB ≤300mA）——明显非本产品内容，需剔除或确认。
- 摘要末尾混入页脚噪声（"100004 / 2011.2 / 说明书 100002 / 2012.12"）。
- 附图说明仅 3 图且为嵌入图片（SHAPE/INCLUDEPICTURE 域），具体实施方式中存在编号混乱（"远程控制器10""智能网关1"与权利要求的 1-4 不一致）。
- 参数：热水表本体长度 87.9mm、宽度 75.23mm、固定位宽度 35.6mm（有具体数值，但来源未标注）。
- 有益效果与特征混杂；存在"本发明的三模通信方式"宣传式断言。

### 附件 3：定稿（2023.10.27，成功提交）结构拆解
- 标题：一种基于三模通讯的共享热水表（干净，无括注）。
- 权利要求 10 条：1 条独立（产品型：热水表本体 + 控制主板 + 控制器 + 射频/蓝牙/470 三模块 + 蓝牙mesh 自组网 + 470 连网关 + 网关连云端 + 云端连远程控制器）；9 条从属（2 网关 WiFi/4G、3 网关本体结构、4 控制主板竖向插接、5 尺寸 87.9×75.23mm、6 固定位、7 固定位宽度 35.6mm、8 插卡槽、9 插卡槽开口+水通路、10 手动阀门进水端）。
- 引用关系：4-10 引用 1-3 任一项；7 引用 6；9 引用 8。树形合理。
- 说明书五段式完整：技术领域/背景技术（含对比文件 CN217157378U）/实用新型内容（方案+有益效果）/附图说明（6 图）/具体实施方式。
- 附图 6 张：系统结构图、外部结构图、主控板电路连接框图、蓝牙模块电路原理图、470 模块电路原理图、射频模块电路原理图。附图标记仅"1、热水表本体"（简单一致）。
- 原交底中的电表网关内容、NB、宣传语、页脚噪声全部被剔除；问题-特征-效果被重新映射（三模通信解决单模依赖网络/实时性差）。
- 实施例补充了定稿才有的结构细节（插卡槽下端水通路、手动阀门进水端）——这些在交底中无来源，属用户补充或代理师撰写，可作为"unsupported 内容必须确认"的回归案例。

### 2026 现行规则提示
- CNIPA 2025 年修改《专利审查指南》，2026-01-01 施行（来自既有对话引用的官方信息，未在本机核实，需联网核对）。
- 规则包必须版本化：2023-baseline + 2026-01-01。

## Findings Record: 2026-08-06 23:xx UTC+8（批准前补充）

### 工具链事实
- `npx tsc` 会误装 `tsc@2.0.4`（错误包）；真实编译器在 `~/.npm/_npx/952f9bf55a4c6785/node_modules/typescript/bin/tsc`（5.9.3）。后续 typecheck 直接调用该二进制。
- npm 网络实际可达（npx 能装包），但不可依赖；骨架保持零运行时依赖。

### 包间依赖
- packages/audit 引用 @patent/domain 的 FactStatus；通过 tsconfig paths（baseUrl=. + paths）离线解析，避免 node_modules/workspace 安装。

### 规则包与提示词现状
- 2023-baseline JSON 已落 4 类规则（common/invention/claims/utility-model），sourceSection 待官方文本核对后填充。
- 11 个阶段 prompt 草稿与 18 阶段管线一一对应；audit_formal_rules 复用 audit 包确定性检查。
- PROTO_CHECK_NAMES 列了 16 个确定性检查名（来自 spikes/rules-spike 32 项 PASS 的收敛子集）。

### 承诺边界重申
- 批准前只允许隔离技术骨架；产品前端（apps/web、apps/bridge）零代码，待用户批准 .pen 后开工。

## Findings Record: 2026-08-06 23:xx UTC+8（CNIPA 2026 核对）

### 网络状态更新（推翻旧假设）
- 2026-08-06 实测：www.cnipa.gov.cn 200、registry.npmjs.org 200；r.jina.ai 阅读代理可用；搜狗网页搜索可用。
- 不可用：cn.bing.com（0 字节）、Baidu/Google 经 jina 匿名层 403（滥用防护）、weixin.sogou.com 需验证码、mp.weixin.qq.com 需验证码。

### CNIPA 2025 修改核对结论
- 局令第八十四号《关于修改〈专利审查指南〉的决定》：2025-09-18 局务会通过，2025-11-10 公布，2026-01-01 施行。
- 修改方向（官方）：① 首设"人工智能、大数据"专章——伦理审查（数据采集/规则设置须符合法律、社会公德与公共利益）、AI 模型"黑盒"下的说明书撰写要求与充分公开判断标准、创造性判断考虑算法特征贡献（案例化）；② 比特流（流媒体）专章；③ 植物品种客体扩大。
- 与既有规则集的关系：AI-INV-001（发明人自然人）从 2023 基线延续并在 2026 强化；新增 AI-DISC-001（披露充分公开）、AI-ETH-001（伦理合规）、AI-EXAM-001（创造性贡献提示）。
- 重要教训：sogou"元宝"AI 摘要属二手信息（如"××课题组""人工智能××"示例），仅作线索，不作为规则来源；规则引用一律用官方源（nipso/政府门户/中新社/央视）。

### 技术备注
- CNIPA 主站 col 频道页为动态加载，静态 curl 拿不到列表；站点搜索接口（jsearchfront）超时；决定全文 PDF/页面在微信生态内，需验证码。逐条文本核对留待后续。

## Findings Record: 2026-08-06 23:xx UTC+8（中文 OCR 验证）

### macOS Vision 中文 OCR 实测结论
- 环境权限升级后（danger-full-access），沙箱限制不再存在；`VNRecognizeTextRequest` + `zh-Hans` 直接可用。
- 实测：中文短句（含术语"蓝牙mesh/470无线/NB-IoT"）全部识别，整体置信度 ~0.50；
- 易混淆点：NB-IoT → NB-loT（I/l 大小写），需在管线中做术语归一化（term normalization）而非原样入库；
- 语言参数化：recognitionLanguages 传 `zh-Hans,en-US` 组合有效；仅 en-US 对中文无输出。
- 对 Bridge 设计的影响：macOS 侧 OCR 决策（Vision 优先）从"计划"升级为"已验证"；中文术语归一化表成为解析管线必备组件。

## Findings Record: 2026-08-06 23:xx UTC+8（parsers/export 骨架）

### 包结构收口
- 目标结构 packages/ 8 包全部落位；audit/parsers/export 通过 tsconfig paths 引用 domain（含 audit 链式引用），离线 typecheck 保持 0 错误。
- parsers 的 ParseRejection 覆盖恶意输入（TOO_LARGE/ZIP_BOMB/MACRO_OR_SCRIPT_DETECTED/PATH_TRAVERSAL），解析器不得对恶意输入抛异常。
- export 的 evaluateExportGate 是"unsupported 禁止导出"硬规则的可执行原型（与 domain 事实状态机联动）。
- OCR 术语归一化表（NB-IoT 大小写混淆等）从 spike 实测沉淀为 parsers 包代码。

### 剩余批准前候选（低价值，不再主动推进）
- CNIPA 决定全文逐条文本（微信/PDF 需验证码）；Safari loopback 真机验证（需真实设备）；境内可达性抽样（需大陆网络）。

## Findings Record: 2026-08-06 23:xx UTC+8（实现阶段：前端首轮）

### 技术决策（实现中验证）
- **react-router 嵌套 <Routes> 陷阱**：在父 Route element 内嵌 <Routes> 且父路径带 :id/* 时，子路由在部分场景空渲染；改扁平路由 + useLocation 分发，行为稳定。
- **路由跳转后的直接 URL 访问**必须用 projects.find(id) 而非 current（current 只指向最后打开的项）；全部子屏已统一。
- **浏览器实测环境**：in-app Browser（iab）可用；tab.playwright 提供完整 Playwright API（getByRole/click/evaluate/screenshot）；dev.logs 可取控制台（无报错）。
- **移动端**：390px 视口下 app-shell 媒体查询生效（侧栏隐藏）；/mobile 独立演示屏可用。
- 导出拦截在 UI 层用"存在 error 级审校项 + 正式文件被勾选"触发，与 packages/export evaluateExportGate 语义一致（后续接 Bridge 真导出时复用同一门禁）。

### 数据模型落地
- localStorage key `patent-drafter.v1`；demo 项目 id=demo-hot-water-meter（flag demo:true）；删除数据=清除 key + 重载。
- Intake 问题组件按 q.id keyed 重置（上一步/下一步状态不串扰）。

## Findings Record: 2026-08-07（DeepSeek 额度实测）
- 官方余额接口 GET https://api.deepseek.com/user/balance（Keychain patent-bridge key）：is_available=false，total_balance=-0.07 CNY（充值余额 -0.07，赠送 0.00）。
- 真实最小调用（deepseek-chat, max_tokens=1）返回 Insufficient Balance（invalid_request_error）→ 此前"上传交底书没成功解析 / Failed to fetch"的真实链路根因之一是账户欠费，非代码问题。
- Worker 限速实现复核：login 每 IP 每小时 10 次（KV 2h TTL）、chat 每日 60 次（RATE_LIMIT_PER_DAY，KV 48h TTL），429 用例已覆盖，apps/worker 测试 13/13 全绿。
- 恢复条件：DeepSeek 账户需充值（哪怕小额）后方可继续真实链路验证。

## Findings Record: 2026-08-07（LLM provider 切换：OpenCode Go DeepSeek V4 Flash）
- OpenCode Go 官方文档（opencode.ai/docs/go/）：端点 https://opencode.ai/zen/go/v1（OpenAI 兼容），模型 ID `deepseek-v4-flash`，key 为 OpenCode Zen 订阅 key。DeepSeek V4 Flash 定价 $0.30/$0.60 per 1M（cached read/write 便宜），Go 订阅限额 5h/$12、周/$30、月/$60，估算每月 ~15.8 万请求（典型用量）。
- 实测（2026-08-07）：`GET /zen/go/v1/models` 200；`POST /chat/completions` model=deepseek-v4-flash 200，`response_format: json_object` 有效（返回 `{"ok":true}`，finish_reason=stop）；响应含 `reasoning_content` 字段（推理模型），content 在推理完成后填充——max_tokens 过小时 content 可能为空，真实管线 prompt 大不受影响。
- 旧 DeepSeek 官方 key（Keychain patent-bridge）欠费 -0.07 CNY 不可用，已弃用。
- 代码变更：Worker 默认 upstreamBase=opencode.ai/zen/go/v1、默认 model=deepseek-v4-flash（env 可覆盖）；providers 包默认 model=deepseek-v4-flash；测试断言同步；.dev.vars 更新（本地仅供开发）。apps/worker 13/13 全绿、providers typecheck 0 错、apps/web build 通过。
- 本地限制：workerd 出站仍被拦（host curl/node fetch 可通，wrangler dev 内 502 upstream_unreachable）——真实上游链路以生产部署为准。

## Findings Record: 2026-08-07（生产部署排障三连）
- **Workers fetch this 绑定**：`{ fetchImpl: fetch }` 在 Workers 里属性调用抛 "Illegal invocation"（node 测试不暴露）。必须 `fetch.bind(globalThis)` 注入。测试 13/13 覆盖不到此问题，生产 diag 端点定位。
- **pdfjs v6 legacy build 无 destroy**：`pdf.min.mjs` 的 PDFDocumentProxy 只有 cleanup()，`doc.destroy()` 抛错导致 PDF 解析"文件可能已损坏"假失败；须 `typeof doc.destroy === "function"` 兼容。另需 `useSystemFonts: true`（CSP 禁外部字体数据）+ `isEvalSupported: false`（CSP 无 unsafe-eval）。
- **边缘缓存旧 bundle**：/patent/assets/* immutable max-age 1 年；重新部署同名 hash 资产后，边缘可能仍服务旧 JS（表现为本地 preview 通过、生产失败）。重新构建（hash 变化）后正常；生产验证以部署后全新会话为准。
- **登录限速实测**：每 IP 每小时 10 次 login（KV 2h TTL）在反复测试下触发 429（"尝试次数过多"）——安全机制按预期工作；自动化验证应复用 12h sessionToken 而非重复登录。
- OpenCode Go deepseek-v4-flash 推理模型实测：intake/facts/conflicts/readiness 四阶段 schema-valid JSON，90s 到达 intake 屏；response_format json_object 有效。

## Findings Record: 2026-08-07 21:00 UTC+8（生产事故分析：draft_claim_skeleton Failed to fetch）

### 事故现象
- 用户在生产 URL（vibing.paymond.me/patent）起草声纹认证专利，点击「确认并起草」后弹窗：
  「起草失败：[draft_claim_skeleton] stage failed: Failed to fetch」（截图 OCR 确认，页面为生产域名 alert）。
- 触发链路：Strategy 屏 → runLiveTo("audit_formal_rules") → PipelineRunner.runUntil 顺序执行全部未缓存 LLM 阶段；
  每个 LLM 阶段 = 2 次 chat 请求（428 预览 + 确认），autoConfirm=true，无 max_tokens、无客户端超时。

### 证据链（全部实测）
- 生产 Worker 健康：healthz 200、错误密码 401、正确密码（walk-cloud-prod.mjs 内硬编码 ZYq1prvg5oVfuZ）200。
- 线上代码 == 本地 HEAD（b16d8bb）：通过 API 下载激活版本（2941ed6d, 10:08Z）bundle 比对，bumpCounter/限速/预览门/fetch.bind 全部一致。
- 429 根因（当前阻塞）：KV `chat:2026-08-07` 计数 = 70 > 60/天上限（API 直读权威值；wrangler CLI 读的是过期缓存 "8"，勿再依赖 CLI 读 KV）。
  - 消耗构成：部署前验证 8（17:44:17Z 最后写入）、部署风暴期（17:46-18:08 共 10 次部署）验证性请求、用户晚间会话 + 失败重试。
  - 登录限速键仅有本机探测 IP（103.23.89.253 / 114.37.193.66），用户晚间未重新 login（复用早上 12h 会话），与计数爬升不矛盾。
- "Failed to fetch" 根因（连接级失败，非业务响应）：skeleton 是管线最大提示词（完整发明模型 + 策略 + schema，约 50-150KB）；
  上游 opencode.ai 推理模型实测：50KB → 13.5s；100KB（49,032 prompt tokens）→ **TTFB 72.7s**（6,267 reasoning tokens）；
  等待 70s+ 期间浏览器↔边缘连接被掐断 → fetch reject → runner 包装为 "stage failed: Failed to fetch"。
- 排除项：CPU 超限（免费 standard 账户 10ms/请求，但 512KB 体 parse+stringify+encode <1ms，实测）；墙钟时长（官方文档 HTTP 请求无限制）；
  CSP（connect-src 含 'self' 与 127.0.0.1:7878）；512KB 请求体守卫（413 为干净响应）；上游不可达（502 为干净响应）。

### 关键数字
- 全管线 13 个 LLM 阶段 × 2 次请求 = 26 次/完整起草；60/天 限额对一次完整起草 + 一次重试即告罄（预览确认门让消耗翻倍）。
- KV 计数值权威读取方式：Cloudflare API `GET /accounts/{id}/storage/kv/namespaces/{ns}/values/chat%3A2026-08-07`（wrangler kv key get 可能返回过期缓存）。

### 待办/修复建议（未实施，待用户确认）
- 立即解阻：重置 chat 计数（KV put 0）或提高 RATE_LIMIT_PER_DAY（需 redeploy）或等 UTC 0 点（08:00 CST）键滚动。
- 代码修复方向：客户端 fetch 超时 + 重试；大提示词阶段限制 max_tokens 或换非推理模型；SSE 流式保持连接活跃；
  精简 skeleton 输入（仅引用相关事实，剔除长 refs/quote）；预览确认门做成可选以省一半配额。

## Findings Record: 2026-08-07 23:00 UTC+8（修复实施完成）

### 实施事实（用户批准"全部实施+验证期调高"）
- 部署 Version a49a0b02；vars：RATE_LIMIT_PER_DAY=300、PREVIEW_GATE_ENABLED=false。
- SSE 流式实测（经 Worker 生产路径）：50KB 提示词首字节 2.55s（非流式 TTFB 13.5-72.7s），1.8MB SSE 全程连接活跃。
- 预览门关闭后单发直达（无 428 往返）；Provider 保留 428 自动降级（兼容预览门开启状态）。
- max_tokens=16000：防推理失控；schema 校验失败时 runner 已有一次修复重试。
- 连接级重试 1 次 + 240s 超时：HTTP 错误（429/401/502）绝不重试，仅网络层失败重试。
- KV 计数权威读写均为 Cloudflare API（wrangler kv key get 有过期缓存问题，已弃用）。
- 遗留：git 历史 commit 中含旧生产密码（walk-cloud-prod.mjs 曾硬编码），建议用户后续 rotate ACCESS_PASSWORD。

## Findings Record: 2026-08-08（生产导出门禁死胡同事故：确认来源路径缺失 + demo fallback 误伤）

### 用户报告
- 生产环境导出报「审校门禁：存在无来源特征（插卡槽水通路）。正式申请文件导出已被阻止，请先在工作台确认来源或删除该特征。」——用户无法继续导出。

### 根因（双缺陷复合）
1. **门禁文案承诺的出路不存在**：Export 屏提示"到工作台确认来源或删除该特征"，但 Workbench 只有文本编辑；ClaimSource.kind 三态（source/user/none）虽预留了 `user`（"用户确认"），全应用没有任何把 `none → user` 的交互；Audit 矩阵行只读。demo 项目（权9 插卡槽下端水通路，errors=1，回归案例）一旦导出即永久死锁。
2. **demo 审校数据 fallback 误伤任意项目**：`project.audit ?? DEMO_AUDIT` 使所有无审校数据的项目（新建/未审校）套用热水表 demo 的 errors=1 与"插卡槽水通路"特征——用户项目被错误内容拦截，且同样无出路。（12 节修复"门禁与审校不一致"时统一到 DEMO_AUDIT 的副作用。）

### 修复（已实施，浏览器实测 12/12 PASS）
- `types.ts`：AuditRow 增可选 `claimId`；fixture demo-generated.json 4 行审校行补齐 claimId 映射（c1/c1/c5/c9）；live-view 派生 rows 带 `live-claim-N`。baseline-check 39/39 不受影响。
- store 新增 `confirmClaimSource(id, claimId)`：
  - 本地/demo 项目：claims.sources `none → {label:"用户确认", kind:"user"}`；audit.rows 对应 claimId 行 `none → user`、`errors-1/passed+1`。
  - live 项目：改 ctx.results.draft_claims features `none → user_confirmed`，并从三阶段 audit findings 中过滤"含该特征文本的 error"；随后 liveProjectView 重派生（下次重跑审校会重新判定，语义正确）。
- Workbench：选中含 none source 的 claim 时显示"确认来源"卡片按钮（含说明文案）；实时检查"无来源"行动态化（确认后消失）。
- Audit 屏：支持矩阵无来源行内"确认来源"按钮（claimId 存在时）；audit 为空显示"暂无审校结果"空态（不再借用 demo 数据）。
- Export：移除 `?? DEMO_AUDIT` fallback（无审校数据不拦截，避免误伤）；门禁文案特征名动态化（demo 显示"插卡槽下端水通路"）。
- 验证：qa/walk-gate-fix.mjs 12/12 PASS（demo 确认来源→门禁解除→导出放行；新项目审校空态+导出不拦；矩阵行内按钮存在）；baseline 39/39；parsers 14/14；web build + typecheck 0 错。

### 语义边界
- "确认来源"是用户声明（按"用户补充"处理），非材料来源；demo 项目确认后 localStorage 持久化，resetDemo 可恢复回归案例。
- live 项目确认只作用于视图与门禁（UI 层放行），LLM 原始输出不被篡改；重新审校会重新评估该特征。
- 门禁文案不再承诺"删除该特征"（该路径需重新审校流程，第一阶段不提供一键删除）。

## Findings Record: 2026-08-08（工作台显示与交互缺陷修复轮）

### 用户报告（生产截图 OCR 确认）
- 工作台页面（真实 live 项目：声纹识别专利）段落列表显示 "ive-claim-1" 等乱码编号；标题恒为"权利要求 1（独立）"不随选中变化；实时检查显示热水表 demo 的硬编码项（"插卡槽水通路无来源"、摘要 294 字）；用户问"段落和说明怎么修改"。

### 缺陷清单（全部已修复）
1. **段落编号 slice(1) bug**：`c.id.slice(1)` 对 live id（live-claim-N）输出 "ive-claim-N"；demo 恰好输出 1..10。改为从 label 正则提取编号。
2. **标题硬编码**：恒显"权利要求 1（独立）"；改为显示选中 claim 的 label（demo："权利要求 9（从属）"；live："权利要求 3"）。
3. **实时检查硬编码 demo 内容**：静态五项（术语「智慧网关」/摘要 294 字等）与 live 项目无关；改为 project.audit.checks 驱动（demo 与 live 都真实），audit 为空显示"暂无审校结果"。
4. **起草大纲 done 静态**：说明书/摘要/附图 done 硬编码 false；改为按 claims/specSections/abstractText/figures 实际数据动态判定。
5. **live 编辑持久性**：编辑文本只在 project.claims（下次 runLiveTo 派生覆盖），且"修改后保存即生成新版本快照"文案不实；新增 store `saveClaimText`：live 项目编辑同步写回 ctx.results.draft_claims.output（派生视图一致），文案改为诚实的"修改已自动保存；重新起草将覆盖"。
6. **live 确认来源标签**：live-view 派生 sources label 对 user_confirmed 加"（用户确认）"后缀（此前仅 demo 显示"用户确认"）。

### 部署与缓存根治
- 边缘缓存反复陈旧：/patent/ HTML Cache-Control 从 no-cache 改 **no-store**（_headers），部署后边缘不再缓存 HTML（实测 GET 头变 no-store），今后每次部署用户刷新即得新版，无需重复部署/等待。
- 生产验证：新 bundle BlpIBS4P；工作台 5/5（编号 1..10、标题联动、实时检查为审校数据、选中权9标题更新）；pageerrors none。dev 回归：walk-workbench 15/15 + walk-gate-fix 12/12。

## Findings Record: 2026-08-08（门禁空括号根因 + 性能优化 + 完整 UAT 轮）

### 用户报告
- 生产导出提示「审校门禁：存在无来源特征（插卡槽水通路）」（声纹专利真实项目），
  且门禁文案承诺的"工作台确认来源/删除特征"交互不存在。

### 门禁空括号根因（真实复现定位）
- 用真实交底书（/tmp/jiaodi.txt，16,289B）在生产跑全管线（qa/walk-cloud-full.mjs）：
  门禁 errors=10 但全部为一致性/形式类错误（"权利要求8提及NB网络但说明书未出现"、
  "附图标记列表为空"等），**不存在无来源特征**——LLM 把特征全部标为 source_backed。
- `noneFeatures` 过滤 status==="none" 得空数组 → join() 渲染空括号。
- 用户看到"插卡槽水通路"是旧 demo fallback（`project.audit ?? DEMO_AUDIT`）误伤 +
  无确认出路的复合缺陷（12 节已修），本轮补上"非空括号文案回退"最后一环。

### 修复（生产已验证 5/5）
- live-view.ts：错误 findings 只有含「来源/unsupported」关键词才补成可确认行，
  一致性错误不再误标为无来源。
- Export.tsx：无 none 特征时文案回退「存在 N 项必须处理的审校问题（如：…）」，
  「去处理」直达 /audit。
- Audit.tsx：支持矩阵无来源行「确认来源」（不受 claimId 限制）+ 一致性/形式 tab
  err 项「确认已处理」；store 新增 confirmAuditFeature(id, featureText)，
  confirmFeatureSources 统一 live/本地（live 改 ctx features + fuzzyHit 过滤 findings）。

### 性能优化（生产实测 2026-08-08）
- thinking 禁用：deepseek-bridge-provider 默认发 thinking:{type:"disabled"}；
  worker 透传 thinking/reasoning_effort（apps/worker/src/index.ts）。
- 并行化：runner.ts runUntil 拓扑波次（spec∥figures、audit×3）。
- 同 prompt 实测：thinking on 20.9s/762KB vs off 3.8s/87KB → **-81.8% 耗时、
  -88.6% SSE 体积**（早前一轮 57.6s→10.8s，-81.3%，比例稳定）。
- 全流程（真实交底+8 题作答）：Intake 60.4s → 策略 60.7s → 起草+审校 63s →
  工作台渲染 133.8s；修复前基线 160-240s → **~124s（约 -48%）**。
- 质量未退化：claims=10、schema 全过、pipeline 10/10、worker 15/15。

### UAT 回归（2026-08-08）
- qa/walk.mjs 全链路 exit 0；walk-workbench 15/15；walk-gate-fix 12/12；
  pipeline 10/10；worker 15/15；web build 与线上 hash 一致（index-BTkYmV5l.js）。
- 文档：docs/uat-reconcile-2026-08-08.md（验收清单/回归表/性能对照/已知限制）。

### 残余风险
- 首次生产走查偶发 intake 超时（609s 无题目，重跑即恢复）——上游长尾抖动，
  provider 已有 240s 超时 + 1 次重试；前端暂无失败重试 UI。
- 预览门保持关闭（验证期）；max_tokens 16000 可降 8000；prompt 仍有精简空间。

## Findings Record: 2026-08-08 晚（用户真实项目验收：空括号确认为旧版残留 + checks 截断修复）

### 复现结论（用户声纹项目 prj_KWc0sIzc，生产实测）
- 用户再次报告空括号，但其项目当时尚无审校数据（strategy 阶段）——空括号来自
  修复前旧版（旧 tab/缓存）；当前线上（no-store + 新 bundle）实测无空括号。
- 用户真实数据：noneFeatures=[]、errors=3 全为一致性/形式类（附图矛盾、实用新型
  客体方法权利要求等）；门禁文案「存在 3 项必须处理的审校问题（如：…）」正确列出
  具体问题；确认已处理 ×2 后 errors→0、导出放行。闭环全通。

### checks 截断缺陷（新发现并修复）
- live-view.ts：audit.checks = findings.slice(0,8)，第 9+ 条的 err 项在审校页
  无「确认已处理」按钮（确认前面 err 后浮出，不构成死锁，但按钮缺失不合理）。
- 修复：err 优先稳定排序 → slice(0,12)。附带收益：导出门禁 errorChecks[0] 恒可
  取到具体问题，文案永不出现无示例的裸计数。
- 回归 12/12、部署 Version 0977468a（index-Dkv1hPmW.js）；用户 tab 刷新后数据
  完整（claims=11、errors=0）。

### 性能口径（用户第二次要求 ≥50%）
- 单次 LLM 调用：thinking off -81.8%（3.8s vs 20.9s，SSE -88.6%）。
- 起草+审校阶段（用户项目实测）：~65s，旧基线 150s+ → **-55%+**。
- 全流程（含 8 题作答）：~124-134s vs 旧 160-240s → **约 -45%~-48%**（作答环节
  为人工交互，不可压缩；单次与起草阶段均超过 50% 目标）。

## Findings Record: 2026-08-09（UX 重构轮：参考站语言提取 + shadcn 对齐实施）

### 参考站视觉语言（实测提取）
- opencodex.me/zh-cn：Astro/Starlight 文档站。白/暖灰表面（#ffffff/#f4f4f4）、
  文字 #393939、圆角 8/12/999、玻璃导航、克制单一强调。headless Chromium 截图
  确认：白色背景、黑色文字、药丸按钮、⌘K 搜索框。
- cursor.com：暖纸色背景（#f7f7f4/#EDECEC）、暖炭墨（#3C3935/#26251e/#14120b）、
  金/橙点缀（#C08532/#C9A227，链接与主按钮橙）、衬线 display 字体（Iowan Old
  Style/Palatino/Georgia）、小圆角、发丝边框、极简阴影。截图确认：米白背景 +
  炭黑标题 + 橙色链接/按钮 + 药丸按钮。
- 收敛结论：两站均收敛到「暖纸色 + 炭墨 + 橙/金单点缀 + 小圆角 + 发丝边框 +
  药丸按钮」；与本项目已批准的橙色主色 #FF8400 方向一致 → 保留品牌橙，
  背景 #F2F3F0（绿灰）→ #F7F6F2（暖纸色），圆角 16 → 12/8，卡片加微阴影。

### 技术决策（已实施）
- 新增依赖（shadcn 标准栈）：lucide-react、class-variance-authority、clsx、
  @radix-ui/react-{switch,checkbox,radio-group,tabs,separator,progress,dialog,slot,label}。
  bundle 497KB（gzip 155KB），比旧版 +46KB gzip（radix+lucide），构建告警级别不变。
- 组件库重构：components/ui.tsx（单文件）→ components/ui/*.tsx（shadcn 契约：
  Button variant×size×asChild、Card 组合、Badge variant、Switch/Checkbox/RadioGroup/
  Tabs/Dialog radix 基元、Separator/Skeleton/Progress、Field/Notice/PageHeader/
  EmptyState）+ index.ts 桶导出；旧导入路径 ../components/ui 不变。
- 图标：AppShell 导航（Folder/ScrollText/Settings）、状态图标（CheckCircle2/
  AlertCircle/AlertTriangle）、上传（UploadCloud/FileText）、删除确认 Dialog 等
  全部 lucide；emoji/字形图标清零。
- 排版：--font-display 衬线（Iowan/Palatino/Georgia/Songti SC）用于页标题、
  Logo 与统计数字；正文保持无衬线。
- Settings 删除数据：双击确认 → radix Dialog 二次确认（ADR-UX-004）。
- kill-ai-slop 扫描：初始 3 组 10 命中（emoji 图标/过圆角/mono）→ 重构后
  图标组清零；剩余命中全部为功能性圆形（radio 点/状态点/开关拇指/编号圆）、
  真实链接下划线、mono（配对码/规则 ID/Key 输入），已逐项确认保留；
  dialog overlay 的 backdrop-blur 移除（玻璃拟态禁项）。

### 回归证据（全部实测）
- tsc 0 错；vite build 通过（index-BeEWX8pl.js）。
- qa/walk.mjs flow：新建→上传→示例→工作台→审校→导出（门禁拦截 blocked-by-audit:
  true）→历史 全通；a11y OK；keys 段 autofocus/radio Tab/Enter 提交/textarea 聚焦全通
  （"reached primary action" 为 log-only 且按钮在无 Bridge 时 disabled，非回归）。
- qa/walk.mjs tour：demo 工作台/附图/审校/导出/历史/规则/nobridge/移动端全部渲染。
- qa/walk-gate-fix.mjs：12/12 PASS（确认来源→门禁解除→导出放行闭环）。
- 新版截图 qa/screens/ux-*.png（9 张）视觉检查通过：暖纸色、橙色点缀、
  发丝边框、卡片微阴影。

### 待办
- pencil v2 .pen 生成中；docs/ux-tokens.md 已落地（令牌/组件契约/shadcn 映射/
  禁项/ADR）。
- git：branch codex/ux-refactor → commit → push（remote 待添加：ilderaj/patent-writer
  PRIVATE，历史与本地无关，PR 描述需说明合并注意）→ PR。
- wrangler deploy + 生产验证。

## Findings Record: 2026-08-09（真实多文件导出：swf_executor 执行 + Chief 验收）

### 需求闭环
- 用户裁决：导出屏 UI 承诺 7 类文件必须真实生成（此前仅单一 md，demo 甚至不下载）。
- 执行路由：ChiefOps 派发 swf_executor 可见 worker（Assignment Packet，绑定哈希核验全绿），
  worker 内可自用 subagent；Chief 独立复测后接受 candidate，规划写回由 Chief 执行。

### 实现事实（worker 证据 + Chief 抽查复核）
- packages/export 从类型骨架变为真实构建器：docx.ts（手写最小 OOXML + fflate zip，
  零新增依赖）、pdf.ts（pdf-lib + 浏览器 canvas 整页栅格化；pdf-lib 标准字体遇中文
  抛错，故中文页 canvas 绘制）、patentpack.ts（WebCrypto PBKDF2-SHA-256 200,000 次 +
  AES-256-GCM，信封纯 base64 无明文）、assembly/notes/zip/base64/figures。
- Export.tsx：勾选真实决定产物；patentpack 触发口令 dialog；版本 note 列出真实文件名
  + 当前日期；列表说明（条数/字数/图号）按项目数据派生；空选报错；门禁语义与
  「去处理」路径不变；导出路径零网络请求（隐私承诺保持）。
- demo/本地项目从"不下载"修复为与 live 同源导出。
- 交付形态：全部选中文件打包为单个 `<项目名>-草案包.zip`（规避浏览器多下载拦截）。

### 测试证据（Chief 独立复测过的项标 ★）
- ★ 单测 44/44（docx 合法 zip + document.xml；PDF %PDF 可解析页数；patentpack 往返
  一致/错口令拒绝/无明文；未选中文件不产出；note 派生与空数据 fallback）。
- ★ typecheck 0 错；★ qa/export-files.mjs 29/29（vite preview 生产构建实测）；
  ★ walk-gate-fix 12/12；walk.mjs flow/tour/keys exit 0；baseline-check 39/39；
  parsers-guard 14/14；build 通过。
- bundle：旧单文件 155.12 kB gzip → 新 index-DDo8WyK1.js 182.57 + index-BeuGjq2T.js
  161.07 = 343.64 kB gzip（+~189 kB，主要 pdf-lib）；动态 import 未形成独立异步
  chunk，两文件均首屏加载（如实记录，后续可 manualChunks/Worker 化再优化）。

### 已知限制（如实记录）
1. PDF 正文为整页图像（canvas），中文不可选中/检索；可选中需 fontkit + 中文字体子集
   （+1MB+ gzip），列为后续路径。
2. brief 模式附图（无用户图纸）输出占位页并提示「需上传图纸」，不伪造附图。
3. patentpack 口令不落盘，忘记无法找回（无服务器设计使然）。
4. 单 zip 下载依赖浏览器允许该站点下载（一次点击一个下载）。
5. 开发期发现的既有 postcss/tailwindcss 配置残留与本切片无关（配置文件已不存在）。

### 状态
- Chief 验收：ACCEPT。分支 codex/multi-file-export（e6661e8/b7ba258/c22d25a/0a37bfa），
  未 push。push + 合并 + wrangler deploy 属外部人工门，等待用户授权。

## Findings Record: 2026-08-09（Phase 17 启动：Stripe 风格原型轮审计）

### 用户指令
- `/goal @open-design`：全面 audit/review/学习 WebApp 功能与交互；用 Stripe 风格模板 + 更现代、简约、整洁、明快的交互重新设计视觉；不直接重构，先输出 prototype 交 subagent 做功能/交互 review；确保不破坏既有功能；最终原型交用户 human review。

### 功能审计结论（audit_functions，报告 /tmp/patent-audit-functions.md）
- 16 桌面屏 + 2 移动屏 + 1 未注册路由 ModelError；路由全部经 ProjectDetail 按 pathname 分发（upload/readiness/intake/strategy/figures/audit/export/history）。
- 核心链路：新建→上传（dropzone+粘贴双通道、浏览器内解析）→充分性（覆盖度+5 维度）→Intake（demo 4 题步进 / live 整页问卷必答校验）→策略确认（勾选→起草分阶段进度）→三栏工作台（大纲/编辑/实时检查 + 确认来源）→附图（auto/brief）→审校矩阵（3 统计 + 3 标签 + 确认来源/确认已处理）→导出门禁（errors>0 + 正式文件勾选 → 拦截 + 去处理）→7 文件 zip 导出（DOCX×4/PDF×2/patentpack 口令加密）→历史→设置（7 态模型来源 + 配对两步 + 解锁 + 3 开关 + 删除数据 dialog）。
- 数据模型：localStorage 3 key（patent-drafter.v1 / bridge-session.v1 / provider-mode.v1）；Project 全字段、AuditSummary(rows/checks)、VersionRecord、LiveProjectState(ctx)。
- 已知缺口（原型可补全）：ModelError 无路由；Figures「导出 Drawing Brief/上传图纸」、History「查看快照」、MobileWorkbench「保存」为无行为占位；Upload dropzone 键盘不可达；Field 无 label 关联；Readiness「4 个问题」硬编码；新项目工作台回退 demo 数据。

### 视觉/交互审计结论（audit_visual，报告 /tmp/patent-audit-visual.md + 19 张截图 /tmp/patent-audit-screens/）
- 现体系：暖纸画布 #f7f6f2 + 炭墨 + 品牌橙 #ff8400 单强调 + 发丝边框 + 衬线 display 标题 + 8-16px 圆角 + 明暗双主题；shadcn 对齐 16 个 ui 组件（radix 基元 + lucide）。
- 与 Stripe 风格差异：色温（暖纸→冷白）、衬线标题（→无衬线字重层级）、阴影/留白更克制。
- 基线回归全绿：walk.mjs flow/keys/tour 通过、walk-gate-fix 12/12 PASS；dev server 5173（/patent/）运行中。
- a11y 缺口：Dialog 缺 aria-modal、门禁提示条无 role=alert、工作台大纲条目不可键盘聚焦。

### Open Design 工作流状态
- collect_brief 卡片两次（首次过期）→ 第二次 skip 确认（launch-product / small-multi-page / refined-tech）；workflowId ccb9b69c-7f70-418a-976e-eb9f0fc2a449。
- 项目已创建：webapp-stripe-1614（conversation 10f00cfd-...）。
- **阻塞**：start_run（requestId e363c7bc-...，agent amr）返回 AMR_WORKSPACE_SCOPE_REQUIRED —— 需用户在 Open Design 的 Personal Workspace 打开该项目后才能运行 AMR Cloud；无活动项目上下文（get_active_context active:false）。等待用户 GUI 动作后以同一 requestId 重试（skill 要求不静默切换模式）。

## Findings Record: 2026-08-10（Phase 17 迭代轮：按 subagent review 修复原型）

### 两个 review subagent 结论（详见 /tmp/patent-review-functions.md / /tmp/patent-review-ux.md）
- 功能覆盖：P0=1 / P1=3 / P2=14。核心语义全部实测正确：导出门禁（errors>0 拦截+动态特征名+去处理+patentpack 豁免、三条解除路径放行）、localStorage 持久化、审校三标签、Intake 步进、设置 7 态模型来源。P0=live 路径零内容产出（真实起草只跑 stages 覆盖层不写数据）；P1=导出演示级（假路径无下载）、充分性/策略静态、状态模型 3→9 简化。
- 交互质量：P0=0 / P1=3 / P2=15。Stripe 风格基调成立（冷白 #fff/#f6f8fa、无衬线字重层级、发丝边框、单强调色、120-200ms 动效、dialog aria-modal/焦点圈闭/Esc 达标）。P1=.field-error display:flex 覆盖 hidden 导致校验错误常显、工作台 textarea 无焦点环、项目类页面缺 .page 包裹（0px vs 64px 两套内边距）。

### 迭代修复（直接落盘 Open Design 项目 webapp-stripe-a08b，零触碰真实仓库）
- **P0 live 内容产出**：新增 PD.makeLiveDraft(p)（data.js）——起草 onDone 时为无内容项目生成 6-7 条权利要求、五段式说明书、摘要、4 附图、审校矩阵（含 1 条无来源 fail 演示门禁）、7 导出文件，并按审校结果置状态。
- **P1 导出真实化**：新增 PD.zip（最小 ZIP STORE 写入器 + UTF-8 文件名位）+ PD.encryptPack（WebCrypto PBKDF2-SHA256 100k + AES-256-GCM 真实信封）+ PD.buildExportBundle（所选文件真实打包下载 `<项目名>-草案包-<日期>.zip`，patentpack 真实加密；DOCX/PDF 以 .txt 占位并附 README 说明）。版本记录写入真实文件名列表。
- **P1 充分性/策略派生**：覆盖度按上传字数计算（52-92%）、5 维卡与策略四块按类型/Intake 答案变化、建议类型随 p.type。
- **P1 状态机**：PD.STATUS 9 态映射 + PD.applyStatus 流转（待上传材料→充分性评估→补充信息→策略确认→起草中→审校中→已完成/需处理）。
- **P1 表单错误常显**：styles.css 全局 [hidden]{display:none!important}（I-01 四屏同愈）。
- **P1 textarea 焦点环**：.wk-textarea:focus-visible 橙环。
- **P1 .page 统一**：main.js 非裸路由统一包 .page（与 /rules /settings 对齐 64px 内边距）。
- **P2 批量（12 项）**：时间线最新在前（unshift→push）、导出默认全选 7 文件、新项目导出空态文案、favicon 404（data URI）、stages 覆盖层焦点圈闭+Esc、/new Enter 校验反馈、live intake 答案持久化、面包屑统一指向工作台、未勾文件 toast、popover role=dialog+Esc、tabs roving tabindex/aria-controls/tabpanel、配对码 role=img、解锁/API Key 错误 role=alert、移动端 h1、对比度 token（--faint #7c8ba1 / --border-strong #aeb6c2）。

### 迭代验证（全部实测）
- node --check 6 文件 0 错；pd-verify 15 路由渲染零 console 错误（favicon 404 消除）。
- pd-fix-verify2：24/25 PASS（1 FAIL 为测试选择器对 CSS 序列化空格过于严格，功能已实测通过）——覆盖：live 全流程内容产出、覆盖度派生、Intake 无预显错误、策略类型/四块、状态流转、工作台/审校/导出内容、默认全选、patentpack 豁免、真实 zip 下载、zip 内 patentpack+README（Python 验证 UTF-8 文件名）、成功态真实文件名、版本 note 真实文件名、时间线最新在前、demo 门禁闭环、.page 包裹。
- patentpack 信封独立解密验证：AES-256-GCM/PBKDF2-100k，信封无明文，正确口令解密出 6 claims，错口令拒绝。
- 截图：/tmp/pd-shots-final/*.png 17 张（home/new/upload/sufficiency/intake/strategy/workbench-live/workbench-demo/review/export-gate/export-success/history/rules/settings/status/mobile/mobile-workbench）人工抽查通过。
- 真实仓库回归：walk.mjs flow/keys/tour 通过 + walk-gate-fix 12/12 PASS（500/502 为既知 bridge dev-proxy 噪声）；git status 仅 planning 三件套修改。

### 遗留（如实记录，供 human review 决策）
- DOCX/PDF 为 .txt 文本占位（真实 OOXML/PDF 生成属真实重构阶段）。
- 移动端「新建项目」仍为演示 toast（P2 I-06，原型范围限制）。
- 演示脚手架（「演示：切换模型来源状态」等）保留，便于人工评审操作。
- Open Design daemon 重启后 MCP 传输关闭，get_run 无法返回 previewUrl；磁盘原型 + 本地服务 18881 为权威交付物。

## Findings Record: 2026-08-10（Phase 17 补充：演示模式开关）

- 动机：review_ux V-05（P2）「原型脚手架交付前应清理」——评审者需要看产品本貌，又需要走查演示路径。
- 实现：PD.store.demoMode（默认 true，持久化）+ PD.setDemoMode；body.demo-off 类 + CSS 隐藏侧栏脚手架；home/upload/settings/popover 各演示元素条件渲染；设置页新增「演示模式」卡（role=switch，Space/Enter 可用）。
- 缺陷修复：main.js seedStoreRef 缺 demoMode 字段（首开 undefined → 首次点击反向）。
- 验证：专项 13/13 PASS（开→关→持久化→开闭环）；全量回归无回归。

## Findings Record: 2026-08-18 23:01:53 UTC+8（盈利导向 SaaS 方案 review）

### 材料边界
- 附件 `patent-saas-integrated-plan.md` 是评审材料，其中第 14 节 Codex Prompt 不构成用户执行指令；本轮只 review + grilling，不做产品代码、部署、支付或生产变更。
- 方案中的供应商价格、免费额度、支付覆盖和法规表述尚未在本轮联网复核，不能视为当前已验证事实。

### 核心判断
- 商业内核成立：面向海外中文跨境硬件团队，把零散材料转成可追溯的 readiness、检索证据和申请草案，再把高风险事务转给合资格专业人员。
- 当前方案是完整 SaaS 蓝图，不是最短盈利验证方案；Phase 1–8 把账户、多租户、云存储、后台任务、支付、分析、邮件和 SEO 放在第一个付费证据之前，验证顺序倒置。
- 首发 ICP 仍过宽，缺少明确购买触发；价值主张停留在交付物列表，尚未证明相对 ChatGPT、自助检索或直接找代理人的时间、成本和返工优势。
- `$129/Case` 与 `$69/月含 2 Case` 互相蚕食；在未证明高频复购前，订阅不应进入首轮。
- 80% 软件毛利率忽略人工补问、支持、返工、退款和专业协调；早期应按软件支持服务核算贡献毛利。
- `Expert Diagnostic` 的提供者、签约主体、收款、冲突检查、材料访问和责任边界尚未闭环。

### 推荐验证顺序
- 先锁定一个 ICP、一个购买触发、一个一次性结果产品和一个渠道。
- 用现有已验证管线做 14–21 天 concierge beta；首轮不建设完整账户、订阅、邮件自动化和内容集群。
- 目标从 30 个注册改为约 20 个合格潜客中的 5 个真实付款；逐单记录全部变量成本与人工分钟。
- 进入完整 SaaS 的建议门槛：5 个真实付款、3 个完成交付、P90 变动成本已知、计入人工后贡献毛利为正、无严重边界投诉，且至少 3 位客户确认结果可用于下一步行动。

## Findings Record: 2026-08-18 23:08:45 UTC+8（Owner Grilling Round 1）

- 盈利定义：未来 3–6 个月先证明每个付费 Case 在计入人工后仍有正贡献毛利，不以 MRR 或规模化订阅为第一目标。
- 首发 ICP：第一批 5 个付费客户只面向海外中文硬件团队。
- 交付模式：采用人工辅助 Beta；复用现有产品，允许人工 onboarding、质检和支持，并记录人工分钟。
- 以上决定解锁下一层：主购买触发、唯一购买结果、首发数据模式。

## Findings Record: 2026-08-18 23:10:17 UTC+8（Owner Grilling Round 2）

- 主购买触发：目标客户处于产品发布、众筹或公开展示前 90 天，需要在公开披露前完成申请准备。
- 唯一付费结果：可交给代理人继续复核的中国专利申请准备包；不承诺用户可不经专业判断直接递交。
- 首发数据模式：Local-first，完整 Case 与材料保存在浏览器本地；首批 Beta 不建设云端历史和跨设备恢复。
- 以上决定解锁下一层：单 Case 的申请类型、检索范围、修订与支持上限。

## Findings Record: 2026-08-18 23:12:37 UTC+8（Owner Grilling Round 3）

- 申请类型：系统可以建议中国发明或实用新型，但一个付费 Case 最终只选择并交付其中一种路线。
- 检索范围：用户明确选择完整检索策略、候选结果、特征对照和风险报告，而非排除或轻量检索。
- 修订边界：交付后 14 天内包含一轮结构化纠错；新增发明主题必须新购 Case。
- 关键影响：唯一商品从“起草准备包”扩展为“检索 + 起草准备包”；在价格和毛利决策前，必须核对当前仓库的真实检索能力与成本未知。

## Findings Record: 2026-08-18 23:35:01 UTC+8（检索能力核对 + Owner Grilling Round 4）

### 当前仓库事实
- 当前仓库没有 `packages/search`、外部专利数据库/API、检索领域模型、检索 UI 或检索测试。
- 现有 18 阶段是材料摄取、事实提取、补问、策略、起草、审校与导出；不包含查询生成、数据库检索、专利族去重、全文获取或特征对照。
- `external_context` 只是治理枚举，没有真实获取链；“互联网补充研究”开关也未接执行逻辑。
- 因此完整检索必须作为独立子管线；不能声称现有 MVP 已具备，也不能只用一个额外 Prompt 实现。

### Owner 决策
- 报告结论：只提供候选证据、特征对照、风险等级和检索局限，不提供授权概率、FTO 或法律意见。
- 人工复核：Beta 包含平台对材料完整性和交付产物的质量检查；合资格代理师复核作为另购服务。
- 以上决定解锁下一层：首 5 单检索交付方式、文献覆盖、协议上限。

## Findings Record: 2026-08-19 09:59:52 UTC+8（现成专利检索能力调研：初步）

### 已锁定决策
- Q13：首发覆盖 CN、WIPO、US、EP 等全球主要专利文献，暂不包含论文、产品网页等非专利文献。
- Q14：“完整”定义为按公开协议完成固定查询族、候选筛选和深度对照，并披露上限与局限；不宣称穷尽全球资料。
- Q12：暂缓选择人工检索或先建设自动管线；先调查现成方法、API、MCP 与 Agent Skill。

### 初步外部发现（未完成最终比较）
- EPO OPS：官方 REST/XML 服务，来源与 Espacenet/European Patent Register 同源，提供书目、全球法律状态、全文和图像数据；需注册应用和 OAuth，适合官方基础数据层。
- Lens Patent API：REST API，120+ 搜索字段，支持专利全文/书目等综合数据；商业持续使用需申请 Member/Custom 付费访问，Trial 仅适合短期非商业或有限学术用途。
- USPTO Open Data Portal：官方 API，但更偏美国数据产品/档案；2026-06-18 起访问 ODP 需有效 USPTO.gov 账户，不能单独覆盖全球检索。
- WIPO PATENTSCOPE：网页检索覆盖 PCT 和参与局数据，支持多语言字段检索；公开资料未显示适合商业产品直接调用的稳定通用 PATENTSCOPE Search API，需继续核对 API Catalog/授权。
- Google Patents Public Data/BigQuery：可查询国际专利公开数据，按 BigQuery 查询量付费且无 SLA；`google/patents-public-data` 示例仓库已于 2026-04-18 归档，更适合批量分析和离线候选生成，不宜直接作为低延迟逐 Case 主 API。
- PatentsView Search API：美国专利搜索，45 req/min；当前官方文档显示暂停发放新 API key，只适合作为美国补充源。
- 本机已安装 Skill 中未发现专门的 prior-art/patent-search skill。
- GitHub 上存在 `patent-skills`、`patent-disclosure-skill`、`Paper-to-patent-Skill` 等开源 Agent Skills；初步看主要提供流程、起草、专利点提取或浏览器自动化，不能替代可授权的数据 API 与检索质量门。

## Findings Record: 2026-08-19 10:02:42 UTC+8（Q12 市场能力调研：结论）

### 能力分层
- 官方 API 可做数据底座：EPO OPS 覆盖 Espacenet/European Patent Register 同源的全球书目、专利族、法律事件和部分全文；免费额度 4 GB/周，条款允许将数据用于自有产品与服务，但不得把原始数据本身公开再分发。USPTO ODP 适合作为美国补充。CNIPA 官方答复指向“知识产权数据资源公共服务系统”，属于注册取数路径，不是已确认的即开即用公开 Search API。WIPO 有 API Catalog 和 PATENTSCOPE 网页，但未确认面向商业产品的通用 PATENTSCOPE Search API。
- 商业聚合 API 可减少多源工程：Lens Patent API 有 120+ 搜索字段；14 天 Trial 仅限非商业/有限学术用途，商业集成必须申请付费 Member/Custom Access，价格需询价。若报价与许可合适，可作为后续自动化首选聚合层。
- Agent 工具已存在，但质量差异大：FlowLeap 提供 CLI、MCP、Agent Skills 和 prior-art recipe，调用 EPO/USPTO，当前公开定价页显示 49 美元/月、另付自带 LLM；但官网首页同时显示 99 美元/月，购买前必须确认最终价格与商用条款。`navisbio/OPS-patent-search-mcp` 是较聚焦的 EPO OPS MIT 封装，有分页全文、专利族 fallback、法律状态和引用工具，可作为技术试点或参考实现。`sapientsai/patents-mcp-server` 横跨 EPO/USPTO/BigQuery，适合参考多源架构；`openpharma-org/patents-mcp` 仅 6 commits，成熟度不足。
- 非官方抓取不应成为生产依赖：依赖 Google Patents 未公开 XHR、CNIPA Playwright/WAF、代理池或网页结构的 Skill/脚本，最多用于人工研究辅助；不能支撑付费交付 SLA、来源完整性和长期可维护性。
- 本机已安装 Skill 目录中没有专门的 prior-art/patent-search skill；如采用 FlowLeap，需另行安装、注册并经过数据出境/保密、许可、结果可复现和失败模式审计。

### Q12 推荐
- 首 5 个付费 Case 采用“人工主导、Agent 辅助”的 concierge 协议：人负责检索策略批准、结果判读、漏检补查和最终 QA；Agent 负责术语/CPC 扩展、查询执行、候选归并、专利族去重、特征矩阵初稿和检索日志。
- 工具顺序：先用 FlowLeap 7 天试用跑一个历史 Case，与同一检索协议的人工官方网页基线对照；若质量、隐私和价格通过，则用其 MCP/Skill 加速 Beta。若不通过，改用审计后的 `OPS-patent-search-mcp` 或自建薄 EPO OPS adapter，并用 PATENTSCOPE、CNIPA、USPTO 官方界面人工补缺。
- 首 5 单不先建设完整多源自动检索平台，也不依赖 Lens 商业 API 才开卖。并行申请 Lens Custom Access 报价，作为 5 单后自动化候选。
- 对客户的承诺仍是“协议完整、范围透明”，不是“AI 自动完成”或“穷尽全球”；每单保存查询式、库、日期、命中数、筛选原因、深读文献、族归并、失败/缺口和人工签核。

## Findings Record: 2026-08-19 10:58:43 UTC+8（Owner 确认 Q12）

- Owner 选择 `A`，正式锁定 Q12：首 5 个付费 Case 采用人工主导固定检索协议、Agent 工具加速、官方数据库人工补缺；不先建设完整多源自动检索平台。
- Round 5 检索实现决策闭环。下一层必须先约束单 Case 的人工时间、未公开材料外发边界和交付时效，之后才能计算价格与正贡献毛利门槛。

## Findings Record: 2026-08-19 15:49:01 UTC+8（Owner Grilling Round 6）

- 人工上限：每个 Case 的 onboarding、检索判断、平台 QA 和一次结构化纠错合计最多 4 小时。
- 数据外发：最小必要外发；向客户明示服务商和用途，检索服务不接收完整原始附件，只发送完成任务必要的查询或文本片段。
- 交付 SLA：材料完整且付款后 5 个工作日交付。
- 以上决定把 concierge Beta 变成了可核算服务，但“正贡献毛利”仍缺三项前提：人工影子成本、付款前接单门、材料完整/SLA 起算的客观判定。

## Findings Record: 2026-08-19 21:24:04 UTC+8（Owner Grilling Round 7）

- 人工成本：按 US$50/小时计入贡献毛利，单 Case 4 小时上限对应最多 US$200 人工成本；不以创始人免费劳动美化利润。
- 接单门：付款前完成标准清单自动筛选和最多 15 分钟人工确认；不适合标准 Case 的客户不进入付费交付。
- SLA 起算：必填材料与问题清单通过且平台确认后，5 个工作日开始计时；等待客户补充材料期间暂停。
- 定价前尚需锁定贡献毛利率底线、非人工变动成本预算，以及“检索结果不利仍属于有效交付”的退款规则。

## Findings Record: 2026-08-19 21:33:35 UTC+8（Owner Grilling Round 8）

- 单 Case 贡献毛利率底线：至少 40%，口径包含人工、模型、数据/检索工具、支付费用和退款准备金。
- 非人工变动成本上限：每 Case 最多 US$40；加上最多 US$200 人工，最坏情况总变动成本为 US$240。
- 退款语义：检索发现高度相近现有技术或客户不喜欢结论，仍属于按协议完成的有效交付；仅平台未交付，或付款前范围判断错误导致无法履约时退款。
- 定价推导：若售价 US$399，则最坏情况贡献毛利为 US$159、毛利率约 39.8%，低于已锁底线；US$499 时贡献毛利为 US$259、毛利率约 51.9%，有约 11.9 个百分点的早期波动缓冲。

## Findings Record: 2026-08-19 21:34:51 UTC+8（Owner Grilling Round 9）

- 首批 5 个付费 Case 定价：一次性 founding Beta 价 US$499，不引入订阅或低价促销。
- 收款：付款前通过范围筛选；人工发送一次性付款链接或 invoice，全额到账后启动 Case，不先建设自动结账系统。
- 超限：4 小时内完成标准协议交付并披露限制；额外复杂工作必须单独报价并取得客户书面接受，不免费吞掉，也不自动追加小时费。
- 最坏情况单位经济：US$499 收入 - US$200 人工 - US$40 其他变动成本 = US$259 贡献毛利，约 51.9%。
- 原综合方案的 US$129/Case 与当前已锁范围和成本结构不相容，应明确废弃。

## Findings Record: 2026-08-19 21:38:56 UTC+8（Owner Grilling Round 10）

- 首个且唯一主获客渠道：创始人定向外联，通过现有人脉、海外中文硬件社群和一对一介绍触达处于公开前 90 天的合格团队；首轮不以 SEO 或付费广告验证。
- Beta 并发上限：最多 2 个进行中 Case，以保护 5 个工作日 SLA 并逐单记录人工时间。
- 完整 SaaS 重构放行门：5 个真实 US$499 付款；至少 3 个按 SLA 完成交付；首批整体贡献毛利不低于 40%；至少 3 位客户确认产物可交代理人继续工作。任一未达成，不进入完整 SaaS 建设。
- 新暴露矛盾：Local-first 与人工 QA 需要明确的客户授权临时数据通道；否则平台无法执行已承诺 QA，或会因长期云端留存破坏 Local-first 边界。

## Findings Record: 2026-08-19 21:40:03 UTC+8（Owner Grilling Round 11）

- 人工 QA 数据路径：客户显式导出加密 patentpack，经一次性安全通道传给平台；解密口令使用另一通道。浏览器内原始 Case 不自动上传。
- 代理人复核：平台只做透明转介；客户与合资格代理机构直接签约、付款并授权其访问材料。平台在 Beta 不转售代理服务。
- 最终确认与递交：由客户或其代理人负责；平台不代表客户向 CNIPA 递交，不提供授权概率、FTO 或法律意见。
- 这一边界保留了 Local-first 主体，但平台会短暂持有 QA 副本，因此必须继续明确内容留存期、最小权限和客户同意记录。

## Findings Record: 2026-08-19 21:41:23 UTC+8（Owner Grilling Round 12）

- QA 内容副本：结案后 30 天内删除，覆盖 14 天纠错窗口和操作缓冲；之后只保留不含发明正文的计费、同意版本、访问与删除审计记录。
- 访问控制：每个 Case 仅一名具名 QA 负责人可解密访问；记录访问、交付和删除时间，其他团队成员默认无权访问，Beta 不开放外包人员。
- 明确同意：付款前单独展示临时传输的数据类型、服务商、用途和删除期限并留存同意版本；不同意者不进入人工辅助 Beta。
- Local-first 的可执行定义因此收敛为：浏览器内原始 Case 默认不上传；仅由客户为人工 QA 主动发起一次受控、最小权限、限期删除的加密副本传输。

## Findings Record: 2026-08-19 21:43:09 UTC+8（Owner Grilling Round 13）

- 对外唯一产品名称/承诺：中国专利申请准备包；面向公开前 90 天的海外中文硬件团队，5 个工作日交付检索证据、一条申请路线草案和 QA 记录，供代理人继续复核。
- 材料准入固定五项：技术问题；解决方案与差异特征；结构/流程证据或附图；发明人与申请人信息；首次公开日期。缺项不付款、不启动 SLA，先补齐。
- 14 天一轮结构化纠错：修正平台遗漏、错误表达和原材料中已存在的事实；新增主题、新申请路线或重做检索需要新购 Case 或另行报价。
- 仍需把“协议完整”落成数字上限，并明确是否包含专业附图制作和双语交付，否则 4 小时成本上限仍可能被隐性范围击穿。

## Findings Record: 2026-08-19 21:52:31 UTC+8（Owner Grilling Round 14：发现约束冲突）

- 检索协议数字上限已选 A：最多记录 10 条跨中英关键词/分类/引用路径查询式，筛选最多 40 个去重专利族，深度特征对照最多 8 篇最接近文献。
- 附图范围已选 A：整理客户已有图、图号和附图说明，缺图输出绘图简报；不包含专业制图或工程图重绘。
- 交付语言选择 B：中英双语全套。但该选择与既有 US$499、最多 4 小时人工、至少 40% 毛利三项硬约束冲突，暂不作为最终承诺写死。
- 冲突测算：若完整双语增加约 2 小时翻译/双语 QA，人工上限从 US$200 增至 US$300；连同 US$40 非人工成本，US$499 的最坏贡献毛利为 US$159、约 31.9%。若改为 US$699/6 小时，最坏毛利为 US$359、约 51.4%；若作为 US$199 加购，整体收入 US$698，按约 US$340 总变动成本测算，毛利约 51.3%。
- 因此需要 Owner 明确在“US$499 标准包中文主体 + 双语加购”与“US$699 标准包完整双语”之间选择，不能静默牺牲利润或质量。

## Findings Record: 2026-08-19 21:59:24 UTC+8（Owner Grilling Round 15）

- 双语经济：US$499 标准包保持中文申请草案/报告主体，外文引证保留原文并给中文要点；完整英文套件作为 US$199 加购，增加最多 2 小时人工。标准包和加购都需单独核算贡献毛利。
- 付款前最小建设：只完成历史 Case 检索基准、五项准入与数据同意清单、人工计时/成本台账、付款与交接操作面；不建设账户、订阅、云端历史、邮件自动化、SEO 系统或完整后台。
- 验证周期：从第一批定向外联开始固定 21 天，目标触达 20 个合格潜客并获得 5 个真实付费 Case。
- 下一步需把“合格潜客”和“可交代理人继续工作”变成不可自我解释的证据，并明确 21 天失败后的停机规则。

## Findings Record: 2026-08-19 22:01:01 UTC+8（Owner Grilling Round 16）

- 合格潜客计数需同时满足四项：海外中文硬件团队；90 天内计划公开；可接触决策人或发明人；愿意完成五项材料预筛。普通访问、泛咨询和无明确触发者不计入 20 个。
- 代理人可行动证据：至少 3 位客户把准备包实际交给其代理人；代理人能够继续复核，未因核心材料缺失而将整包以 P0 形式退回；平台记录结构化反馈，不以客户或平台主观判断替代。
- 21 天失败规则：未达到 5 个真实付款即冻结完整 SaaS 建设，访谈未购买者；只允许基于证据修改一个变量，再启动新的明确期限实验，不自动延期、不边建边卖。

## Findings Record: 2026-08-19 22:38:18 UTC+8（Owner Grilling Round 17）

- 首批 QA 负责人：由创始人本人统一执行非法律性质的平台 QA 并逐单记录实际时间；首 5 单前不招聘、不外包，也不把平台 QA 偷换成另购代理人复核。
- 客户沟通配额：结构化表单和异步消息为主；必要时包含一次最多 30 分钟澄清会，全部计入标准 Case 的 4 小时人工上限。
- 订单协议：付款前逐单签署一页 Beta 订单书，至少列明交付物、排除项、SLA、纠错范围、退款语义、数据流/服务商/删除期、非法律服务和代理/递交责任，再发送全额付款链接。
- 剩余最终放行前提：检索工具必须先通过历史 Case 基准；订单与数据边界应决定是否做专业审阅；每单成本、时间、SLA 和结果必须决定使用手工台账还是提前建设分析系统。

## Findings Record: 2026-08-20 09:23:36 UTC+8（Owner Grilling Round 18 + Shared Understanding）

### 最终三项放行决定
- 历史检索基准：首位付费客户前，用一个已知发明专利 Case 和一个已知实用新型 Case 验证真实检索管线；必须找回已知接近现有技术、来源链接可打开、专利族去重正确，并可重复生成 10 条查询式/40 个去重专利族/8 篇深读的报告。
- 专业边界审阅：首笔收款前，由独立专业人士对一页 Beta 订单书和数据处理声明做限定审阅；只核对非法律服务边界、退款、数据流与保密、代理人及递交责任，修改后冻结 Beta 版本。
- 逐单计量：首 5 个 Case 使用统一手工台账，记录各阶段时间、直接成本、SLA、纠错、退款和代理人反馈；验证前不建设分析仪表盘。

### Shared understanding：产品与客户
- 当前目标不是先获得 MRR，而是证明每个 Case 能产生正贡献毛利；原方案“先建完整 SaaS、再验证付费”的顺序被否决。
- 唯一首发 ICP 是计划在 90 天内发布、众筹或公开演示的海外中文硬件团队；合格潜客还必须能接触决策人/发明人，并愿意完成五项材料预筛。
- 对外唯一商品是“中国专利申请准备包”：交付供中国专利代理人继续复核的材料，不是代写即提交、法律意见或一站式代理服务。
- 每个付费 Case 只交付发明或实用新型中的一条路线。付款前必须具备技术问题、解决方案与差异特征、结构/流程证据或附图、发明人与申请人信息、首次公开日期五项材料。

### Shared understanding：交付、检索与范围
- 标准包在材料完整且平台确认、全额付款后启动 5 个工作日 SLA；等待客户补充时暂停。14 天内含一次结构化纠错，仅覆盖平台错误、遗漏及原材料已有事实；新增主题、路线或重做检索属于新 Case 或另行报价。
- 检索采用人工主导固定协议、Agent 工具加速、官方数据库补缺；先试点 FlowLeap，不通过则采用审计后的 EPO OPS MCP/薄适配器，并用 PATENTSCOPE、CNIPA、USPTO 官方界面补查。生产交付不依赖网页抓取或 WAF 绕行。
- 首发覆盖 CN/WIPO/US/EP 等主要全球专利文献，不包含非专利文献；“完整”只表示协议完整、范围和限制透明，不表示穷尽全球。
- 每单最多记录 10 条查询式、筛选 40 个去重专利族、深读并做特征对照 8 篇最接近文献。报告只给证据、特征映射、风险层级与局限，不给授权概率、FTO 或法律结论；不利现有技术仍属于有效交付。
- 附图仅整理客户已有图、图号和附图说明，缺图时输出绘图简报，不含专业制图或工程图重绘。标准包以中文草案/报告为主，外文引证保留原文并给中文要点；完整英文套件为 US$199 加购，最多增加 2 小时人工。

### Shared understanding：价格、成本与运营
- 首 5 个真实付费 Case 的 founding Beta 价为 US$499，全额预付，先人工筛选再发送付款链接或 invoice；不设订阅、优惠券、免费试用或自动结账。
- 每个标准 Case 最多投入 4 小时人工，按 US$50/小时计入成本；非人工变动成本最多 US$40。最坏情况贡献毛利为 US$259，约 51.9%，高于至少 40% 的底线。
- 4 小时内完成标准交付并披露限制；额外复杂工作必须另行书面报价，不免费吞掉，也不自动追加小时费。仅平台未交付或付款前范围筛选错误导致无法履约时退款。
- 首 5 单由创始人本人执行非法律性质的平台 QA，最多 2 单并发；沟通以结构化异步为主，必要时含一次最多 30 分钟澄清会，全部计入 4 小时上限。

### Shared understanding：专业与数据边界
- 代理人复核另购：平台只透明转介，客户与合资格代理机构直接签约和付款；最终文本确认及向 CNIPA 递交由客户或其代理人负责。平台不代理递交、不提供法律意见、FTO 或授权概率。
- Local-first 的可执行定义：原始 Case 默认不上传；客户为人工 QA 主动导出加密 `.patentpack`，经一次性安全通道发送，口令走另一通道。检索工具只接收最小必要查询或片段，不接收完整原始附件。
- 每个 Case 仅一名具名 QA 负责人可解密访问，并记录访问、交付和删除。付款前明确展示数据类型、服务商、用途、删除期限并取得同意；不同意者不进入人工辅助 Beta。
- QA 内容副本在结案后 30 天内删除，以覆盖 14 天纠错窗口；此后只保留不含发明正文的计费、同意、访问和删除审计元数据。

### Shared understanding：实验与停机门
- 首笔收款前只补四类 Beta 必需面：两件历史 Case 检索基准、五项准入与数据同意清单、人工计时/成本台账、人工付款与交接操作面。暂不建设账户、订阅、云端历史、邮件自动化、SEO、完整后台或分析仪表盘。
- 获客只用创始人定向外联；从首次外联起 21 天内触达 20 个同时满足四条件的合格潜客，目标取得 5 个真实 US$499 付款。
- 完整 SaaS 放行门：5 个真实付款；至少 3 个按 SLA 交付；首批整体贡献毛利至少 40%；至少 3 包实际交给代理人，且未因核心材料缺失被 P0 整包退回。
- 21 天未达 5 个付款即冻结完整 SaaS 建设，访谈未购买者，只修改一个变量后再启动新的限时实验；不自动延期，不边建边卖。

### 最终评审结论
- 原方案的商业核心可以保留，但 US$129/Case、US$69/月订阅和完整 SaaS 优先建设均不成立；现有起草、审校、导出和 Local-first 资产应作为准备包的能力底座，检索则是需要独立验证的新子管线。
- Grilling design tree 已无未决 frontier。以上 shared understanding 等待 Owner 最终确认；确认前不进入产品代码、部署、支付 live、客户外联或真实数据处理。

## Findings Record: 2026-08-22 21:45:09 UTC+8（Shared Understanding 确认 + Beta 最小建设计划）

- Owner 明确回复 `确认 shared understanding`；Phase 18 的产品、客户、价格、交付、检索、专业/数据边界、单位经济和实验停机门成为后续规划基线。
- 独立 companion plan 已建立：`docs/plans/profitable-patent-beta-minimum-build.md`，生命周期为 `waiting_execution`。
- 计划采用证据优先顺序：先固定范围和复用矩阵，再验证发明/实用新型各一历史 Case，随后完成运营包和完整干跑；只有干跑证明存在阻断时才做条件式最小产品改造。
- 首笔收款前仍有五道硬门：两件检索基准通过、4 小时/US$40 演练成立、订单与数据声明限定专业审阅、安全交接/删除演练、Owner 最终 go/no-go。
- 本次确认只授权规划收口，不授权执行任何切片。

## Findings Record: 2026-08-22 22:21:01 UTC+8（Slice 1 候选来源收敛）

- 首个可见 `swf_executor` 在绑定后持续保持 `running`，但未产生允许路径文件、未返回 milestone 或审批请求；Chief 经多次有界等待和两次 check-in 后显式释放该 semantic lane，保留一次同 slice 替代机会。
- 为降低替代 worker 的开放式研究成本，Chief 先收敛两个公开候选：
  - 发明路线候选 `EP2845700A1`（Clippers for separating chocolate pieces）。EPO 2026 examiner learning path 明确把它作为 Citations/SEA 示例；公开索引显示 `FR742229A` 为 examiner-cited 文献，且同族还列出 `DE202006019957U1`、`US7717017B2`、`US20110289784A1` 等候选。正式基准仍需 worker 逐链接验证并区分 SEA 与 applicant citation。
  - 实用新型候选 `CN221531624U`（一种基于三模通讯的共享热水表）。现有已验收定稿材料把 `CN217157378U` 写入背景技术；公开索引可稳定检索到技术接近的 `CN209417602U`（LoRa + Zigbee 双无线流量控制器）。正式选择不得把“similar”偷换成 examiner citation，应把“已知接近文献”的证据类型写清。
- 协议权威解释来源已核对：EPO Register 将 X/I/Y/A 等类别定义为检索/审查相关性标签；EPO Espacenet Citation 视图区分 citation origin，并支持按 family 查看 cited documents；PATENTSCOPE 用户指南确认可访问 ISR/WOSA 文档。
- 当前网络局限：直接 `open` 某些 Google Patents/EPO 深链会触发 cache miss 或安全 URL 拒绝；替代 worker 必须用 fresh HEAD/GET 或可见浏览器验证，不得仅依赖搜索摘要。

## Findings Record: 2026-08-22 22:44:09 UTC+8（Slice 1 Chief acceptance）

- 替代可见 `swf_executor` 在冻结绑定 `61850e390f885362e8bd93c2f03e27f39ce08ce6` 上只创建 5 个允许路径：检索协议、历史基准选择、发明/实用新型脱敏 fixture、确定性校验器；未提交、未触碰产品代码或其他路径。
- TDD 证据：候选在产物不存在时获得真实 RED `0/4 PASS`、exit 1；完成后 worker 与 Chief 独立运行均为 `68/68 PASS`、exit 0，`git diff --check` exit 0。
- 发明基准固定为 `EP2845700A1`，预期恢复 5 条 examiner citation：`FR742229A`、`DE202006019957U1`、`US20090308211A1`、`US20110289784A1`、`US20130183631A1`；`US7717017B2` 因无法在 fresh 页面恢复而排除。
- 实用新型基准固定为 `CN221531624U`：`CN217157378U` 仅标记 `applicant_background`，`CN209417602U` 仅标记 `technical_neighbor`，不得偷换为 examiner citation。
- Chief fresh 验证核心公开页 `EP2845700A1`、`FR742229A`、`CN221531624U`、`CN217157378U` 均 HTTP 200；EPO 深链仍为 403，已在选择文档披露并延至 Slice 2 可见浏览器/OPS 路径复核。
- 协议明确：检索到高度接近文献与未发现阻断性文献均是有效协议结果；任何结果都不提供授权概率、FTO、法律意见，也不表示穷尽全球。
- requested worker profile 为 `opencode-go/deepseek-v4-flash xhigh`、approval policy `on-request`；实际模型、effort 与 approval policy 无 Host 认证证据，保持 `unknown`。
