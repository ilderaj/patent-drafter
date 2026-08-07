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
