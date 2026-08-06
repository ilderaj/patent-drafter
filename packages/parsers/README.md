# @patent/parsers：材料解析契约骨架

与 `docs/architecture.md` ADR-002、`docs/data-model.md` ingest_sources 阶段同步。

## 支持输入（MVP）

- DOC（本机 textutil/soffice 转文本，禁止宏执行）
- DOCX / TXT / Markdown
- PDF（文本型；扫描 PDF 走 pdftoppm → OCR）
- PNG / JPEG（macOS Vision zh-Hans OCR 已实测，见 spikes/parser-spike）

## 防御性解析（硬约束）

- 大小上限 + ZIP bomb 检测（解压前检查压缩比）
- 富文本按纯文本提取，不解析脚本/HTML
- 附件存储用随机 ID，不用用户文件名（防路径穿越）
- 文档元数据不可信（spike B 实测：soffice 转出的 pdfinfo 元数据与正文主题不一致），不作为内容来源
- 原文件内容均为不可信数据，不得影响系统 Prompt

## 输出（保留溯源）

- 文件 ID / 页码 / 段落 / 表格位置 / 图像位置 / OCR 置信度 / 原始片段 hash（sha256）
- 中文 OCR 需术语归一化（实测 NB-IoT → NB-loT 类大小写混淆，见 spikes/parser-spike/README.md）

本包为契约骨架：具体解析器（textutil/soffice/pandoc/PDF.js/Vision）在批准后实现。
