import type { GenerationEngineOptions } from "./generation.ts";
import { DEFAULT_AI_CONFIG } from "../ai/ai.ts";

const STUB_PROFILE = DEFAULT_AI_CONFIG.profiles.find((profile) => profile.mode === "stub");
if (!STUB_PROFILE) throw new Error("The local test generation profile is unavailable.");

const PROMPTS = Object.freeze({
  "system-core.md": "本地测试输出。仅使用案件输入；不得补造事实、来源、同意或法律结论。",
  "extract-facts.md": "从输入材料中整理事实；无材料时明确指出缺少输入。",
  "detect-conflicts.md": "识别输入中的事实冲突。",
  "readiness.md": "仅根据现有输入评估准备情况。",
  "intake.md": "使用已保存的案件补充信息。",
  "patent-strategy.md": "提出待人工核对的起草结构，不作法律判断。",
  "claim-skeleton.md": "仅依据已确认事实建立权利要求结构。",
  "draft-claims.md": "生成供人工审阅的测试权利要求草稿。",
  "draft-specification.md": "生成供人工审阅的测试说明书草稿。",
  "figure-spec.md": "依据已保存的附图信息整理说明。",
  "draft-abstract.md": "生成供人工审阅的测试摘要草稿。",
  "audit-support.md": "检查草稿内容与输入依据的对应关系。",
  "audit-consistency.md": "检查草稿内部一致性。",
  "audit-formal-rules.md": "执行产品内确定性检查。",
});

/** Explicit on-device fixture execution. Results are test output and require human review. */
export const LOCAL_TEST_GENERATION_OPTIONS: Omit<GenerationEngineOptions, "repository" | "actor"> = Object.freeze({
  pipeline: {
    prompts: { ...PROMPTS },
    promptVersion: "v6-local-test-v1",
    rulePackVersion: "cnipa-2026-01-01",
  },
  limits: {
    maxInputTokens: 100_000,
    maxOutputTokens: 20_000,
    maxCostMinor: 1,
    maxDurationSeconds: 300,
  },
  execution: "stub",
  allowTestAdoption: true,
  profileId: STUB_PROFILE.id,
  profileVersion: STUB_PROFILE.version,
  consentId: null,
  config: DEFAULT_AI_CONFIG,
});
