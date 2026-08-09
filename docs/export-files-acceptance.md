# 真实多文件导出 — 验收文档（patent-drafter / multi-file-export）

> 切片：把 apps/web 导出屏从「UI 列 7 个文件、实际只下载单个 md（demo 甚至不下载）」修复为真实多文件导出。
> 全部文件在浏览器本机生成，无服务器、无新增网络请求。
> 证据脚本：`node packages/export/tests/export-builders.test.mjs`（44/44）、`node qa/export-files.mjs`（29/29，demo + live 两类项目）、`node qa/walk-gate-fix.mjs`（12/12）。

## 一、UI 承诺 → 实际产物 对照表

| UI 列表项（勾选框） | 实际产物（zip 内文件名） | 格式 | 内容来源 | 测试证据 |
| --- | --- | --- | --- | --- |
| 专利申请文件草案合集.docx | `专利申请文件草案合集.docx` | 真实 OOXML（zip + [Content_Types].xml + word/document.xml） | 权利要求书 + 说明书 + 摘要合并，分「第一部分/第二部分/第三部分」 | 单测：合法 zip + document.xml；qa：三部分标题均在 bundle.xml |
| 权利要求书.docx | `权利要求书.docx` | 真实 OOXML | `project.claims[].text`（live 由 ctx.results.draft_claims 经 liveProjectView 派生，同源） | 单测：document.xml 含权利要求文本与 XML 转义；qa：含权1文本 |
| 说明书.docx | `说明书.docx` | 真实 OOXML | `project.specSections[]`（live：draft_specification） | 单测/qa 同上 |
| 说明书摘要.docx | `说明书摘要.docx` | 真实 OOXML | `project.abstractText`（live：draft_abstract） | 单测/qa 同上 |
| 说明书附图.pdf | `说明书附图.pdf` | 真实 PDF（%PDF，pdf-lib 可解析） | demo：6 个 figure 元数据生成确定性 SVG → 浏览器 canvas 栅格化 PNG 嵌入，每图一页；live：按 generate_figure_specs 数据；无附图 → 「无附图」占位页；brief 模式（需上传图纸）→ 占位页并如实提示 | 单测：页数 = 附图数、占位页、无附图页；qa：demo 6 页、live 2 页 |
| 起草审阅报告.pdf | `起草审阅报告.pdf` | 真实 PDF | audit.rows（支持矩阵）、audit.checks（审校检查）、AI 辅助标识（live 取 ctx.results 首个 stage meta；demo 取版本记录 meta）、导出时间、规则包版本 | 单测：spec 携带矩阵/检查/AI 标识/时间/规则包版本；qa：可解析 |
| 项目备份.patentpack（加密） | `项目备份.patentpack`（「（加密）」为 UI 注解，非文件名） | 加密信封 JSON `{v:1,alg,salt,iv,ciphertext}` | WebCrypto PBKDF2-SHA-256（200,000 次迭代）+ AES-256-GCM；载荷 = 项目 JSON 快照（claims/specSections/abstractText/figures/audit/versions/project 元数据）；导出前弹 dialog 要求口令 | 单测：同口令解密往返一致、信封纯 ASCII 无明文权利要求、错误口令拒绝、空口令拒绝；qa：浏览器真实导出解密 claims=10 |

- 勾选状态真实决定产物：未勾选文件不出现在 zip（单测「selection subset produces exactly selected files」+ qa 两个子集/全量轮次均验证）。
- 交付形态：全部选中文件打包为单个 `<项目名>-草案包.zip`（规避浏览器多下载拦截；zip 内文件名与 UI 列表一致）。qa 验证下载文件名 `一种基于三模通讯的共享热水表-草案包.zip`。

## 二、诚实性修复

| 项 | 修复前 | 修复后 | 证据 |
| --- | --- | --- | --- |
| 版本历史 note | `导出：N 个文件`（与实际不符） | `导出：<真实文件名列表>`（仅含实际落盘文件） | qa：history 页含「导出：专利申请文件草案合集.docx、权利要求书.docx、…」 |
| meta 时间戳 | 硬编码 `2026-08-06` | 当前日期（`new Date()` 本地时间） | qa 隐式覆盖（版本记录写入后展示） |
| UI 列表硬编码说明 | `10 条权利要求 / 294 字 / 图1-6` | 按项目实际数据派生：claims 数、摘要字数（`abstractText.trim().length`）、附图数（`图1-N`）、说明书章节数、审校特征/检查数；无数据时通用文案（「暂无权利要求数据」等） | qa：demo 显示 `10 条权利要求 / 177 字 / 图1-6` 且不含旧硬编码 `294 字`（demo 摘要实际 177 字）；live 显示 `2 条权利要求 / 图1-2`；单测覆盖空项目 fallback |

