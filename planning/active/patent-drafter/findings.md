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
