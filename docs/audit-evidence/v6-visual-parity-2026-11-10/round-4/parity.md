# V6 Prototype 视觉还原度测量 · Round 4

## 验收表

| 验收项 | 结果 | 测量 |
|---|---|---|
| toolbar 是否 22/22 | 是 | 实现 22/22 页有 `.toolbar`；原型 22/22 |
| 向导左栏 5/5 | 是 | 实现 5/5 个向导页有 `.wiz-rail`（upload、parse、questions、route、generate） |
| preview/done 无 .wiz-rail | 是 | preview rail=`False`；done rail=`False` |
| preview 是否有 .doc 纸面 | 是 | 实现 preview `.doc`=`{"width":880,"backgroundColor":"rgb(255, 255, 255)","borderRadius":"0px","padding":"30px 0px 40px"}` |
| draft 是否有 .doc 纸面 | 是 | 实现 draft `.doc`=`{"width":539.7,"backgroundColor":"rgb(255, 255, 255)","borderRadius":"10px","padding":"28px 0px 40px"}` |
| check 是否有 .statrow | 是 | 实现 check `.statrow` 存在=是 |
| 正文字号 | 原型 body `13px` / 实现 body `14px` | 实现 `.v6-shell` 为 `13px`；line-height 原型 `18.98px` / 实现 `21px` |
| 主按钮圆角 | 原型 `8px` / 实现 `6px` | 取样页：原型 `upload` / 实现 `upload`；高度 原型 36px / 实现 36px |
| 次按钮圆角 | 原型 `5px` / 实现 `6px` | 取样页：原型 `start` / 实现 `start`；边框 原型 `1px solid rgb(188, 188, 188)` / 实现 `1px solid rgb(188, 188, 188)` |
| 侧栏宽度 | 原型 232px / 实现 232px | 侧栏背景 原型 `rgba(238, 238, 238, 0.86)` / 实现 `rgba(238, 238, 238, 0.86)` |

**各页内容 pane 宽度与原型差**

| 页面 | 原型 pane maxWidth | 实现 pane maxWidth | 差 |
|---|---|---|---:|
| `start` | `980px` | `980px` | 相同 |
| `upload` | `760px` | `760px` | 相同 |
| `parse` | `760px` | `760px` | 相同 |
| `questions` | `760px` | `760px` | 相同 |
| `route` | `760px` | `760px` | 相同 |
| `generate` | `760px` | `760px` | 相同 |
| `preview` | `1120px` | `1120px` | 相同 |
| `done` | `720px` | `720px` | 相同 |
| `inbox` | `none` | `none` | 相同 |
| `matters` | `980px` | `980px` | 相同 |
| `matter:overview` | `980px` | `980px` | 相同 |
| `matter:sources` | `980px` | `980px` | 相同 |
| `matter:facts` | `980px` | `980px` | 相同 |
| `matter:draft` | `980px` | `760px` | 不同 |
| `matter:check` | `980px` | `980px` | 相同 |
| `matter:deliver` | `980px` | `980px` | 相同 |
| `activity` | `980px` | `980px` | 相同 |
| `ai` | `980px` | `980px` | 相同 |
| `settings` | `980px` | `720px` | 不同 |
| `services` | `980px` | `980px` | 相同 |
| `pricing` | `980px` | `980px` | 相同 |
| `billing` | `980px` | `980px` | 相同 |

**每页仍存在的结构差异（浅色；深色同）**

| 页面 | 结构差异 |
|---|---|
| `start` | 无 |
| `upload` | 实现有、原型无：卡片区；实现有、原型无：文件或下载列表 |
| `parse` | 原型有、实现无：进度显示 |
| `questions` | 无 |
| `route` | 无 |
| `generate` | 无 |
| `preview` | 无 |
| `done` | 无 |
| `inbox` | 无 |
| `matters` | 无 |
| `matter:overview` | 无 |
| `matter:sources` | 实现有、原型无：文件或下载列表 |
| `matter:facts` | 无 |
| `matter:draft` | 无 |
| `matter:check` | 无 |
| `matter:deliver` | 实现有、原型无：文件或下载列表 |
| `activity` | 原型有、实现无：卡片区 |
| `ai` | 原型有、实现无：卡片区 |
| `settings` | 实现有、原型无：全局侧栏；实现有、原型无：全局导航 |
| `services` | 实现有、原型无：全局侧栏；实现有、原型无：全局导航 |
| `pricing` | 实现有、原型无：全局侧栏；实现有、原型无：全局导航 |
| `billing` | 实现有、原型无：全局侧栏；实现有、原型无：全局导航 |

## 小图（浅色）

| 页面 | 文件 | 大小 | 质量 |
|---|---|---:|---:|
| `preview` | [small-pair-preview.jpg](small-pair-preview.jpg) | 40322 B | q50 |
| `done` | [small-pair-done.jpg](small-pair-done.jpg) | 24487 B | q50 |
| `matter:draft` | [small-pair-matter-draft.jpg](small-pair-matter-draft.jpg) | 36746 B | q50 |
| `upload` | [small-pair-upload.jpg](small-pair-upload.jpg) | 24859 B | q50 |
| `matter:check` | [small-pair-matter-check.jpg](small-pair-matter-check.jpg) | 35754 B | q50 |
| `questions` | [small-pair-questions.jpg](small-pair-questions.jpg) | 20013 B | q50 |
| `preview`（实现侧首屏） | [small-impl-preview.jpg](small-impl-preview.jpg) | 46218 B | q50 |

