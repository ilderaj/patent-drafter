# Spike C: DeepSeek Provider 契约

## 目标

验证 `LLMProvider` 抽象（architecture.md ADR-009）的协议形状；CI 使用 Mock Provider，真实 Key 仅在用户本机 Bridge 持有。

## 结果

- capabilities 契约：structuredOutput/tools/visionInput/imageGeneration/longContext/localAuth 六项 flag 可查询（`deepseek-chat` 支持 structuredOutput + longContext，无 vision/image）。
- generateStructured：request（promptVersion/rulePackVersion/inputHash）+ schema 校验链工作正常；缺失字段被拒绝。
- streamText / cancel 接口占位。

## 真实调用设计（Bridge 内实现，不在本 spike 执行）

```http
POST https://api.deepseek.com/chat/completions
Authorization: Bearer <Keychain 读取的 Key>
{
  "model": "deepseek-chat",
  "messages": [{ "role": "system", "content": "<system-core.md>" },
               { "role": "user", "content": "<阶段 Prompt + 结构化指令>" }],
  "response_format": { "type": "json_object" },
  "temperature": 0.3
}
```

## 结论

协议可行；DeepSeek OpenAI 兼容端点可直接映射到 generateStructured。模型名称不硬编码（配置/发现）。CI 用 MockDeepSeekProvider（本 spike 已实现）。

## 产物

- `provider_contract.mjs`：可运行契约验证（`node provider_contract.mjs` → SPIKE_C_PASS）

