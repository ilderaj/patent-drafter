# V6 Prototype 视觉还原度测量

- 原型：`/Users/jared/Personal Projects/Patent/docs/design/patent-saas-v6/prototype/index.html`。每个页面按 `#s=KEY&p=web&m=MODE&ui=0` 打开后 reload。
- 实现：`http://localhost:5391/patent/v6`，1440×900；每种模式通过设置页选择「原生」和浅色/深色。
- 页面对数：22；明暗模式对数：44；目标工作树 HEAD：`4682697`。
- 合成图：左侧原型、右侧实现，JPEG quality 60，1800px 总宽。假浏览器栏、macOS 菜单栏和窗口控件不计入结构差异。
- 文件名中的页面键冒号转换为连字符，例如 `matter:overview` 对应 `pair-matter-overview-light.jpg`。
- 采集使用浏览器可见 UI 创建案件、上传 fixture、回答五题、建目标、运行并采纳本地测试生成、绑定合成附图并运行检查。实现页面使用同一案件及目标。

数值来自页面当时可见的 DOM 元素及 `getComputedStyle`；内容区优先量页面内容根，未找到时量 `.main` / `.app-main` 主内容列，来源记在 JSON。页面中没有对应元素时记为 `—`。可直接比较的数值差按实现减原型计算；颜色、字体族、圆角、边框/阴影等样式项以「不同」表示，具体两侧值保留在表内。

## 页面测量

### `start`

- 浅色合成图：[pair-start-light.jpg](pair-start-light.jpg)
- 深色合成图：[pair-start-dark.jpg](pair-start-dark.jpg)

**结构差异**

- light：原型有、实现无：页面工具栏
  - 可见标题文本：原型 `["卷宗","把你的技术，写成申请材料"]`；实现 `["把你的技术整理成申请准备材料","自助准备","专业工作台","人工服务"]`。
