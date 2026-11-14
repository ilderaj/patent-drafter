# V6 原型对齐：浏览器验收结果（2026-11-10，最终 run-17）

运行：worktree `.claude/worktrees/v6-prototype-alignment`，最终代码版本取 run-17。
预检：`npm run typecheck` exit 0；`npm run build -w @patent/web` exit 0（`evidence/typecheck.log`、`build.log`）。
浏览器：1440×900 + 390×844，Chrome headless；独立 context；未读写 IndexedDB、未注入存储。
最终证据：`evidence/browser-run-17/`（124 记录，0 fail，0 blocked，0 skipped，0 pageerror，0 console.error，7 downloads）。

## 本轮新增断言（测试输出标记写入文件）

- 3 个 DOCX 的 `word/document.xml` 首段均精确为「测试输出，仅用于验证流程，不能作为正式申请材料」（`firstParagraphTestOutputMarker=true`），正文也含标记。
- PDF metadata 经 pypdf 读取：`/Title`、`/Subject`、`/Keywords` 三项均为「测试输出，仅用于验证流程，不能作为正式申请材料」（`pdfMetadataTestOutputMarker=true`）。raw 解析因对象流压缩找不到，脚本已改为 pypdf 优先、raw 回退。
- 导出清单 `testOutput=true`；7 个文件名/正文/清单标记汇总为 filename=true、body=true、firstParagraph=true、pdfMetadata=true、manifest=true、pageNotice=true。

## 逐项结果（22 项无回退）

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 无文档入口 | pass | no-doc-* |
| 上传入口（保存+解析） | pass | upload-file-saved / upload-parsed / upload-questions-complete |
| 五题逐题保存+reload | pass | *-question-*-saved / *-reload |
| 姓名选人/按名称选路线/建目标 | pass | *-route-selected / *-target-created |
| stub 显著标记 | pass | generation-test-output；data-test-output=true |
| 测试修订采纳 | pass | generation-adopted |
| 标记：编辑/标题/正文/恢复 | pass | test-marker-after-* |
| 标记：预览 | pass | test-marker-preview / preview-after-reload |
| 标记：下载 | pass | filename/body/firstParagraph/pdfMetadata/manifest/pageNotice 均 true |
| 合成附图首版绑定 | pass | synthetic-figure-bound / reload |
| 合成事实确认 | pass | synthetic-fact-reload |
| 检查+风险确认持久 | pass | 三轮 4/4；检查时间 reload 前后一致 |
| 修订后旧确认失效 | pass | old-ack-invalidated-result ×2 |
| 自助通读 | pass | self-read-confirmed / reload |
| 专业逐段确认 | pass | 8/8，reload 后 8/8 |
| 批准门禁放行+即时刷新 | pass | approval-after exportAllowed=true；approval-gate-open |
| 真实下载与结构 | pass | 7/7 |
| 同页草稿+审阅 | pass | professional-same-page |
| 全局动态 | pass | 8→13→46 |
| Native 明暗/跟随系统 | pass | native light/dark/system ×2 |
| 390px | pass | 八页均 documentWidth=390 |
| pageerror/console.error | pass | 0 / 0 |

## 下载文件（evidence/browser-run-17）

| 文件 | 结构 | 标记 |
| --- | --- | --- |
| 测试输出-权利要求书.docx | OOXML，首段+正文 | 文件名+首段+正文 |
| 测试输出-说明书.docx | 同上 | 文件名+首段+正文 |
| 测试输出-说明书摘要.docx | 同上 | 文件名+首段+正文 |
| synthetic-acceptance-figure.png | PNG 签名+IHDR | 合成测试输入 |
| 测试输出-提交检查清单.pdf | %PDF-；Title/Subject/Keywords | 文件名+PDF metadata |
| 项目备份.patentpack | 加密信封 | 清单 |
| 导出清单.json | export.v1，testOutput=true | 清单 |

- sha256/大小在 JSON `downloads[]`；CN XML 不可用仅记录 FORMAT_UNAVAILABLE，未当已递交。

## 备注

- run-16 的 PDF metadata 失败为脚本 raw 解析无法读取压缩对象流，已用 pypdf 修正并重跑；产品 metadata 实际存在。最终以 run-17 为准。
- 未修改产品代码；Vite 由本人启动并在结束后停止（5391 closed）。
