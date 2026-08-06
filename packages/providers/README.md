# @patent/providers：LLM Provider 抽象

与 `docs/architecture.md` ADR-003 同步的 provider 契约骨架。

## 原则

- 模型名称不硬编码：通过 provider 配置或 discovery 获得；
- 能力必须用 capability flags 声明：`structuredOutput / tools / visionInput / imageGeneration / longContext / localAuth`；
- 本包只定义契约与类型，不实现任何具体 provider 的网络调用；
- 结构化输出使用 `Schema<T>`（生产实现绑定 Zod；骨架保持无依赖以利离线 typecheck）。

## 现状

- `LLMProvider` 接口：`getCapabilities / generateStructured / streamText / cancel`；
- 计划实现：`DeepSeekLocalBridgeProvider`（MVP，经本机 Patent Bridge 调用 DeepSeek）；
- 预留不实现：`CodexLocalProvider`（ChatGPT subscription，未来由 Bridge 调 Codex CLI/App Server）、`OpenAIApiProvider`、`LocalModelProvider`。

## 约束

- API Key 只存在于 Bridge 的 OS Keychain，浏览器侧永不可见；
- 每次模型发送内容可预览（发送前展示）后方可放行；
- 日志不得包含专利正文。