## 全页截图、sticky toolbar 与重叠检查

### `preview`
- 实现侧 full-page：[implementation-preview-light-full.png](implementation-preview-light-full.png)
- 未滚动时选中块的相交对：0 对。
- 滚动 600px 后：toolbar=`{"x":0,"y":0,"width":1440,"height":52}`，内容区=`{"x":185,"y":-34.7,"width":880,"height":786.3}`，纵向重叠 52px。

### `done`
- 实现侧 full-page：[implementation-done-light-full.png](implementation-done-light-full.png)
- 未滚动时选中块的相交对：0 对。
- 滚动 600px 后：toolbar=`{"x":0,"y":0,"width":1440,"height":52}`，内容区=`{"x":384,"y":-211.8,"width":672,"height":566.8}`，纵向重叠 52px。

### `matter:draft`
- 实现侧 full-page：[implementation-matter-draft-light-full.png](implementation-matter-draft-light-full.png)
- 未滚动时选中块的相交对：0 对。
- 滚动 600px 后：toolbar=`{"x":232,"y":0,"width":1208,"height":52}`，内容区=`{"x":346,"y":-288.9,"width":571.7,"height":1332}`，纵向重叠 52px。


## 采集说明

- 原型：`/Users/jared/Personal Projects/Patent/docs/design/patent-saas-v6/prototype/index.html`；实现：`http://localhost:5391/patent/v6`，1440×900。
- 页面：22 页 × 浅/深 = 44 张对比图；左原型、右实现，JPEG q60，1800px 宽。
- 采集前通过 UI 建案、上传 fixture、五题、路线/目标、测试生成采纳、合成附图。
- 实现为最新代码：`delivery-test-output-label` 已移除，完成/交付页只保留 `done-test-output-label`。
- 假浏览器栏、macOS 菜单栏和窗口控件不计入结构差异。
- 状态差异：原型 upload 直达时没有文件，实现已有 1 个已保存 fixture；因此 upload 的文件行、进度条和卡片差异部分是数据状态，不是布局缺失。
- 状态差异：原型直达 settings/services/pricing/billing 时 persona 为 guest，侧栏按原逻辑隐藏；实现始终显示全局侧栏。
- 状态差异：实现使用本地测试生成修订，preview/done/deliver 顶部有测试输出提示；原型内容不含该提示。


## 页面测量

### `start`