## 三、选型说明

1. **docx（权利要求书/说明书/摘要/合集）**：手写最小 OOXML（`[Content_Types].xml` + `_rels/.rels` + `word/document.xml`，fflate 打 zip），不引入 `docx` npm 库。理由：这是 Word/LibreOffice/Google Docs 可打开的最小合法结构；零新增依赖、确定性、node 可直测；避免再增约 120KB gzip。正文中文为 UTF-8 XML，无字体编码问题。
2. **PDF（附图/审阅报告）**：pdf-lib + 浏览器 canvas 整页栅格化（推荐路径的落地）。实测发现 pdf-lib 标准字体（WinAnsi）遇中文直接抛错而非回退，因此中文页（报告全部内容、附图标题）由 canvas 用系统字体绘制后作为 PNG 整页嵌入。node 单测注入 fake renderer，用 pdf-lib 直接解析验证 %PDF/页数/内容 spec。
3. **zip**：fflate（仓库已有依赖），`zipSync` 打包；单文件下载规避浏览器多下载拦截。
4. **patentpack**：WebCrypto（`globalThis.crypto.subtle`），PBKDF2-SHA-256 × 200,000 + AES-256-GCM，浏览器与 Node 同代码路径（node 单测直测）。

## 四、门禁与隐私语义（保持不变）

- `audit.errors > 0` 且勾选任一正式文件（除 patentpack 外）→ 拦截，文案与「去处理」路径不变（qa：demo 首轮被拦、确认来源后放行；walk-gate-fix 12/12 全绿）。
- 全部本机生成：无新增网络请求（导出路径仅 Blob/canvas/WebCrypto；桥接健康检查等既有请求与导出无关）。
- localStorage 旧数据只读兼容：导出不迁移、不改写旧结构；无 claims/figures/audit 的项目可导出（空文档 + 通用文案 + 「无附图」页）。

## 五、全量回归证据

| 命令 | 结果 |
| --- | --- |
| `node packages/export/tests/export-builders.test.mjs` | 44 通过 / 0 失败 |
| `node qa/export-files.mjs`（dev :5173） | 29/29 PASS |
| `EXPORT_BASE=http://localhost:4173/patent/ node qa/export-files.mjs`（vite preview 生产构建） | 29/29 PASS |
| `node qa/walk-gate-fix.mjs` | 12/12 PASS |
| `node qa/walk.mjs flow` / `tour` / `keys` | 退出码 0（flow 门禁拦截用例保留） |
| `node qa/baseline-check.mjs` | verdict: PASS（39 项） |
| `node qa/parsers-guard-tests.mjs` | 14 通过 / 0 失败 |
| `npm run typecheck -w @patent/web`（build 内 tsc --noEmit） | 0 错误 |
| `npm run build -w @patent/web` | 通过，5.07s |

## 六、bundle 体积

| 文件 | 旧 | 新 |
| --- | --- | --- |
| JS 合计 | `index-D8SjM_iC.js` 497,538 B raw / **155,122 B gzip** | `index-DDo8WyK1.js` 440,543 B raw / **182.57 kB gzip** + `index-BeuGjq2T.js` 510,348 B raw / **161.07 kB gzip**（合计 343.64 kB gzip，+约 189 kB，主要增量 = pdf-lib） |
| pdfjs（既有） | pdf.min 531,775 B / pdf.worker 1,312,450 B | 不变 |

说明：本次 `import("@patent/export")` 动态导入未在构建产物中形成独立异步 chunk（rollup 将共享模块提升为共享 chunk，两个 JS 文件均在首屏加载）；如需进一步减载，后续可用 `manualChunks` 或 Worker 化 pdf 生成再优化。

## 七、已知限制 / 风险

1. **PDF 文本不可选中**：审阅报告/附图 PDF 为整页图像（canvas 渲染），正文不可选中/检索。要获得可选中中文文本需引入 fontkit + 中文字体子集嵌入（预计 +1MB+ gzip），本切片不做，列为后续路径。
2. **PDF 字体回退**：canvas 使用系统字体栈（PingFang SC → Noto Sans CJK → sans-serif），不同系统渲染字形略有差异（不影响内容正确性）。
3. **brief 模式附图**：数据模型无用户图纸时，附图 PDF 生成占位页并如实提示「需上传图纸」，不伪造附图。
4. **单 zip 下载**：一次点击触发一个下载（规避多下载拦截）；zip 内为 7 个真实文件。浏览器若拦截下载，用户需允许该站点下载。
5. **口令安全**：口令仅用于导出加密，不落盘；PBKDF2 20 万次迭代在低端设备约数百毫秒。忘记口令无法找回（无服务器）。
6. **旧 bundle 对比口径**：旧 155KB gzip 为单文件；新值为两文件合计，口径已注明。
