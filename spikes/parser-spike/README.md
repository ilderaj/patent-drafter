# Spike B: 解析可行性（DOC/DOCX/PDF/OCR）

## 结论

| 输入 | 方案 | 结果 |
|------|------|------|
| .doc（旧格式） | macOS `textutil` / LibreOffice（soffice headless） | 均成功转文本；soffice 可转 docx/pdf |
| .docx | pandoc 直接支持 | 未测（pandoc 支持 docx，链路同 doc→docx） |
| PDF（文本型） | soffice 转 pdf + poppler pdfinfo/pdftoppm | 转换成功；pdftotext 不在本机，可走 Web PDF.js 或 py 库 |
| 扫描 PDF | pdftoppm → 图像 → OCR | 链路可用（tesseract eng 通过；中文用 macOS Vision，见下） |
| 图片 | OCR | tesseract eng 可用；中文 macOS Vision **zh-Hans 已实测通过**（2026-08-06） |

## 关键发现

1. **pandoc 不支持 .doc**（仅 docx）；.doc 必须先经 textutil 或 soffice 转换。Bridge 的 macOS 侧可内置 textutil 调用；跨平台用 soffice。
2. **soffice 需要 UserInstallation 参数**：`-env:UserInstallation=file:///tmp/lo-profile`，否则报 "User installation could not be completed"。
3. **tesseract 本机仅有英文语言包**：中文 OCR 需 `chi_sim.traineddata`（联网下载）或 macOS Vision framework。**决策：macOS Bridge 优先 Vision（系统内置、中文质量好、无需下载）；Linux/Windows 用 tesseract + chi_sim。**
4. **DOC 元数据不可信**：soffice 转换后 pdfinfo 显示 Title/Author 等元数据与正文主题不一致（交底文件元数据残留其他文档信息）——解析器必须忽略文档元数据，不将其作为内容来源。
5. LibreOffice 转换警告（libpng sBIT）无害。
6. **Vision 中文 OCR 已验证**：`swift vision_ocr.swift <img>` 默认 `zh-Hans,en-US`，实测识别"共享热水表 三模通讯 蓝牙mesh 470无线 NB-IoT"全部命中（conf≈0.50）；注意大小写/易混淆字符（NB-IoT 误识为 NB-loT），后续管线需对术语表做归一化。

## 恶意文件防御（设计要点）

- 大小上限 + ZIP bomb 检测（解压前检查压缩比）。
- .doc/.docx 禁止宏执行（只读解析）。
- HTML/RTF 富文本按纯文本提取，不解析脚本。
- 路径穿越：附件存储用随机 ID 而非用户文件名。

## 产物

- `jiaodi-shared-hot-water-meter-2022.12.14.docx/pdf`：转换产物（spike 验证用，不入库）
- `vision_ocr.swift`：macOS Vision OCR 脚本（已实测 zh-Hans 中文识别；可传语言参数，如 `en-US` 或 `zh-Hans,en-US`）
- `page1-1.png`、`out-eng.txt`：OCR 验证中间产物