- 浅色合成图：[pair-start-light.jpg](pair-start-light.jpg)
- 深色合成图：[pair-start-dark.jpg](pair-start-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
- dark：本次采集的结构项存在性相同。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `34px` | `34px` | 相同 | `34px` | `34px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | — | 均无 | — | — | 均无 |
| 主按钮圆角 | — | — | 均无 | — | — | 均无 |
| 主按钮字号 | — | — | 均无 | — | — | 均无 |
| 主按钮内边距 | — | — | 均无 | — | — | 均无 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `12px` | `12px` | 相同 | `12px` | `12px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `18px` | `18px` | 相同 | `18px` | `18px` | 相同 |
| 侧栏宽度 | — | — | 均无 | — | — | 均无 |
| 侧栏背景 | — | — | 均无 | — | — | 均无 |
| 侧栏条目高度 | — | — | 均无 | — | — | 均无 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 230px | 230px | 相同 | 230px | 230px | 相同 |
| 内容区右留白 | 230px | 230px | 相同 | 230px | 230px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `upload`

- 浅色合成图：[pair-upload-light.jpg](pair-upload-light.jpg)
- 深色合成图：[pair-upload-dark.jpg](pair-upload-dark.jpg)

**结构差异**

- light：实现有、原型无：卡片区；实现有、原型无：文件或下载列表
  - 可见标题：原型 `['新建申请', '先把资料放进来']`；实现 `['新建申请', '先把资料放进来', '解析材料']`。
- dark：实现有、原型无：卡片区；实现有、原型无：文件或下载列表
  - 可见标题：原型 `['新建申请', '先把资料放进来']`；实现 `['新建申请', '先把资料放进来', '解析材料']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `24px` | `24px` | 相同 | `24px` | `24px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 36px | 36px | 相同 | 36px | 36px | 相同 |
| 主按钮圆角 | `8px` | `6px` | 不同 | `8px` | `6px` | 不同 |
| 主按钮字号 | `14px` | `14px` | 相同 | `14px` | `14px` | 相同 |
| 主按钮内边距 | `0px 18px` | `4px 11px` | 不同 | `0px 18px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `0px none rgb(10, 100, 214)` | 不同 | `1px solid rgb(82, 82, 82)` | `0px none rgb(76, 155, 245)` | 不同 |
| 次按钮圆角 | `5px` | `0px` | 不同 | `5px` | `0px` | 不同 |
| 卡片边框 | — | `1px solid rgb(218, 218, 218)` | 一侧缺项 | — | `1px solid rgb(56, 56, 56)` | 一侧缺项 |
| 卡片圆角 | — | `10px` | 一侧缺项 | — | `10px` | 一侧缺项 |
| 卡片阴影 | — | `none` | 一侧缺项 | — | `none` | 一侧缺项 |
| 卡片内边距 | — | `16px` | 一侧缺项 | — | `16px` | 一侧缺项 |
| 侧栏宽度 | — | — | 均无 | — | — | 均无 |
| 侧栏背景 | — | — | 均无 | — | — | 均无 |
| 侧栏条目高度 | — | — | 均无 | — | — | 均无 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `760px` | `760px` | 相同 | `760px` | `760px` | 相同 |
| 内容区左留白 | 452px | 452px | 相同 | 452px | 452px | 相同 |
| 内容区右留白 | 228px | 228px | 相同 | 228px | 228px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `parse`

- 浅色合成图：[pair-parse-light.jpg](pair-parse-light.jpg)
- 深色合成图：[pair-parse-dark.jpg](pair-parse-dark.jpg)

**结构差异**

- light：原型有、实现无：进度显示
  - 可见标题：原型 `['读取资料', '资料读完了']`；实现 `['新建申请', '先把资料放进来', '解析材料']`。
- dark：原型有、实现无：进度显示
  - 可见标题：原型 `['读取资料', '资料读完了']`；实现 `['新建申请', '先把资料放进来', '解析材料']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `24px` | `24px` | 相同 | `24px` | `24px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 36px | 36px | 相同 | 36px | 36px | 相同 |
| 主按钮圆角 | `8px` | `6px` | 不同 | `8px` | `6px` | 不同 |
| 主按钮字号 | `14px` | `14px` | 相同 | `14px` | `14px` | 相同 |
| 主按钮内边距 | `0px 18px` | `4px 11px` | 不同 | `0px 18px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `0px none rgb(10, 100, 214)` | 不同 | `1px solid rgb(82, 82, 82)` | `0px none rgb(76, 155, 245)` | 不同 |
| 次按钮圆角 | `5px` | `0px` | 不同 | `5px` | `0px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `16px` | +16px | `0px` | `16px` | +16px |
| 侧栏宽度 | — | — | 均无 | — | — | 均无 |
| 侧栏背景 | — | — | 均无 | — | — | 均无 |
| 侧栏条目高度 | — | — | 均无 | — | — | 均无 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `760px` | `760px` | 相同 | `760px` | `760px` | 相同 |
| 内容区左留白 | 452px | 452px | 相同 | 452px | 452px | 相同 |
| 内容区右留白 | 228px | 228px | 相同 | 228px | 228px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `questions`

- 浅色合成图：[pair-questions-light.jpg](pair-questions-light.jpg)
- 深色合成图：[pair-questions-dark.jpg](pair-questions-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
  - 可见标题：原型 `['补充信息', '这项技术解决了什么问题？']`；实现 `['补充信息', '现在做到什么程度？']`。
- dark：本次采集的结构项存在性相同。
  - 可见标题：原型 `['补充信息', '这项技术解决了什么问题？']`；实现 `['补充信息', '现在做到什么程度？']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `20px` | `20px` | 相同 | `20px` | `20px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 36px | 36px | 相同 | 36px | 36px | 相同 |
| 主按钮圆角 | `8px` | `6px` | 不同 | `8px` | `6px` | 不同 |
| 主按钮字号 | `14px` | `14px` | 相同 | `14px` | `14px` | 相同 |
| 主按钮内边距 | `0px 18px` | `4px 11px` | 不同 | `0px 18px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | — | — | 均无 | — | — | 均无 |
| 卡片圆角 | — | — | 均无 | — | — | 均无 |
| 卡片阴影 | — | — | 均无 | — | — | 均无 |
| 卡片内边距 | — | — | 均无 | — | — | 均无 |
| 侧栏宽度 | — | — | 均无 | — | — | 均无 |
| 侧栏背景 | — | — | 均无 | — | — | 均无 |
| 侧栏条目高度 | — | — | 均无 | — | — | 均无 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `760px` | `760px` | 相同 | `760px` | `760px` | 相同 |
| 内容区左留白 | 452px | 452px | 相同 | 452px | 452px | 相同 |
| 内容区右留白 | 228px | 228px | 相同 | 228px | 228px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | 88px | — | 一侧缺项 | 88px | — | 一侧缺项 |
| 输入框圆角 | `6px` | — | 一侧缺项 | `6px` | — | 一侧缺项 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `route`

- 浅色合成图：[pair-route-light.jpg](pair-route-light.jpg)
- 深色合成图：[pair-route-dark.jpg](pair-route-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
- dark：本次采集的结构项存在性相同。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `24px` | `24px` | 相同 | `24px` | `24px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 36px | 36px | 相同 | 36px | 36px | 相同 |
| 主按钮圆角 | `8px` | `6px` | 不同 | `8px` | `6px` | 不同 |
| 主按钮字号 | `14px` | `14px` | 相同 | `14px` | `14px` | 相同 |
| 主按钮内边距 | `0px 18px` | `4px 11px` | 不同 | `0px 18px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(10, 100, 214)` | `1px solid rgb(10, 100, 214)` | 相同 | `1px solid rgb(76, 155, 245)` | `1px solid rgb(76, 155, 245)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `rgb(225, 236, 251) 0px 0px 0px 2px` | `rgb(225, 236, 251) 0px 0px 0px 2px` | 相同 | `rgb(27, 47, 72) 0px 0px 0px 2px` | `rgb(27, 47, 72) 0px 0px 0px 2px` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | — | — | 均无 | — | — | 均无 |
| 侧栏背景 | — | — | 均无 | — | — | 均无 |
| 侧栏条目高度 | — | — | 均无 | — | — | 均无 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `760px` | `760px` | 相同 | `760px` | `760px` | 相同 |
| 内容区左留白 | 452px | 452px | 相同 | 452px | 452px | 相同 |
| 内容区右留白 | 228px | 228px | 相同 | 228px | 228px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `generate`

- 浅色合成图：[pair-generate-light.jpg](pair-generate-light.jpg)
- 深色合成图：[pair-generate-dark.jpg](pair-generate-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
  - 可见标题：原型 `['生成材料', '正在写申请材料']`；实现 `['生成材料', '材料写完了']`。
- dark：本次采集的结构项存在性相同。
  - 可见标题：原型 `['生成材料', '正在写申请材料']`；实现 `['生成材料', '材料写完了']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `24px` | `24px` | 相同 | `24px` | `24px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | 36px | 一侧缺项 | — | 36px | 一侧缺项 |
| 主按钮圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 主按钮字号 | — | `14px` | 一侧缺项 | — | `14px` | 一侧缺项 |
| 主按钮内边距 | — | `4px 11px` | 一侧缺项 | — | `4px 11px` | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | — | `1px solid rgb(218, 218, 218)` | 一侧缺项 | — | `1px solid rgb(56, 56, 56)` | 一侧缺项 |
| 卡片圆角 | — | `8px` | 一侧缺项 | — | `8px` | 一侧缺项 |
| 卡片阴影 | — | `none` | 一侧缺项 | — | `none` | 一侧缺项 |
| 卡片内边距 | — | `12px 16px` | 一侧缺项 | — | `12px 16px` | 一侧缺项 |
| 侧栏宽度 | — | — | 均无 | — | — | 均无 |
| 侧栏背景 | — | — | 均无 | — | — | 均无 |
| 侧栏条目高度 | — | — | 均无 | — | — | 均无 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `760px` | `760px` | 相同 | `760px` | `760px` | 相同 |
| 内容区左留白 | 452px | 452px | 相同 | 452px | 452px | 相同 |
| 内容区右留白 | 228px | 228px | 相同 | 228px | 228px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `preview`

- 浅色合成图：[pair-preview-light.jpg](pair-preview-light.jpg)
- 深色合成图：[pair-preview-dark.jpg](pair-preview-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
- dark：本次采集的结构项存在性相同。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `18px` | `18px` | 相同 | `18px` | `18px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮字号 | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 侧栏宽度 | — | — | 均无 | — | — | 均无 |
| 侧栏背景 | — | — | 均无 | — | — | 均无 |
| 侧栏条目高度 | — | — | 均无 | — | — | 均无 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `1120px` | `1120px` | 相同 | `1120px` | `1120px` | 相同 |
| 内容区左留白 | 160px | 160px | 相同 | 160px | 160px | 相同 |
| 内容区右留白 | 160px | 160px | 相同 | 160px | 160px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | 928px | 880px | -48px | 928px | 880px | -48px |
| 纸面背景 | `rgb(255, 255, 255)` | `rgb(255, 255, 255)` | 相同 | `rgb(40, 40, 40)` | `rgb(40, 40, 40)` | 相同 |
| 纸面圆角 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |

### `done`

- 浅色合成图：[pair-done-light.jpg](pair-done-light.jpg)
- 深色合成图：[pair-done-dark.jpg](pair-done-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
  - 可见标题：原型 `['材料已生成', '可以下载了']`；实现 `['材料已生成', '可以下载了', '', '']`。
- dark：本次采集的结构项存在性相同。
  - 可见标题：原型 `['材料已生成', '可以下载了']`；实现 `['材料已生成', '可以下载了', '', '']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `22px` | `22px` | 相同 | `22px` | `22px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | 28px | 一侧缺项 | — | 28px | 一侧缺项 |
| 主按钮圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 主按钮字号 | — | `13px` | 一侧缺项 | — | `13px` | 一侧缺项 |
| 主按钮内边距 | — | `4px 11px` | 一侧缺项 | — | `4px 11px` | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `16px` | +16px | `0px` | `16px` | +16px |
| 侧栏宽度 | — | — | 均无 | — | — | 均无 |
| 侧栏背景 | — | — | 均无 | — | — | 均无 |
| 侧栏条目高度 | — | — | 均无 | — | — | 均无 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `720px` | `720px` | 相同 | `720px` | `720px` | 相同 |
| 内容区左留白 | 360px | 360px | 相同 | 360px | 360px | 相同 |
| 内容区右留白 | 360px | 360px | 相同 | 360px | 360px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `inbox`

- 浅色合成图：[pair-inbox-light.jpg](pair-inbox-light.jpg)
- 深色合成图：[pair-inbox-dark.jpg](pair-inbox-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
  - 可见标题：原型 `['收件箱', '公开历史待人工核实']`；实现 `['收件箱', '运行或复核检查']`。
- dark：本次采集的结构项存在性相同。
  - 可见标题：原型 `['收件箱', '公开历史待人工核实']`；实现 `['收件箱', '运行或复核检查']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `15px` | 相同 | `15px` | `15px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | — | — | 均无 | — | — | 均无 |
| 卡片圆角 | — | — | 均无 | — | — | 均无 |
| 卡片阴影 | — | — | 均无 | — | — | 均无 |
| 卡片内边距 | — | — | 均无 | — | — | 均无 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 内容区左留白 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 内容区右留白 | 0px | 0px | 相同 | 0px | 0px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `matters`

- 浅色合成图：[pair-matters-light.jpg](pair-matters-light.jpg)
- 深色合成图：[pair-matters-dark.jpg](pair-matters-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
- dark：本次采集的结构项存在性相同。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `15px` | 相同 | `15px` | `15px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 346px | 346px | 相同 | 346px | 346px | 相同 |
| 内容区右留白 | 114px | 114px | 相同 | 114px | 114px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `matter:overview`

- 浅色合成图：[pair-matter-overview-light.jpg](pair-matter-overview-light.jpg)
- 深色合成图：[pair-matter-overview-dark.jpg](pair-matter-overview-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯', '一种防倾倒的宠物饮水杯']`；实现 `['未命名案件', '未命名案件']`。
- dark：本次采集的结构项存在性相同。
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯', '一种防倾倒的宠物饮水杯']`；实现 `['未命名案件', '未命名案件']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `15px` | 相同 | `15px` | `15px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `16px` | +16px | `0px` | `16px` | +16px |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 346px | 346px | 相同 | 346px | 346px | 相同 |
| 内容区右留白 | 114px | 114px | 相同 | 114px | 114px | 相同 |
| 表格行高 | 55.3px | 74.8px | +19.5px | 55.3px | 74.8px | +19.5px |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `matter:sources`

- 浅色合成图：[pair-matter-sources-light.jpg](pair-matter-sources-light.jpg)
- 深色合成图：[pair-matter-sources-dark.jpg](pair-matter-sources-dark.jpg)

**结构差异**

- light：实现有、原型无：文件或下载列表
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯']`；实现 `['未命名案件', '上传材料', '解析材料', '附图', '当前图集']`。
- dark：实现有、原型无：文件或下载列表
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯']`；实现 `['未命名案件', '上传材料', '解析材料', '附图', '当前图集']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `16px` | +16px | `0px` | `16px` | +16px |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 346px | 346px | 相同 | 346px | 346px | 相同 |
| 内容区右留白 | 114px | 114px | 相同 | 114px | 114px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `matter:facts`

- 浅色合成图：[pair-matter-facts-light.jpg](pair-matter-facts-light.jpg)
- 深色合成图：[pair-matter-facts-dark.jpg](pair-matter-facts-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯']`；实现 `['未命名案件', '五题与事实', '人员', '事实', '冲突']`。
- dark：本次采集的结构项存在性相同。
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯']`；实现 `['未命名案件', '五题与事实', '人员', '事实', '冲突']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `15px` | 相同 | `15px` | `15px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 346px | 346px | 相同 | 346px | 346px | 相同 |
| 内容区右留白 | 114px | 114px | 相同 | 114px | 114px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | 35px | 一侧缺项 | — | 35px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `matter:draft`

- 浅色合成图：[pair-matter-draft-light.jpg](pair-matter-draft-light.jpg)
- 深色合成图：[pair-matter-draft-dark.jpg](pair-matter-draft-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯', '草稿与要素支持']`；实现 `['未命名案件', '草稿与要素支持', '']`。
- dark：本次采集的结构项存在性相同。
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯', '草稿与要素支持']`；实现 `['未命名案件', '草稿与要素支持', '']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `24px` | +9px | `15px` | `24px` | +9px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `0px none rgb(29, 29, 31)` | 不同 | `1px solid rgb(56, 56, 56)` | `0px none rgb(236, 236, 236)` | 不同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `760px` | -220px | `980px` | `760px` | -220px |
| 内容区左留白 | 346px | 347px | +1px | 346px | 347px | +1px |
| 内容区右留白 | 114px | 333px | +219px | 114px | 333px | +219px |
| 表格行高 | 27px | 27.5px | +0.5px | 27px | 27.5px | +0.5px |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | 29.6px | 一侧缺项 | — | 29.6px | 一侧缺项 |
| 输入框圆角 | — | `0px` | 一侧缺项 | — | `0px` | 一侧缺项 |
| 纸面宽度 | 482px | 539.7px | +57.7px | 482px | 539.7px | +57.7px |
| 纸面背景 | `rgb(255, 255, 255)` | `rgb(255, 255, 255)` | 相同 | `rgb(40, 40, 40)` | `rgb(40, 40, 40)` | 相同 |
| 纸面圆角 | `0px` | `10px` | 不同 | `0px` | `10px` | 不同 |

### `matter:check`

- 浅色合成图：[pair-matter-check-light.jpg](pair-matter-check-light.jpg)
- 深色合成图：[pair-matter-check-dark.jpg](pair-matter-check-dark.jpg)

**结构差异**

- light：本次采集的结构项存在性相同。
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯', '检查与人工核实']`；实现 `['未命名案件', '检查与人工核实']`。
- dark：本次采集的结构项存在性相同。
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯', '检查与人工核实']`；实现 `['未命名案件', '检查与人工核实']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `15px` | 相同 | `15px` | `15px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `0px` | -16px | `16px` | `0px` | -16px |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 346px | 346px | 相同 | 346px | 346px | 相同 |
| 内容区右留白 | 114px | 114px | 相同 | 114px | 114px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `matter:deliver`

- 浅色合成图：[pair-matter-deliver-light.jpg](pair-matter-deliver-light.jpg)
- 深色合成图：[pair-matter-deliver-dark.jpg](pair-matter-deliver-dark.jpg)

**结构差异**

- light：实现有、原型无：文件或下载列表
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯', '交付与内部批准']`；实现 `['未命名案件', '批准门禁', '导出门禁', '材料已生成']`。
- dark：实现有、原型无：文件或下载列表
  - 可见标题：原型 `['一种防倾倒的宠物饮水杯', '交付与内部批准']`；实现 `['未命名案件', '批准门禁', '导出门禁', '材料已生成']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `22px` | +7px | `15px` | `22px` | +7px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `16px` | +16px | `0px` | `16px` | +16px |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 346px | 346px | 相同 | 346px | 346px | 相同 |
| 内容区右留白 | 114px | 114px | 相同 | 114px | 114px | 相同 |
| 表格行高 | 38px | 38px | 相同 | 38px | 38px | 相同 |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `activity`

- 浅色合成图：[pair-activity-light.jpg](pair-activity-light.jpg)
- 深色合成图：[pair-activity-dark.jpg](pair-activity-dark.jpg)

**结构差异**

- light：原型有、实现无：卡片区
  - 可见标题：原型 `['动态']`；实现 `['动态', '案件动态']`。
- dark：原型有、实现无：卡片区
  - 可见标题：原型 `['动态']`；实现 `['动态', '案件动态']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `15px` | 相同 | `15px` | `15px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | — | 均无 | — | — | 均无 |
| 主按钮圆角 | — | — | 均无 | — | — | 均无 |
| 主按钮字号 | — | — | 均无 | — | — | 均无 |
| 主按钮内边距 | — | — | 均无 | — | — | 均无 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | — | 一侧缺项 | `1px solid rgb(56, 56, 56)` | — | 一侧缺项 |
| 卡片圆角 | `10px` | — | 一侧缺项 | `10px` | — | 一侧缺项 |
| 卡片阴影 | `none` | — | 一侧缺项 | `none` | — | 一侧缺项 |
| 卡片内边距 | `16px` | — | 一侧缺项 | `16px` | — | 一侧缺项 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 346px | 346px | 相同 | 346px | 346px | 相同 |
| 内容区右留白 | 114px | 114px | 相同 | 114px | 114px | 相同 |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `ai`

- 浅色合成图：[pair-ai-light.jpg](pair-ai-light.jpg)
- 深色合成图：[pair-ai-dark.jpg](pair-ai-dark.jpg)

**结构差异**

- light：原型有、实现无：卡片区
  - 可见标题：原型 `['AI 与数据', '处理方式', '连接自带密钥']`；实现 `['AI 与数据', '将外发的材料', '处理方式', '处理方与授权', '外发授权记录', '模型调用记录']`。
- dark：原型有、实现无：卡片区
  - 可见标题：原型 `['AI 与数据', '处理方式', '连接自带密钥']`；实现 `['AI 与数据', '将外发的材料', '处理方式', '处理方与授权', '外发授权记录', '模型调用记录']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `15px` | 相同 | `15px` | `15px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | — | 均无 | — | — | 均无 |
| 主按钮圆角 | — | — | 均无 | — | — | 均无 |
| 主按钮字号 | — | — | 均无 | — | — | 均无 |
| 主按钮内边距 | — | — | 均无 | — | — | 均无 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | — | 一侧缺项 | `1px solid rgb(56, 56, 56)` | — | 一侧缺项 |
| 卡片圆角 | `10px` | — | 一侧缺项 | `10px` | — | 一侧缺项 |
| 卡片阴影 | `none` | — | 一侧缺项 | `none` | — | 一侧缺项 |
| 卡片内边距 | `16px` | — | 一侧缺项 | `16px` | — | 一侧缺项 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgba(238, 238, 238, 0.86)` | 相同 | `rgba(38, 38, 38, 0.86)` | `rgba(38, 38, 38, 0.86)` | 相同 |
| 侧栏条目高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 346px | 346px | 相同 | 346px | 346px | 相同 |
| 内容区右留白 | 114px | 114px | 相同 | 114px | 114px | 相同 |
| 表格行高 | 37.3px | 32px | -5.3px | 37.3px | 32px | -5.3px |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | 33px | 31px | -2px | 33px | 31px | -2px |
| 输入框圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `settings`

- 浅色合成图：[pair-settings-light.jpg](pair-settings-light.jpg)
- 深色合成图：[pair-settings-dark.jpg](pair-settings-dark.jpg)

**结构差异**

- light：实现有、原型无：全局侧栏；实现有、原型无：全局导航
- dark：实现有、原型无：全局侧栏；实现有、原型无：全局导航

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `15px` | 相同 | `15px` | `15px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | 28px | 一侧缺项 | — | 28px | 一侧缺项 |
| 主按钮圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 主按钮字号 | — | `13px` | 一侧缺项 | — | `13px` | 一侧缺项 |
| 主按钮内边距 | — | `4px 11px` | 一侧缺项 | — | `4px 11px` | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 侧栏宽度 | — | 232px | 一侧缺项 | — | 232px | 一侧缺项 |
| 侧栏背景 | — | `rgba(238, 238, 238, 0.86)` | 一侧缺项 | — | `rgba(38, 38, 38, 0.86)` | 一侧缺项 |
| 侧栏条目高度 | — | 28px | 一侧缺项 | — | 28px | 一侧缺项 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `720px` | -260px | `980px` | `720px` | -260px |
| 内容区左留白 | 230px | 476px | +246px | 230px | 476px | +246px |
| 内容区右留白 | 230px | 244px | +14px | 230px | 244px | +14px |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `services`

- 浅色合成图：[pair-services-light.jpg](pair-services-light.jpg)
- 深色合成图：[pair-services-dark.jpg](pair-services-dark.jpg)

**结构差异**

- light：实现有、原型无：全局侧栏；实现有、原型无：全局导航
- dark：实现有、原型无：全局侧栏；实现有、原型无：全局导航

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `24px` | `24px` | 相同 | `24px` | `24px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | — | 一侧缺项 | 28px | — | 一侧缺项 |
| 主按钮圆角 | `6px` | — | 一侧缺项 | `6px` | — | 一侧缺项 |
| 主按钮字号 | `13px` | — | 一侧缺项 | `13px` | — | 一侧缺项 |
| 主按钮内边距 | `0px 11px` | — | 一侧缺项 | `0px 11px` | — | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | — | 一侧缺项 | `1px solid rgb(82, 82, 82)` | — | 一侧缺项 |
| 次按钮圆角 | `5px` | — | 一侧缺项 | `5px` | — | 一侧缺项 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `11px` | `11px` | 相同 | `11px` | `11px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | — | 232px | 一侧缺项 | — | 232px | 一侧缺项 |
| 侧栏背景 | — | `rgba(238, 238, 238, 0.86)` | 一侧缺项 | — | `rgba(38, 38, 38, 0.86)` | 一侧缺项 |
| 侧栏条目高度 | — | 28px | 一侧缺项 | — | 28px | 一侧缺项 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 230px | 346px | +116px | 230px | 346px | +116px |
| 内容区右留白 | 230px | 114px | -116px | 230px | 114px | -116px |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `pricing`

- 浅色合成图：[pair-pricing-light.jpg](pair-pricing-light.jpg)
- 深色合成图：[pair-pricing-dark.jpg](pair-pricing-dark.jpg)

**结构差异**

- light：实现有、原型无：全局侧栏；实现有、原型无：全局导航
- dark：实现有、原型无：全局侧栏；实现有、原型无：全局导航

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `24px` | `24px` | 相同 | `24px` | `24px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | — | 一侧缺项 | 28px | — | 一侧缺项 |
| 主按钮圆角 | `6px` | — | 一侧缺项 | `6px` | — | 一侧缺项 |
| 主按钮字号 | `13px` | — | 一侧缺项 | `13px` | — | 一侧缺项 |
| 主按钮内边距 | `0px 11px` | — | 一侧缺项 | `0px 11px` | — | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 侧栏宽度 | — | 232px | 一侧缺项 | — | 232px | 一侧缺项 |
| 侧栏背景 | — | `rgba(238, 238, 238, 0.86)` | 一侧缺项 | — | `rgba(38, 38, 38, 0.86)` | 一侧缺项 |
| 侧栏条目高度 | — | 28px | 一侧缺项 | — | 28px | 一侧缺项 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 230px | 346px | +116px | 230px | 346px | +116px |
| 内容区右留白 | 230px | 114px | -116px | 230px | 114px | -116px |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

### `billing`

- 浅色合成图：[pair-billing-light.jpg](pair-billing-light.jpg)
- 深色合成图：[pair-billing-dark.jpg](pair-billing-dark.jpg)

**结构差异**

- light：实现有、原型无：全局侧栏；实现有、原型无：全局导航
  - 可见标题：原型 `['套餐与账单', '免费版']`；实现 `['套餐与账单', '本地版']`。
- dark：实现有、原型无：全局侧栏；实现有、原型无：全局导航
  - 可见标题：原型 `['套餐与账单', '免费版']`；实现 `['套餐与账单', '本地版']`。

**数值差异**

| 测量项 | 浅色原型 | 浅色实现 | 差 | 深色原型 | 深色实现 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| body 字号 | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| body 行高 | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 外壳字号 (.v6-shell/.window) | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主标题字号 | `15px` | `15px` | 相同 | `15px` | `15px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | — | 一侧缺项 | 28px | — | 一侧缺项 |
| 主按钮圆角 | `6px` | — | 一侧缺项 | `6px` | — | 一侧缺项 |
| 主按钮字号 | `13px` | — | 一侧缺项 | `13px` | — | 一侧缺项 |
| 主按钮内边距 | `0px 11px` | — | 一侧缺项 | `0px 11px` | — | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(188, 188, 188)` | 相同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(82, 82, 82)` | 相同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | — | 232px | 一侧缺项 | — | 232px | 一侧缺项 |
| 侧栏背景 | — | `rgba(238, 238, 238, 0.86)` | 一侧缺项 | — | `rgba(38, 38, 38, 0.86)` | 一侧缺项 |
| 侧栏条目高度 | — | 28px | 一侧缺项 | — | 28px | 一侧缺项 |
| 工具栏高度 | 52px | 52px | 相同 | 52px | 52px | 相同 |
| 内容区最大宽度 | `980px` | `980px` | 相同 | `980px` | `980px` | 相同 |
| 内容区左留白 | 230px | 346px | +116px | 230px | 346px | +116px |
| 内容区右留白 | 230px | 114px | -116px | 230px | 114px | -116px |
| 表格行高 | — | — | 均无 | — | — | 均无 |
| 标签选中边框 | — | — | 均无 | — | — | 均无 |
| 标签字重 | — | — | 均无 | — | — | 均无 |
| 输入框高度 | — | — | 均无 | — | — | 均无 |
| 输入框圆角 | — | — | 均无 | — | — | 均无 |
| 纸面宽度 | — | — | 均无 | — | — | 均无 |
| 纸面背景 | — | — | 均无 | — | — | 均无 |
| 纸面圆角 | — | — | 均无 | — | — | 均无 |

## 全局差异清单（按出现页数排序）

| 差异项 | 页数 | 页面 |
|---|---:|---|
| body 字号 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| body 行高 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 主标题字体 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 次按钮圆角 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 正文 font-family | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 主按钮内边距 | 19/22 | `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `settings`, `services`, `pricing`, `billing` |
| 主按钮字号 | 14/22 | `generate`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `settings`, `services`, `pricing`, `billing` |
| 主按钮圆角 | 10/22 | `upload`, `parse`, `questions`, `route`, `generate`, `done`, `settings`, `services`, `pricing`, `billing` |
| 卡片内边距 | 10/22 | `upload`, `parse`, `generate`, `done`, `matter:overview`, `matter:sources`, `matter:check`, `matter:deliver`, `activity`, `ai` |
| 输入框高度 | 10/22 | `questions`, `route`, `done`, `matters`, `matter:facts`, `matter:draft`, `matter:deliver`, `activity`, `ai`, `settings` |
| 输入框圆角 | 9/22 | `questions`, `route`, `done`, `matters`, `matter:facts`, `matter:draft`, `matter:deliver`, `activity`, `settings` |
| 主按钮高度 | 6/22 | `generate`, `done`, `settings`, `services`, `pricing`, `billing` |
| 标签字重 | 6/22 | `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver` |
| 内容区右留白 | 5/22 | `matter:draft`, `settings`, `services`, `pricing`, `billing` |
| 内容区左留白 | 5/22 | `matter:draft`, `settings`, `services`, `pricing`, `billing` |
| 卡片边框 | 5/22 | `upload`, `generate`, `matter:draft`, `activity`, `ai` |
| 侧栏宽度 | 4/22 | `settings`, `services`, `pricing`, `billing` |
| 侧栏条目高度 | 4/22 | `settings`, `services`, `pricing`, `billing` |
| 侧栏背景 | 4/22 | `settings`, `services`, `pricing`, `billing` |
| 卡片圆角 | 4/22 | `upload`, `generate`, `activity`, `ai` |
| 卡片阴影 | 4/22 | `upload`, `generate`, `activity`, `ai` |
| 次按钮边框 | 4/22 | `upload`, `parse`, `ai`, `services` |
| 结构：全局侧栏 | 4/22 | `settings`, `services`, `pricing`, `billing` |
| 结构：全局导航 | 4/22 | `settings`, `services`, `pricing`, `billing` |
| 主标题字号 | 3/22 | `matter:sources`, `matter:draft`, `matter:deliver` |
| 结构：卡片区 | 3/22 | `upload`, `activity`, `ai` |
| 结构：文件或下载列表 | 3/22 | `upload`, `matter:sources`, `matter:deliver` |
| 表格行高 | 3/22 | `matter:overview`, `matter:draft`, `ai` |
| 内容区最大宽度 | 2/22 | `matter:draft`, `settings` |
| 纸面宽度 | 2/22 | `preview`, `matter:draft` |
| 纸面圆角 | 1/22 | `matter:draft` |
| 结构：进度显示 | 1/22 | `parse` |

## 采集失败

- 无。
