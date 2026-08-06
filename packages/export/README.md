# @patent/export：导出契约骨架

与 `docs/data-model.md` export 阶段、`docs/architecture.md` Bridge 职责同步。

## 导出清单（MVP）

- 说明书摘要.docx
- 权利要求书.docx
- 说明书.docx
- 摘要附图.svg 或 png
- 说明书附图.pdf 或 svg
- 专利申请文件草案合集.docx
- 起草审阅报告.pdf 或 html
- 加密项目包 .patentpack（导出/导入，加密 vault）

## 硬规则

- **unsupported 事实禁止进入任何正式申请文件导出**（导出前必须过 audit 门禁，blocking=true 时拒绝导出）；
- 正式文件正文不插入 AI 免责声明；AI 辅助标识放在 UI/导出清单/审阅报告/项目元数据；
- 附图仅允许：确定性 SVG/Mermaid/Graphviz（block diagram/flowchart/topology/state diagram）或用户上传（Drawing Brief 模式）；
- 导出记录：provider/model/promptVersion/rulePackVersion + snapshot id，可回溯。