- dark：原型有、实现无：页面工具栏
  - 可见标题文本：原型 `["卷宗","把你的技术，写成申请材料"]`；实现 `["把你的技术整理成申请准备材料","自助准备","专业工作台","人工服务"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `34px` | `34px` | 相同 | `34px` | `34px` | 相同 |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | 37.5px | 一侧缺项 | — | 37.5px | 一侧缺项 |
| 主按钮圆角 | — | `999px` | 一侧缺项 | — | `999px` | 一侧缺项 |
| 主按钮背景 | — | `rgb(10, 100, 214)` | 一侧缺项 | — | `rgb(76, 155, 245)` | 一侧缺项 |
| 主按钮字号 | — | `13px` | 一侧缺项 | — | `13px` | 一侧缺项 |
| 主按钮内边距 | — | `8px 16px` | 一侧缺项 | — | `8px 16px` | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgba(0, 0, 0, 0)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgba(0, 0, 0, 0)` | 不同 |
| 次按钮圆角 | `5px` | `999px` | 不同 | `5px` | `999px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `12px` | `10px` | 不同 | `12px` | `10px` | 不同 |
| 卡片阴影 | `none` | `rgba(0, 0, 0, 0.06) 0px 0.5px 1px 0px` | 不同 | `none` | `rgba(0, 0, 0, 0.4) 0px 0.5px 1px 0px` | 不同 |
| 卡片内边距 | `18px` | `16px` | -2px | `18px` | `16px` | -2px |
| 侧栏宽度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏条目高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中文字 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 230px | 120px | -110px | 230px | 120px | -110px |
| 内容区右留白 | 230px | 120px | -110px | 230px | 120px | -110px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `upload`

- 浅色合成图：[pair-upload-light.jpg](pair-upload-light.jpg)
- 深色合成图：[pair-upload-dark.jpg](pair-upload-dark.jpg)

**结构差异**

- light：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏；实现有、原型无：卡片区；实现有、原型无：进度显示；实现有、原型无：文件或下载列表
  - 可见标题文本：原型 `["新建申请","先把资料放进来"]`；实现 `["未命名案件","先放入已有材料","上传材料","解析材料"]`。
- dark：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏；实现有、原型无：卡片区；实现有、原型无：进度显示；实现有、原型无：文件或下载列表
  - 可见标题文本：原型 `["新建申请","先把资料放进来"]`；实现 `["未命名案件","先放入已有材料","上传材料","解析材料"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `24px` | `20px` | -4px | `24px` | `20px` | -4px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 36px | 37.5px | +1.5px | 36px | 37.5px | +1.5px |
| 主按钮圆角 | `8px` | `999px` | 不同 | `8px` | `999px` | 不同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `14px` | `13px` | -1px | `14px` | `13px` | -1px |
| 主按钮内边距 | `0px 18px` | `8px 16px` | 不同 | `0px 18px` | `8px 16px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgba(0, 0, 0, 0)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgba(0, 0, 0, 0)` | 不同 |
| 次按钮圆角 | `5px` | `999px` | 不同 | `5px` | `999px` | 不同 |
| 卡片边框 | — | `1px solid rgb(218, 218, 218)` | 一侧缺项 | — | `1px solid rgb(56, 56, 56)` | 一侧缺项 |
| 卡片圆角 | — | `10px` | 一侧缺项 | — | `10px` | 一侧缺项 |
| 卡片阴影 | — | `rgba(0, 0, 0, 0.06) 0px 0.5px 1px 0px` | 一侧缺项 | — | `rgba(0, 0, 0, 0.4) 0px 0.5px 1px 0px` | 一侧缺项 |
| 卡片内边距 | — | `24px` | 一侧缺项 | — | `24px` | 一侧缺项 |
| 侧栏宽度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏条目高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中文字 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `760px` | `1060px` | +300px | `760px` | `1060px` | +300px |
| 内容区左留白 | 452px | 190px | -262px | 452px | 190px | -262px |
| 内容区右留白 | 228px | 190px | -38px | 228px | 190px | -38px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `parse`

- 浅色合成图：[pair-parse-light.jpg](pair-parse-light.jpg)
- 深色合成图：[pair-parse-dark.jpg](pair-parse-dark.jpg)

**结构差异**

- light：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏
  - 可见标题文本：原型 `["读取资料","资料读完了"]`；实现 `["未命名案件","先放入已有材料","上传材料","解析材料"]`。
- dark：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏
  - 可见标题文本：原型 `["读取资料","资料读完了"]`；实现 `["未命名案件","先放入已有材料","上传材料","解析材料"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `24px` | `20px` | -4px | `24px` | `20px` | -4px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 36px | 37.5px | +1.5px | 36px | 37.5px | +1.5px |
| 主按钮圆角 | `8px` | `999px` | 不同 | `8px` | `999px` | 不同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `14px` | `13px` | -1px | `14px` | `13px` | -1px |
| 主按钮内边距 | `0px 18px` | `8px 16px` | 不同 | `0px 18px` | `8px 16px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgba(0, 0, 0, 0)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgba(0, 0, 0, 0)` | 不同 |
| 次按钮圆角 | `5px` | `999px` | 不同 | `5px` | `999px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `rgba(0, 0, 0, 0.06) 0px 0.5px 1px 0px` | 不同 | `none` | `rgba(0, 0, 0, 0.4) 0px 0.5px 1px 0px` | 不同 |
| 卡片内边距 | `0px` | `24px` | +24px | `0px` | `24px` | +24px |
| 侧栏宽度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏条目高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中文字 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `760px` | `1060px` | +300px | `760px` | `1060px` | +300px |
| 内容区左留白 | 452px | 190px | -262px | 452px | 190px | -262px |
| 内容区右留白 | 228px | 190px | -38px | 228px | 190px | -38px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `questions`

- 浅色合成图：[pair-questions-light.jpg](pair-questions-light.jpg)
- 深色合成图：[pair-questions-dark.jpg](pair-questions-dark.jpg)

**结构差异**

- light：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏
  - 可见标题文本：原型 `["补充信息","这项技术解决了什么问题？"]`；实现 `["未命名案件","成熟度"]`。
- dark：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏
  - 可见标题文本：原型 `["补充信息","这项技术解决了什么问题？"]`；实现 `["未命名案件","成熟度"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `20px` | `24px` | +4px | `20px` | `24px` | +4px |
| 主标题字重 | `600` | `700` | 不同 | `600` | `700` | 不同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 36px | 37.5px | +1.5px | 36px | 37.5px | +1.5px |
| 主按钮圆角 | `8px` | `999px` | 不同 | `8px` | `999px` | 不同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `14px` | `13px` | -1px | `14px` | `13px` | -1px |
| 主按钮内边距 | `0px 18px` | `8px 16px` | 不同 | `0px 18px` | `8px 16px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `999px` | 不同 | `5px` | `999px` | 不同 |
| 卡片边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 卡片圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 卡片阴影 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 卡片内边距 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏宽度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏条目高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中文字 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `760px` | `1060px` | +300px | `760px` | `1060px` | +300px |
| 内容区左留白 | 452px | 190px | -262px | 452px | 190px | -262px |
| 内容区右留白 | 228px | 190px | -38px | 228px | 190px | -38px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | 88px | 39.5px | -48.5px | 88px | 39.5px | -48.5px |
| 输入框圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |

### `route`

- 浅色合成图：[pair-route-light.jpg](pair-route-light.jpg)
- 深色合成图：[pair-route-dark.jpg](pair-route-dark.jpg)

**结构差异**

- light：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏；原型有、实现无：卡片区
  - 可见标题文本：原型 `["选择申请路线","在哪里申请，用哪种类型"]`；实现 `["未命名案件","选择申请准备路线"]`。
- dark：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏；原型有、实现无：卡片区
  - 可见标题文本：原型 `["选择申请路线","在哪里申请，用哪种类型"]`；实现 `["未命名案件","选择申请准备路线"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `24px` | `24px` | 相同 | `24px` | `24px` | 相同 |
| 主标题字重 | `600` | `700` | 不同 | `600` | `700` | 不同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 36px | 37.5px | +1.5px | 36px | 37.5px | +1.5px |
| 主按钮圆角 | `8px` | `999px` | 不同 | `8px` | `999px` | 不同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `14px` | `13px` | -1px | `14px` | `13px` | -1px |
| 主按钮内边距 | `0px 18px` | `8px 16px` | 不同 | `0px 18px` | `8px 16px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `999px` | 不同 | `5px` | `999px` | 不同 |
| 卡片边框 | `1px solid rgb(10, 100, 214)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(76, 155, 245)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `rgb(225, 236, 251) 0px 0px 0px 2px` | `none` | 不同 | `rgb(27, 47, 72) 0px 0px 0px 2px` | `none` | 不同 |
| 卡片内边距 | `16px` | `12px 16px` | 不同 | `16px` | `12px 16px` | 不同 |
| 侧栏宽度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏条目高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中文字 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `760px` | `1060px` | +300px | `760px` | `1060px` | +300px |
| 内容区左留白 | 452px | 190px | -262px | 452px | 190px | -262px |
| 内容区右留白 | 228px | 190px | -38px | 228px | 190px | -38px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | 39.5px | 一侧缺项 | — | 39.5px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |

### `generate`

- 浅色合成图：[pair-generate-light.jpg](pair-generate-light.jpg)
- 深色合成图：[pair-generate-dark.jpg](pair-generate-dark.jpg)

**结构差异**

- light：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏；实现有、原型无：卡片区；原型有、实现无：进度显示
  - 可见标题文本：原型 `["生成材料","正在写申请材料"]`；实现 `["未命名案件","生成材料","生成任务"]`。
- dark：原型有、实现无：自助步骤栏；原型有、实现无：页面工具栏；实现有、原型无：卡片区；原型有、实现无：进度显示
  - 可见标题文本：原型 `["生成材料","正在写申请材料"]`；实现 `["未命名案件","生成材料","生成任务"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `24px` | `24px` | 相同 | `24px` | `24px` | 相同 |
| 主标题字重 | `600` | `700` | 不同 | `600` | `700` | 不同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | 28px | 一侧缺项 | — | 28px | 一侧缺项 |
| 主按钮圆角 | — | `999px` | 一侧缺项 | — | `999px` | 一侧缺项 |
| 主按钮背景 | — | `rgb(10, 100, 214)` | 一侧缺项 | — | `rgb(76, 155, 245)` | 一侧缺项 |
| 主按钮字号 | — | `12px` | 一侧缺项 | — | `12px` | 一侧缺项 |
| 主按钮内边距 | — | `4px 12px` | 一侧缺项 | — | `4px 12px` | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `999px` | 不同 | `5px` | `999px` | 不同 |
| 卡片边框 | — | `1px solid rgb(218, 218, 218)` | 一侧缺项 | — | `1px solid rgb(56, 56, 56)` | 一侧缺项 |
| 卡片圆角 | — | `10px` | 一侧缺项 | — | `10px` | 一侧缺项 |
| 卡片阴影 | — | `rgba(0, 0, 0, 0.06) 0px 0.5px 1px 0px` | 一侧缺项 | — | `rgba(0, 0, 0, 0.4) 0px 0.5px 1px 0px` | 一侧缺项 |
| 卡片内边距 | — | `24px 0px` | 一侧缺项 | — | `24px 0px` | 一侧缺项 |
| 侧栏宽度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏条目高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中文字 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `760px` | `1060px` | +300px | `760px` | `1060px` | +300px |
| 内容区左留白 | 452px | 190px | -262px | 452px | 190px | -262px |
| 内容区右留白 | 228px | 190px | -38px | 228px | 190px | -38px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `preview`

- 浅色合成图：[pair-preview-light.jpg](pair-preview-light.jpg)
- 深色合成图：[pair-preview-dark.jpg](pair-preview-dark.jpg)

**结构差异**

- light：原型有、实现无：页面工具栏；检测到的分栏容器数：原型 1，实现 0
  - 可见标题文本：原型 `["材料预览"]`；实现 `["未命名案件","预览并通读","草稿预览","权利要求书","技术领域","背景技术","发明内容","附图说明","具体实施方式","摘要","风险提示","通读确认"]`。
- dark：原型有、实现无：页面工具栏；检测到的分栏容器数：原型 1，实现 0
  - 可见标题文本：原型 `["材料预览"]`；实现 `["未命名案件","预览并通读","草稿预览","权利要求书","技术领域","背景技术","发明内容","附图说明","具体实施方式","摘要","风险提示","通读确认"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `18px` | `20px` | +2px | `18px` | `20px` | +2px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 28px | 相同 | 28px | 28px | 相同 |
| 主按钮圆角 | `6px` | `999px` | 不同 | `6px` | `999px` | 不同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `4px 12px` | 不同 | `0px 11px` | `4px 12px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `999px` | 不同 | `5px` | `999px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `rgba(0, 0, 0, 0.06) 0px 0.5px 1px 0px` | 不同 | `none` | `rgba(0, 0, 0, 0.4) 0px 0.5px 1px 0px` | 不同 |
| 卡片内边距 | `0px` | `24px` | +24px | `0px` | `24px` | +24px |
| 侧栏宽度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏条目高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中文字 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `1120px` | `1060px` | -60px | `1120px` | `1060px` | -60px |
| 内容区左留白 | 160px | 190px | +30px | 160px | 190px | +30px |
| 内容区右留白 | 160px | 190px | +30px | 160px | 190px | +30px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `done`

- 浅色合成图：[pair-done-light.jpg](pair-done-light.jpg)
- 深色合成图：[pair-done-dark.jpg](pair-done-dark.jpg)

**结构差异**

- light：原型有、实现无：页面工具栏；原型有、实现无：文件或下载列表
  - 可见标题文本：原型 `["材料已生成","可以下载了"]`；实现 `["未命名案件","生成与下载材料","内部交付批准","交付材料","导出前置条件","文件","格式状态"]`。
- dark：原型有、实现无：页面工具栏；原型有、实现无：文件或下载列表
  - 可见标题文本：原型 `["材料已生成","可以下载了"]`；实现 `["未命名案件","生成与下载材料","内部交付批准","交付材料","导出前置条件","文件","格式状态"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `22px` | `20px` | -2px | `22px` | `20px` | -2px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | 37.5px | 一侧缺项 | — | 37.5px | 一侧缺项 |
| 主按钮圆角 | — | `999px` | 一侧缺项 | — | `999px` | 一侧缺项 |
| 主按钮背景 | — | `rgb(10, 100, 214)` | 一侧缺项 | — | `rgb(76, 155, 245)` | 一侧缺项 |
| 主按钮字号 | — | `13px` | 一侧缺项 | — | `13px` | 一侧缺项 |
| 主按钮内边距 | — | `8px 16px` | 一侧缺项 | — | `8px 16px` | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `999px` | 不同 | `5px` | `999px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `rgba(0, 0, 0, 0.06) 0px 0.5px 1px 0px` | 不同 | `none` | `rgba(0, 0, 0, 0.4) 0px 0.5px 1px 0px` | 不同 |
| 卡片内边距 | `0px` | `24px` | +24px | `0px` | `24px` | +24px |
| 侧栏宽度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏条目高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中文字 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `720px` | `1060px` | +340px | `720px` | `1060px` | +340px |
| 内容区左留白 | 360px | 190px | -170px | 360px | 190px | -170px |
| 内容区右留白 | 360px | 190px | -170px | 360px | 190px | -170px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | 39.5px | 一侧缺项 | — | 39.5px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |

### `inbox`

- 浅色合成图：[pair-inbox-light.jpg](pair-inbox-light.jpg)
- 深色合成图：[pair-inbox-dark.jpg](pair-inbox-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：页面顶部栏；检测到的分栏容器数：原型 0，实现 1；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["收件箱","公开历史待人工核实"]`；实现 `["收件箱","检查","任务","运行或复核检查"]`。
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：页面顶部栏；检测到的分栏容器数：原型 0，实现 1；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["收件箱","公开历史待人工核实"]`；实现 `["收件箱","检查","任务","运行或复核检查"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 25.5px | -2.5px | 28px | 25.5px | -2.5px |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `3px 8px` | 不同 | `0px 11px` | `3px 8px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgba(0, 0, 0, 0)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgba(0, 0, 0, 0)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | — | `1px solid rgb(218, 218, 218)` | 一侧缺项 | — | `1px solid rgb(56, 56, 56)` | 一侧缺项 |
| 卡片圆角 | — | `10px` | 一侧缺项 | — | `10px` | 一侧缺项 |
| 卡片阴影 | — | `none` | 一侧缺项 | — | `none` | 一侧缺项 |
| 卡片内边距 | — | `0px` | 一侧缺项 | — | `0px` | 一侧缺项 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `none` | `1200px` | 不同 | `none` | `1200px` | 不同 |
| 内容区左留白 | 232px | 236px | +4px | 232px | 236px | +4px |
| 内容区右留白 | 0px | 4px | +4px | 0px | 4px | +4px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `matters`

- 浅色合成图：[pair-matters-light.jpg](pair-matters-light.jpg)
- 深色合成图：[pair-matters-dark.jpg](pair-matters-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；实现有、原型无：表格；原型有、实现无：卡片区；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；实现有、原型无：表格；原型有、实现无：卡片区；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 25.5px | -2.5px | 28px | 25.5px | -2.5px |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `3px 8px` | 不同 | `0px 11px` | `3px 8px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgba(0, 0, 0, 0)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgba(0, 0, 0, 0)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | — | 一侧缺项 | `1px solid rgb(56, 56, 56)` | — | 一侧缺项 |
| 卡片圆角 | `10px` | — | 一侧缺项 | `10px` | — | 一侧缺项 |
| 卡片阴影 | `none` | — | 一侧缺项 | `none` | — | 一侧缺项 |
| 卡片内边距 | `0px` | — | 一侧缺项 | `0px` | — | 一侧缺项 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 346px | 236px | -110px | 346px | 236px | -110px |
| 内容区右留白 | 114px | 4px | -110px | 114px | 4px | -110px |
| 表格行高 | — | 64.1px | 一侧缺项 | — | 64.1px | 一侧缺项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | 19px | 一侧缺项 | — | 19px | 一侧缺项 |
| 输入框圆角 | — | `0px` | 一侧缺项 | — | `0px` | 一侧缺项 |

### `matter:overview`

- 浅色合成图：[pair-matter-overview-light.jpg](pair-matter-overview-light.jpg)
- 深色合成图：[pair-matter-overview-dark.jpg](pair-matter-overview-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯","一种防倾倒的宠物饮水杯"]`；实现 `["未命名案件","案件概览","下一步","","案件动态"]`。
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯","一种防倾倒的宠物饮水杯"]`；实现 `["未命名案件","案件概览","下一步","","案件动态"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 29px | +1px | 28px | 29px | +1px |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `16px` | +16px | `0px` | `16px` | +16px |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 346px | 236px | -110px | 346px | 236px | -110px |
| 内容区右留白 | 114px | 4px | -110px | 114px | 4px | -110px |
| 表格行高 | 55.3px | 64.5px | +9.2px | 55.3px | 64.5px | +9.2px |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签圆角 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 标签文字色 | `rgb(29, 29, 31)` | `rgb(29, 29, 31)` | 相同 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 |
| 标签背景 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |

### `matter:sources`

- 浅色合成图：[pair-matter-sources-light.jpg](pair-matter-sources-light.jpg)
- 深色合成图：[pair-matter-sources-dark.jpg](pair-matter-sources-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；实现有、原型无：进度显示；实现有、原型无：文件或下载列表；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯"]`；实现 `["未命名案件","上传材料","解析材料","附图"]`。
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；实现有、原型无：进度显示；实现有、原型无：文件或下载列表；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯"]`；实现 `["未命名案件","上传材料","解析材料","附图"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 29px | +1px | 28px | 29px | +1px |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `16px` | +16px | `0px` | `16px` | +16px |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 346px | 236px | -110px | 346px | 236px | -110px |
| 内容区右留白 | 114px | 4px | -110px | 114px | 4px | -110px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签圆角 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 标签文字色 | `rgb(29, 29, 31)` | `rgb(29, 29, 31)` | 相同 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 |
| 标签背景 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `matter:facts`

- 浅色合成图：[pair-matter-facts-light.jpg](pair-matter-facts-light.jpg)
- 深色合成图：[pair-matter-facts-dark.jpg](pair-matter-facts-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯"]`；实现 `["未命名案件","五题与事实"]`。
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯"]`；实现 `["未命名案件","五题与事实"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 29px | +1px | 28px | 29px | +1px |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 346px | 236px | -110px | 346px | 236px | -110px |
| 内容区右留白 | 114px | 4px | -110px | 114px | 4px | -110px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签圆角 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 标签文字色 | `rgb(29, 29, 31)` | `rgb(29, 29, 31)` | 相同 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 |
| 标签背景 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | 35px | 一侧缺项 | — | 35px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |

### `matter:draft`

- 浅色合成图：[pair-matter-draft-light.jpg](pair-matter-draft-light.jpg)
- 深色合成图：[pair-matter-draft-dark.jpg](pair-matter-draft-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；实现有、原型无：检查或审阅侧栏；实现有、原型无：分栏区域；原型有、实现无：表格；检测到的分栏容器数：原型 0，实现 1；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯","草稿与要素支持"]`；实现 `["未命名案件","生成任务","专业草稿","草稿审阅"]`。
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；实现有、原型无：检查或审阅侧栏；实现有、原型无：分栏区域；原型有、实现无：表格；检测到的分栏容器数：原型 0，实现 1；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯","草稿与要素支持"]`；实现 `["未命名案件","生成任务","专业草稿","草稿审阅"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 25.5px | -2.5px | 28px | 25.5px | -2.5px |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `13px` | `12px` | -1px | `13px` | `12px` | -1px |
| 主按钮内边距 | `0px 11px` | `3px 8px` | 不同 | `0px 11px` | `3px 8px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 346px | 236px | -110px | 346px | 236px | -110px |
| 内容区右留白 | 114px | 4px | -110px | 114px | 4px | -110px |
| 表格行高 | 27px | — | 一侧缺项 | 27px | — | 一侧缺项 |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签圆角 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 标签文字色 | `rgb(29, 29, 31)` | `rgb(29, 29, 31)` | 相同 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 |
| 标签背景 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |

### `matter:check`

- 浅色合成图：[pair-matter-check-light.jpg](pair-matter-check-light.jpg)
- 深色合成图：[pair-matter-check-dark.jpg](pair-matter-check-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯","检查与人工核实"]`；实现 `["未命名案件","检查与依据","阻断","风险","待核实","产品政策"]`。
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯","检查与人工核实"]`；实现 `["未命名案件","检查与依据","阻断","风险","待核实","产品政策"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 29px | +1px | 28px | 29px | +1px |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 346px | 236px | -110px | 346px | 236px | -110px |
| 内容区右留白 | 114px | 4px | -110px | 114px | 4px | -110px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签圆角 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 标签文字色 | `rgb(29, 29, 31)` | `rgb(29, 29, 31)` | 相同 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 |
| 标签背景 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `matter:deliver`

- 浅色合成图：[pair-matter-deliver-light.jpg](pair-matter-deliver-light.jpg)
- 深色合成图：[pair-matter-deliver-dark.jpg](pair-matter-deliver-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：表格；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯","交付与内部批准"]`；实现 `["未命名案件","内部交付批准","交付材料","导出前置条件","文件","格式状态"]`。
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：表格；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["一种防倾倒的宠物饮水杯","交付与内部批准"]`；实现 `["未命名案件","内部交付批准","交付材料","导出前置条件","文件","格式状态"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | 29px | +1px | 28px | 29px | +1px |
| 主按钮圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 主按钮背景 | `rgb(10, 100, 214)` | `rgb(10, 100, 214)` | 相同 | `rgb(76, 155, 245)` | `rgb(76, 155, 245)` | 相同 |
| 主按钮字号 | `13px` | `13px` | 相同 | `13px` | `13px` | 相同 |
| 主按钮内边距 | `0px 11px` | `4px 11px` | 不同 | `0px 11px` | `4px 11px` | 不同 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `16px` | +16px | `0px` | `16px` | +16px |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 346px | 236px | -110px | 346px | 236px | -110px |
| 内容区右留白 | 114px | 4px | -110px | 114px | 4px | -110px |
| 表格行高 | 38px | — | 一侧缺项 | 38px | — | 一侧缺项 |
| 标签选中边框 | `2px solid rgb(10, 100, 214)` | `2px solid rgb(10, 100, 214)` | 相同 | `2px solid rgb(76, 155, 245)` | `2px solid rgb(76, 155, 245)` | 相同 |
| 标签圆角 | `0px` | `0px` | 相同 | `0px` | `0px` | 相同 |
| 标签文字色 | `rgb(29, 29, 31)` | `rgb(29, 29, 31)` | 相同 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 |
| 标签背景 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 相同 |
| 标签字重 | `400` | `600` | 不同 | `400` | `600` | 不同 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |

### `activity`

- 浅色合成图：[pair-activity-light.jpg](pair-activity-light.jpg)
- 深色合成图：[pair-activity-dark.jpg](pair-activity-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["动态"]`；实现 `["案件动态"]`。
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["动态"]`；实现 `["案件动态"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `13px` | -2px | `15px` | `13px` | -2px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 主按钮圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 主按钮背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 主按钮字号 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 主按钮内边距 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `none` | 不同 | `980px` | `none` | 不同 |
| 内容区左留白 | 346px | 232px | -114px | 346px | 232px | -114px |
| 内容区右留白 | 114px | 0px | -114px | 114px | 0px | -114px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |

### `ai`

- 浅色合成图：[pair-ai-light.jpg](pair-ai-light.jpg)
- 深色合成图：[pair-ai-dark.jpg](pair-ai-dark.jpg)

**结构差异**

- light：实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：卡片区；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["AI 与数据","处理方式","连接自带密钥"]`；实现 `["AI 与数据","将外发的材料","处理方式","处理方与授权","外发授权记录","模型调用记录"]`。
- dark：实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：卡片区；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["AI 与数据","处理方式","连接自带密钥"]`；实现 `["AI 与数据","将外发的材料","处理方式","处理方与授权","外发授权记录","模型调用记录"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `22px` | +7px | `15px` | `22px` | +7px |
| 主标题字重 | `600` | `700` | 不同 | `600` | `700` | 不同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 主按钮圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 主按钮背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 主按钮字号 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 主按钮内边距 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | — | 一侧缺项 | `1px solid rgb(56, 56, 56)` | — | 一侧缺项 |
| 卡片圆角 | `10px` | — | 一侧缺项 | `10px` | — | 一侧缺项 |
| 卡片阴影 | `none` | — | 一侧缺项 | `none` | — | 一侧缺项 |
| 卡片内边距 | `16px` | — | 一侧缺项 | `16px` | — | 一侧缺项 |
| 侧栏宽度 | 232px | 232px | 相同 | 232px | 232px | 相同 |
| 侧栏背景 | `rgba(238, 238, 238, 0.86)` | `rgb(238, 238, 238)` | 不同 | `rgba(38, 38, 38, 0.86)` | `rgb(38, 38, 38)` | 不同 |
| 侧栏条目高度 | 28px | 30px | +2px | 28px | 30px | +2px |
| 侧栏选中背景 | `rgb(10, 100, 214)` | `rgb(225, 236, 251)` | 不同 | `rgb(76, 155, 245)` | `rgb(27, 47, 72)` | 不同 |
| 侧栏选中文字 | `rgb(255, 255, 255)` | `rgb(29, 29, 31)` | 不同 | `rgb(4, 17, 31)` | `rgb(236, 236, 236)` | 不同 |
| 侧栏选中圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 346px | 236px | -110px | 346px | 236px | -110px |
| 内容区右留白 | 114px | 4px | -110px | 114px | 4px | -110px |
| 表格行高 | 37.3px | 32px | -5.3px | 37.3px | 32px | -5.3px |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | 33px | 31px | -2px | 33px | 31px | -2px |
| 输入框圆角 | `6px` | `6px` | 相同 | `6px` | `6px` | 相同 |

### `settings`

- 浅色合成图：[pair-settings-light.jpg](pair-settings-light.jpg)
- 深色合成图：[pair-settings-dark.jpg](pair-settings-dark.jpg)

**结构差异**

- light：实现有、原型无：全局侧栏；实现有、原型无：全局导航；原型有、实现无：页面工具栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["设置"]`；实现 `["设置","外观","通知","数据与隐私","旧版入口","加密备份与恢复","生成恢复包","校验并导入恢复包"]`。
- dark：实现有、原型无：全局侧栏；实现有、原型无：全局导航；原型有、实现无：页面工具栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["设置"]`；实现 `["设置","外观","通知","数据与隐私","旧版入口","加密备份与恢复","生成恢复包","校验并导入恢复包"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | — | 29px | 一侧缺项 | — | 29px | 一侧缺项 |
| 主按钮圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 主按钮背景 | — | `rgb(10, 100, 214)` | 一侧缺项 | — | `rgb(76, 155, 245)` | 一侧缺项 |
| 主按钮字号 | — | `13px` | 一侧缺项 | — | `13px` | 一侧缺项 |
| 主按钮内边距 | — | `4px 11px` | 一侧缺项 | — | `4px 11px` | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | `1px solid rgb(218, 218, 218)` | 不同 | `1px solid rgb(82, 82, 82)` | `1px solid rgb(56, 56, 56)` | 不同 |
| 次按钮圆角 | `5px` | `6px` | 不同 | `5px` | `6px` | 不同 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `10px` | 相同 | `10px` | `10px` | 相同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `16px` | +16px | `0px` | `16px` | +16px |
| 侧栏宽度 | — | 232px | 一侧缺项 | — | 232px | 一侧缺项 |
| 侧栏背景 | — | `rgb(238, 238, 238)` | 一侧缺项 | — | `rgb(38, 38, 38)` | 一侧缺项 |
| 侧栏条目高度 | — | 30px | 一侧缺项 | — | 30px | 一侧缺项 |
| 侧栏选中背景 | — | `rgb(225, 236, 251)` | 一侧缺项 | — | `rgb(27, 47, 72)` | 一侧缺项 |
| 侧栏选中文字 | — | `rgb(29, 29, 31)` | 一侧缺项 | — | `rgb(236, 236, 236)` | 一侧缺项 |
| 侧栏选中圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 230px | 236px | +6px | 230px | 236px | +6px |
| 内容区右留白 | 230px | 4px | -226px | 230px | 4px | -226px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | 33px | 一侧缺项 | — | 33px | 一侧缺项 |
| 输入框圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |

### `services`

- 浅色合成图：[pair-services-light.jpg](pair-services-light.jpg)
- 深色合成图：[pair-services-dark.jpg](pair-services-dark.jpg)

**结构差异**

- light：实现有、原型无：全局侧栏；实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["人工服务","需要时，请专业人员一起看","申请路线咨询","申请材料复核","联系申请代理"]`；实现 `["人工服务","未来服务范围"]`。
- dark：实现有、原型无：全局侧栏；实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["人工服务","需要时，请专业人员一起看","申请路线咨询","申请材料复核","联系申请代理"]`；实现 `["人工服务","未来服务范围"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `24px` | `20px` | -4px | `24px` | `20px` | -4px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | — | 一侧缺项 | 28px | — | 一侧缺项 |
| 主按钮圆角 | `6px` | — | 一侧缺项 | `6px` | — | 一侧缺项 |
| 主按钮背景 | `rgb(10, 100, 214)` | — | 一侧缺项 | `rgb(76, 155, 245)` | — | 一侧缺项 |
| 主按钮字号 | `13px` | — | 一侧缺项 | `13px` | — | 一侧缺项 |
| 主按钮内边距 | `0px 11px` | — | 一侧缺项 | `0px 11px` | — | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | — | 一侧缺项 | `1px solid rgb(82, 82, 82)` | — | 一侧缺项 |
| 次按钮圆角 | `5px` | — | 一侧缺项 | `5px` | — | 一侧缺项 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `11px` | `10px` | 不同 | `11px` | `10px` | 不同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `16px` | 相同 | `16px` | `16px` | 相同 |
| 侧栏宽度 | — | 232px | 一侧缺项 | — | 232px | 一侧缺项 |
| 侧栏背景 | — | `rgb(238, 238, 238)` | 一侧缺项 | — | `rgb(38, 38, 38)` | 一侧缺项 |
| 侧栏条目高度 | — | 30px | 一侧缺项 | — | 30px | 一侧缺项 |
| 侧栏选中背景 | — | `rgb(225, 236, 251)` | 一侧缺项 | — | `rgb(27, 47, 72)` | 一侧缺项 |
| 侧栏选中文字 | — | `rgb(29, 29, 31)` | 一侧缺项 | — | `rgb(236, 236, 236)` | 一侧缺项 |
| 侧栏选中圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 230px | 236px | +6px | 230px | 236px | +6px |
| 内容区右留白 | 230px | 4px | -226px | 230px | 4px | -226px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `pricing`

- 浅色合成图：[pair-pricing-light.jpg](pair-pricing-light.jpg)
- 深色合成图：[pair-pricing-dark.jpg](pair-pricing-dark.jpg)

**结构差异**

- light：实现有、原型无：全局侧栏；实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：卡片区；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["套餐与价格","按当前需要选择"]`；实现 `["套餐与价格"]`。
- dark：实现有、原型无：全局侧栏；实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：卡片区；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["套餐与价格","按当前需要选择"]`；实现 `["套餐与价格"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `24px` | `20px` | -4px | `24px` | `20px` | -4px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | — | 一侧缺项 | 28px | — | 一侧缺项 |
| 主按钮圆角 | `6px` | — | 一侧缺项 | `6px` | — | 一侧缺项 |
| 主按钮背景 | `rgb(10, 100, 214)` | — | 一侧缺项 | `rgb(76, 155, 245)` | — | 一侧缺项 |
| 主按钮字号 | `13px` | — | 一侧缺项 | `13px` | — | 一侧缺项 |
| 主按钮内边距 | `0px 11px` | — | 一侧缺项 | `0px 11px` | — | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | — | 一侧缺项 | `1px solid rgb(82, 82, 82)` | — | 一侧缺项 |
| 次按钮圆角 | `5px` | — | 一侧缺项 | `5px` | — | 一侧缺项 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `8px` | 不同 | `10px` | `8px` | 不同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `0px` | `12px 16px` | 不同 | `0px` | `12px 16px` | 不同 |
| 侧栏宽度 | — | 232px | 一侧缺项 | — | 232px | 一侧缺项 |
| 侧栏背景 | — | `rgb(238, 238, 238)` | 一侧缺项 | — | `rgb(38, 38, 38)` | 一侧缺项 |
| 侧栏条目高度 | — | 30px | 一侧缺项 | — | 30px | 一侧缺项 |
| 侧栏选中背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中文字 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 侧栏选中圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 230px | 236px | +6px | 230px | 236px | +6px |
| 内容区右留白 | 230px | 4px | -226px | 230px | 4px | -226px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

### `billing`

- 浅色合成图：[pair-billing-light.jpg](pair-billing-light.jpg)
- 深色合成图：[pair-billing-dark.jpg](pair-billing-dark.jpg)

**结构差异**

- light：实现有、原型无：全局侧栏；实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：卡片区；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["套餐与账单","免费版"]`；实现 `["账单"]`。
- dark：实现有、原型无：全局侧栏；实现有、原型无：全局导航；原型有、实现无：页面工具栏；原型有、实现无：卡片区；原型有、实现无：页面顶部栏；外壳列布局：原型 `none`；实现 `232px 1208px`
  - 可见标题文本：原型 `["套餐与账单","免费版"]`；实现 `["账单"]`。

**数值差异**

| 测量项 | 浅色原型值 | 浅色实现值 | 差 | 深色原型值 | 深色实现值 | 差 |
|---|---|---|---:|---|---|---:|
| 页面背景 | `rgb(236, 236, 236)` | `rgb(236, 236, 236)` | 相同 | `rgb(30, 30, 30)` | `rgb(30, 30, 30)` | 相同 |
| 正文 font-family | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 正文 font-size | `13px` | `14px` | +1px | `13px` | `14px` | +1px |
| 正文 line-height | `18.98px` | `21px` | +2.02px | `18.98px` | `21px` | +2.02px |
| 主标题字号 | `15px` | `20px` | +5px | `15px` | `20px` | +5px |
| 主标题字重 | `600` | `600` | 相同 | `600` | `600` | 相同 |
| 主标题字体 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | `-apple-system, "system-ui", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 不同 |
| 主按钮高度 | 28px | — | 一侧缺项 | 28px | — | 一侧缺项 |
| 主按钮圆角 | `6px` | — | 一侧缺项 | `6px` | — | 一侧缺项 |
| 主按钮背景 | `rgb(10, 100, 214)` | — | 一侧缺项 | `rgb(76, 155, 245)` | — | 一侧缺项 |
| 主按钮字号 | `13px` | — | 一侧缺项 | `13px` | — | 一侧缺项 |
| 主按钮内边距 | `0px 11px` | — | 一侧缺项 | `0px 11px` | — | 一侧缺项 |
| 次按钮边框 | `1px solid rgb(188, 188, 188)` | — | 一侧缺项 | `1px solid rgb(82, 82, 82)` | — | 一侧缺项 |
| 次按钮圆角 | `5px` | — | 一侧缺项 | `5px` | — | 一侧缺项 |
| 卡片边框 | `1px solid rgb(218, 218, 218)` | `1px solid rgb(218, 218, 218)` | 相同 | `1px solid rgb(56, 56, 56)` | `1px solid rgb(56, 56, 56)` | 相同 |
| 卡片圆角 | `10px` | `8px` | 不同 | `10px` | `8px` | 不同 |
| 卡片阴影 | `none` | `none` | 相同 | `none` | `none` | 相同 |
| 卡片内边距 | `16px` | `12px 16px` | 不同 | `16px` | `12px 16px` | 不同 |
| 侧栏宽度 | — | 232px | 一侧缺项 | — | 232px | 一侧缺项 |
| 侧栏背景 | — | `rgb(238, 238, 238)` | 一侧缺项 | — | `rgb(38, 38, 38)` | 一侧缺项 |
| 侧栏条目高度 | — | 30px | 一侧缺项 | — | 30px | 一侧缺项 |
| 侧栏选中背景 | — | `rgb(225, 236, 251)` | 一侧缺项 | — | `rgb(27, 47, 72)` | 一侧缺项 |
| 侧栏选中文字 | — | `rgb(29, 29, 31)` | 一侧缺项 | — | `rgb(236, 236, 236)` | 一侧缺项 |
| 侧栏选中圆角 | — | `6px` | 一侧缺项 | — | `6px` | 一侧缺项 |
| 顶部工具栏高度 | 52px | — | 一侧缺项 | 52px | — | 一侧缺项 |
| 内容区最大宽度 | `980px` | `1200px` | +220px | `980px` | `1200px` | +220px |
| 内容区左留白 | 230px | 236px | +6px | 230px | 236px | +6px |
| 内容区右留白 | 230px | 4px | -226px | 230px | 4px | -226px |
| 表格行高 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签选中边框 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签文字色 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签背景 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 标签字重 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框高度 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |
| 输入框圆角 | — | — | 两侧均无此项 | — | — | 两侧均无此项 |

## 全局差异清单（按出现页数排序）

以下为页面覆盖数，不含重复模式计数；同页在浅色和深色均出现时只计 1 页。

| 差异项 | 出现页数 | 页面 |
|---|---:|---|
| 主标题字体 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 内容区右留白 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 内容区左留白 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 内容区最大宽度 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 次按钮圆角 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 次按钮边框 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 正文 font-family | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 正文 font-size | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 正文 line-height | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 结构：页面工具栏 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 顶部工具栏高度 | 22/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 主按钮内边距 | 20/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `settings`, `services`, `pricing`, `billing` |
| 主按钮高度 | 19/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `settings`, `services`, `pricing`, `billing` |
| 主标题字号 | 19/22 | `upload`, `parse`, `questions`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 卡片内边距 | 16/22 | `start`, `upload`, `parse`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:deliver`, `ai`, `settings`, `pricing`, `billing` |
| 主按钮字号 | 15/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `matter:draft`, `settings`, `services`, `pricing`, `billing` |
| 侧栏条目高度 | 14/22 | `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 侧栏背景 | 14/22 | `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 结构：全局导航 | 14/22 | `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 结构：原型 `none`；实现 `232px 1208px` | 14/22 | `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `pricing`, `billing` |
| 侧栏选中文字 | 13/22 | `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `billing` |
| 侧栏选中背景 | 13/22 | `inbox`, `matters`, `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver`, `activity`, `ai`, `settings`, `services`, `billing` |
| 主按钮圆角 | 12/22 | `start`, `upload`, `parse`, `questions`, `route`, `generate`, `preview`, `done`, `settings`, `services`, `pricing`, `billing` |
| 输入框高度 | 11/22 | `questions`, `route`, `done`, `matters`, `matter:overview`, `matter:facts`, `matter:draft`, `matter:deliver`, `activity`, `ai`, `settings` |
| 卡片阴影 | 10/22 | `start`, `upload`, `parse`, `route`, `generate`, `preview`, `done`, `inbox`, `matters`, `ai` |
| 卡片圆角 | 9/22 | `start`, `upload`, `generate`, `inbox`, `matters`, `ai`, `services`, `pricing`, `billing` |
| 输入框圆角 | 9/22 | `route`, `done`, `matters`, `matter:overview`, `matter:facts`, `matter:draft`, `matter:deliver`, `activity`, `settings` |
| 主按钮背景 | 7/22 | `start`, `generate`, `done`, `settings`, `services`, `pricing`, `billing` |
| 结构：卡片区 | 7/22 | `upload`, `route`, `generate`, `matters`, `ai`, `pricing`, `billing` |
| 卡片边框 | 6/22 | `upload`, `route`, `generate`, `inbox`, `matters`, `ai` |
| 标签字重 | 6/22 | `matter:overview`, `matter:sources`, `matter:facts`, `matter:draft`, `matter:check`, `matter:deliver` |
| 结构：页面顶部栏 | 6/22 | `inbox`, `matters`, `activity`, `services`, `pricing`, `billing` |
| 结构：自助步骤栏 | 5/22 | `upload`, `parse`, `questions`, `route`, `generate` |
| 表格行高 | 5/22 | `matters`, `matter:overview`, `matter:draft`, `matter:deliver`, `ai` |
| 主标题字重 | 4/22 | `questions`, `route`, `generate`, `ai` |
| 侧栏宽度 | 4/22 | `settings`, `services`, `pricing`, `billing` |
| 结构：全局侧栏 | 4/22 | `settings`, `services`, `pricing`, `billing` |
| 侧栏选中圆角 | 3/22 | `settings`, `services`, `billing` |
| 结构：文件或下载列表 | 3/22 | `upload`, `done`, `matter:sources` |
| 结构：表格 | 3/22 | `matters`, `matter:draft`, `matter:deliver` |
| 结构：进度显示 | 3/22 | `upload`, `generate`, `matter:sources` |
| 结构：原型 0，实现 1 | 2/22 | `inbox`, `matter:draft` |
| 结构：分栏区域 | 1/22 | `matter:draft` |
| 结构：原型 1，实现 0 | 1/22 | `preview` |
| 结构：检查或审阅侧栏 | 1/22 | `matter:draft` |

## 采集失败

- 无。
