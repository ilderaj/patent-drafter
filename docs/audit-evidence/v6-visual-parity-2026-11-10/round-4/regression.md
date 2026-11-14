# Round 4 功能回归

- 工作树：`.claude/worktrees/v6-prototype-alignment`
- 本地地址：`http://localhost:5391/patent/v6`；Playwright + Chrome，1440×900。
- 结果基于 round-4 最新代码。

## 基础门禁

| 项目 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | exit 0；`typecheck.log` |
| build | `npm run build` | exit 0；`build.log` |
| 全部场景 | `node qa/v6/runner.mjs --all` | exit 0；29 个场景目录，tests=637，pass=637，fail=0；本轮未出现 V6-09 Chrome 启动取消，因此没有重跑记录；`runner.log` |

## 浏览器全量流程

- 101 条记录，流程完成；0 blocked、0 skipped、0 pageerror、0 console error；7 个下载全部 valid。
- 建案：`f8cb1ae5-8aa8-4030-aa6f-714b2e168665`；目标：`5dd640d3-4613-5f66-8db0-310e1a6a84cc`。
- 上传解析完成态：parse row=1，进度条=0，状态=`已解析`。
- 五题保存与 reload 通过；测试生成采纳。
- 草稿：段落默认 `.para-read`；点击进入 `.para-edit`；8/8 段确认并 reload 保持；`.para-actions` opacity=1，AI tag 与「确认此段」常显；独立权利要求无下拉、无从属文字；从属权利要求显示只读「引用权利要求 1」，默认无下拉。
- preview/done：`.wiz-rail`=0；preview 四个 toolbar 按钮；风险 Sheet 15 项；`preview-risks-more` 显示「查看全部 6 条」。
- 完成页：未满足前置时 `done-blockers`=1、`done-files`=0、无「还差 0 步」；刷新状态不在主视图（位于折叠的导出前置条件详情内）；批准后 `done-files` 渲染，文件行含 KB 和中文「可下载」，SHA-256 只在每行「技术详情」内。
- 测试输出提示：preview=1；done 1/0；专业交付 1/0。
- 主视图技术标识：preview、done、draft 均无 UUID、SnapshotRef、sha256 或英文枚举。
- 侧栏无「未开放」；组织勾发明人保存被拒文案出现，按预期 PASS。

## 失败项

| 检查 | 结果 | 事实 |
|---|---|---|
| check 主视图技术标识 | FAIL | 检查页底部可见文案「检查结果绑定到修订 e4561bc0-4519-4a99-bd8b-2a6e4bb56cb6 和规则包 …」包含完整修订 UUID；SnapshotRef、sha256、英文枚举均为 0。 |

## 证据

- `acceptance-evidence/browser-acceptance.json` 与截图。
- `regression.json`、`regression.log`。
