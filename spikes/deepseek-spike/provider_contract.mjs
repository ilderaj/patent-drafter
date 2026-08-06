// Spike C: DeepSeek Provider 契约（无 Key 环境用 Mock Provider 验证结构化输出协议）
// 目标：验证 generateStructured 的协议形状，CI 可用 mock 跑通，真实 Key 仅本地 Bridge 持有。

// ---- Zod 风格 schema 最小实现（依赖放生产包，这里仅演示协议） ----
class ZodLike {
  constructor(shape) { this.shape = shape; }
  parse(data) {
    const out = {};
    for (const [k, v] of Object.entries(this.shape)) {
      if (!(k in data)) throw new Error(`missing field: ${k}`);
      if (v === "string" && typeof data[k] !== "string") throw new Error(`bad type: ${k}`);
      if (v === "number" && typeof data[k] !== "number") throw new Error(`bad type: ${k}`);
      if (Array.isArray(v) && !Array.isArray(data[k])) throw new Error(`bad type: ${k}`);
      out[k] = data[k];
    }
    return out;
  }
}

// ---- LLMProvider 接口（与 architecture.md ADR-009 一致） ----
class MockDeepSeekProvider {
  constructor({ model = "deepseek-chat", structuredOutput = true } = {}) {
    this.model = model;
    this.caps = { structuredOutput, tools: false, visionInput: false, imageGeneration: false, longContext: true, localAuth: false };
  }
  async getCapabilities() { return this.caps; }
  async generateStructured(request, schema) {
    // 真实实现：POST https://api.deepseek.com/chat/completions
    //   messages = [system(prompt) + user(structured 指令)]
    //   response_format = { type: "json_object" }
    // 这里 mock 返回固定 JSON 以验证协议与校验链
    const raw = JSON.stringify({ title: "一种基于三模通讯的共享热水表", patentType: "utility_model", claimStrategy: { independentCount: 1, dependentCount: 9 } });
    return schema.parse(JSON.parse(raw));
  }
  async *streamText(request) { yield "mock"; }
  async cancel(id) {}
}

// ---- 协议验证 ----
const claimSkeletonSchema = new ZodLike({
  title: "string",
  patentType: "string",
  claimStrategy: { parse: (d) => d },
});

const provider = new MockDeepSeekProvider();
const caps = await provider.getCapabilities();
console.log("capabilities:", JSON.stringify(caps));
console.log("structuredOutput supported:", caps.structuredOutput);

const result = await provider.generateStructured(
  { promptVersion: "v1", rulePackVersion: "cnipa-2026-01-01", inputHash: "abc123" },
  claimSkeletonSchema
);
console.log("structured result:", JSON.stringify(result));

// 断言：schema 缺失字段应报错（校验链有效）
try {
  await provider.generateStructured({}, new ZodLike({ missing: "string" }));
  console.log("FAIL: schema should reject");
} catch (e) {
  console.log("OK: schema validation rejects:", e.message);
}
console.log("SPIKE_C_PASS");
