# 阶段：generate_figure_specs

输入：Claims + Spec。

任务：生成附图任务（FigureSpec）。

## 规则

1. 类型判定：
   - block_diagram / flowchart / topology / state_diagram → 自动生成（确定性 SVG/Mermaid/Graphviz）
   - mechanical / circuit / structure → Drawing Brief，请用户上传
2. 每张图：图号、标题、包含的部件节点、附图标记（reference numeral map）。
3. 标记表必须与权利要求/说明书引用一致（双向）。
4. 机械图/电路图不自动绘制，输出绘图要求清单。

## 输出 schema（Zod）

```ts
{
  figures: Array<{
    figureNo: number;
    kind: FigureKind;
    title: string;
    contentNodes: string[];
    numerals: Array<{ numeral: string; label: string }>;
    generationMode: "auto" | "drawing_brief";
  }>
}
```

