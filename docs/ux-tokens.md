# 专利起草助手 · WebApp UX 设计令牌与组件标准

> 权威文件：`apps/web/src/styles.css` 中的 CSS 变量是令牌的唯一实现；本文档是
> 令牌与组件契约的文字化标准。视觉重构轮（2026-08-09）批准后，所有界面必须
> 通过本标准的令牌与组件实现，禁止在屏幕内硬编码颜色/圆角/间距。

## 1. 设计原则（参考站推导）

本项目视觉语言综合自两个参考站，并收敛到本产品特性：

| 参考站 | 提取的设计语言 | 本项目吸收点 |
|--------|---------------|-------------|
| [cursor.com](https://cursor.com) | 暖纸色背景、炭墨文字、橙色点缀、发丝边框、克制的阴影、大标题层级 | 暖中性色板、橙色主色、卡片悬浮层次、标题字号层级 |
| [opencodex.me/zh-cn](https://opencodex.me/zh-cn/) | 文档式克制：白/暖灰表面、8–12px 圆角、单一强调色、清晰的表单与状态 | 圆角收敛、克制的状态色、工具型信息架构 |

四条强制原则：
1. **一个强调色**：仅 `--primary`（品牌橙）承担强调；语义色只表达状态（成功/警告/错误）。
2. **层次来自字号与留白**：不靠给文字上色制造层级；正文 13px、卡片标题 15px、
   页标题 26px（衬线 display）。
3. **先减法**：任何装饰必须可解释；无渐变、无发光、无 emoji、无玻璃拟态。
4. **发丝边框 + 微阴影**：表面层次用 1px 边框与 `--shadow-xs`，悬浮交互用
   `--shadow-md`，不使用大面积模糊与重阴影。

## 2. 色彩令牌（语义命名，shadcn 兼容）

所有语义令牌在 `styles.css` 的 `:root` 与 `@media (prefers-color-scheme: dark)`
中定义。**禁止在组件/屏幕中直接使用十六进制色值**（状态 tint 一律
`color-mix(in srgb, <token> X%, transparent)`）。

| 令牌 | 浅色 | 深色 | 用途 |
|------|------|------|------|
| `--background` | `#f7f6f2` | `#17150f` | 页面画布（暖纸色 / 暖近黑） |
| `--foreground` | `#1b1915` | `#ece8df` | 主文字（暖墨） |
| `--card` / `--card-foreground` | `#ffffff` / `#1b1915` | `#1e1b14` / `#ece8df` | 卡片表面 |
| `--popover` / `--popover-foreground` | `#ffffff` / `#1b1915` | `#221f17` / `#ece8df` | 弹层表面 |
| `--primary` / `--primary-foreground` | `#ff8400` / `#241403` | `#ff9636` / `#241403` | 品牌橙（唯一强调色） |
| `--secondary` / `--secondary-foreground` | `#eeece5` / `#1b1915` | `#2b271f` / `#ece8df` | 次级表面 |
| `--muted` / `--muted-foreground` | `#f2f0ea` / `#6f6a60` | `#262218` / `#a29c8f` | 弱化表面/说明文字 |
| `--accent` / `--accent-foreground` | `#fbf3e7` / `#1b1915` | `#33291a` / `#ece8df` | 悬停/选中填充（橙调暖色） |
| `--destructive` / `--destructive-foreground` | `#c0391b` / `#fff` | `#ff6b47` / `#fff` | 错误与删除 |
| `--success` | `#2f7a4d` | `#7fd59a` | 通过状态（badge-ok / 检查项 ok） |
| `--warning` | `#b37700` | `#ffc46b` | 需关注状态 |
| `--border` | `#e6e2d8` | `#343028` | 发丝边框 |
| `--input` | `#dad5ca` | `#3e392f` | 输入框边框 |
| `--ring` | `#ff8400` | `#ff9636` | 焦点环（= 强调色） |
| `--sidebar*` | 浅暖灰 | 深暖灰 | 侧栏专属表面 |

## 3. 其他令牌

| 类别 | 令牌 | 值（浅色） | 说明 |
|------|------|-----------|------|
| 圆角 | `--radius-sm` / `-m` / `-lg` / `-pill` | 8 / 12 / 16 / 999px | 输入 8、卡片 12、横幅级 16、药丸 999；`--radius: 12px` 为 shadcn 兼容别名 |
| 字体 | `--font-body` | Inter / PingFang SC / 系统 | 界面正文与控件 |
| 字体 | `--font-display` | Iowan Old Style / Georgia / Songti SC / Noto Serif SC | 页标题 h1、Logo、统计数字（衬线 display） |
| 字体 | `--font-mono` | ui-monospace / SF Mono / JetBrains Mono | 仅代码类内容：规则 ID、配对码、文件格式、Key 输入 |
| 间距 | `--space-1..7` | 4/8/12/16/24/32/48 | 布局间距仅允许取用此体系 |
| 阴影 | `--shadow-xs` | `0 1px 2px rgba(27,25,21,.05)` | 卡片默认 |
| 阴影 | `--shadow-md` | `0 8px 24px -8px rgba(27,25,21,.12)` | 悬浮/弹层 |
| 动效 | `--dur-fast` / `--dur-med` / `--ease` | 120ms / 200ms / cubic-bezier(.2,0,0,1) | 全部过渡 |

## 4. 组件契约（shadcn/ui 对齐）

组件实现位于 `apps/web/src/components/ui/`。API 命名与 variant/size 契约对齐
[shadcn/ui](https://github.com/shadcn-ui/ui)；交互基元使用 radix-ui；图标使用
lucide-react。样式载体是本项目的 CSS 令牌（未引入 Tailwind，见 §6 决策记录）。

| 组件 | API 契约 | 变体/状态 | 无障碍行为 |
|------|---------|----------|-----------|
| `Button` | `variant` × `size` × `asChild` | variant: default/secondary/outline/ghost/destructive/link；size: default/sm/lg/icon | 原生 button；disabled 不聚焦；focus-visible 橙环 |
| `Card` + `CardHeader/CardTitle/CardDescription/CardContent/CardFooter` | 组合式结构 | — | 语义标题 h3 |
| `Badge` | `variant`（兼容旧 `tone`） | default/secondary/outline/ok/warn/err | 纯展示 |
| `Input` / `Textarea` | 原生属性透传 | focus 橙环 + 3px 弱化光圈 | 必须配 label/aria-label/placeholder |
| `Switch` | radix Root | checked 橙色轨道 | radix：Space/Enter 切换，aria-checked |
| `Checkbox` | radix Root + Indicator | checked 橙色填充 + 对勾 | radix：Space 切换，focus 环 |
| `RadioGroup` + `RadioCardItem` | radix Root/Item | checked 橙色描边 + 圆点 | radix：方向键切换，Space 选择 |
| `Tabs` + `TabsList/TabsTrigger/TabsContent` | radix | active 白底浮起 | radix：方向键切换 tab，aria-selected |
| `Dialog` + `DialogContent/Title/Description/Footer` | radix Root/Portal | overlay + 居中卡片 | radix：焦点圈闭、Esc 关闭、aria-modal |
| `Separator` | radix | horizontal/vertical | 装饰性 |
| `Skeleton` | 占位 | 脉冲动画 | aria-hidden |
| `Progress` | radix | 橙色指示条 | aria-valuenow |
| `Notice` | `icon` + children | 灰底提示条 | 状态词先行 |
| `Field` | label/hint/children | — | label 语义文本 |
| `PageHeader` | title/sub/actions | 衬线 h1 | 页面级标题 |
| `EmptyState` | icon/title/sub/action | 图标瓦片 + 衬线标题 | — |

### 4.1 交互状态规范（所有可交互组件）
- **hover**：背景 `--accent` 或边框向 `--ring` 混色（`color-mix` 45–60%）。
- **focus-visible**：2px `--ring` 轮廓 + 2px offset；键盘唯一焦点指示。
- **disabled**：opacity 0.45 + `cursor: not-allowed`，不进入 Tab 序。
- **active**（按钮按下）：`translateY(0.5px)` 微下沉。
- 所有图标按钮必须带 `aria-label` 或可见文字。

## 5. shadcn 映射表

| shadcn/ui 令牌 | 本项目令牌 | 说明 |
|---------------|-----------|------|
| `--background` / `--foreground` | 同名 | 语义一致 |
| `--card` / `--card-foreground` | 同名 | 语义一致 |
| `--primary` / `--primary-foreground` | 同名 | 语义一致 |
| `--secondary` | 同名 | 语义一致 |
| `--muted` / `--muted-foreground` | 同名 | 语义一致 |
| `--accent` / `--accent-foreground` | 同名 | 语义一致 |
| `--destructive` / `--destructive-foreground` | 同名 | 语义一致 |
| `--border` / `--input` / `--ring` | 同名 | 语义一致 |
| `--radius` | `--radius: 12px` | shadcn 默认 0.5rem≈8px；本项目取 12px 与大圆角收敛方向一致 |
| shadcn `Button` | `ui/button.tsx` | variant/size 契约一致（default/secondary/outline/ghost/destructive/link × default/sm/lg/icon + asChild） |
| shadcn `Card*` | `ui/card.tsx` | 子组件命名一致 |
| shadcn `Badge` | `ui/badge.tsx` | variant 契约一致 |
| shadcn `Switch/Checkbox/RadioGroup/Tabs/Dialog/Separator/Progress/Skeleton` | `ui/*.tsx` | 同 radix 基元 |

## 6. 决策记录

- **ADR-UX-001 不引入 Tailwind**：项目为纯 CSS 令牌体系，屏幕内直接使用
  语义 class；shadcn 对齐落在 API/令牌/无障碍契约层，避免 Tailwind 迁移对
  现有功能（16 屏 + 键盘链路 + 导出门禁）造成回归风险。若后续引入 Tailwind，
  只需把 `cva` 的 class 映射改为 Tailwind 工具类，组件 API 不变。
- **ADR-UX-002 图标统一 lucide-react**：侧栏/按钮/状态一律 lucide 线性图标；
  禁止 emoji 与文本字形充当图标。
- **ADR-UX-003 保留功能性圆形与 mono**：radio 圆点、状态点、编号圆、开关拇指
  是物理圆形而非过度圆角；mono 仅用于规则 ID/配对码/文件格式等代码类内容。
- **ADR-UX-004 删除确认用 Dialog**：设置页“删除本机数据”采用 radix Dialog
  二次确认（替代双击按钮），保留“不可恢复”警示语义。

## 7. 禁项清单（kill-ai-slop 落地）

以下模式在本项目代码库中禁止出现（扫描器：kill-ai-slop/scripts/scan.mjs）：

- ❌ 渐变背景 / 渐变文字 / 发光阴影（唯一例外：无）
- ❌ emoji 或文本字形当图标（`⚙` `▦` `✓` 等；✓ 仅允许保留在「已提取」文案中）
- ❌ 玻璃拟态（backdrop-blur 面板；唯一例外：移动端吸顶栏 8px 轻模糊）
- ❌ 默认彩虹语义色（蓝/紫信息色）；状态只用 success/warning/destructive 三态
- ❌ 硬编码色值（`#fff8f0` 之类）；一律 `var(--*)` + `color-mix`
- ❌ 过度圆角（卡片 >16px）；药丸仅用于按钮/徽章/筛选 chip
- ❌ 大字重阴影、悬浮发光按钮、AI 腔文案（“不是 X，而是 Y”“让 X 更 Y”）
- ❌ 装饰性 serif 斜体强调；衬线仅用于 display 标题

## 8. 检查与维护

- 视觉回归：`qa/walk.mjs flow|keys|tour` + `qa/walk-gate-fix.mjs`（12/12 契约）。
- 令牌变更必须同步本文档第 2/3 节表格，并在 `styles.css` 与 `.pen` 设计文件中
  三处一致。
- 新增组件必须落在 `components/ui/`，并在此文档第 4 节登记 API 契约。
