// Browser-side drafting pipeline: DeepSeek via local Bridge + inline prompts.
// The runner never sees the API key; every send passes the bridge preview gate
// (the UI confirms each preview before the payload is sent).
import { DeepSeekLocalBridgeProvider } from "@patent/providers";
import { PipelineRunner } from "@patent/pipeline";
import { mockPipelineContext } from "@patent/pipeline";
import type { PipelineContext, StageResult } from "@patent/pipeline";
import type { PipelineStage } from "@patent/domain";
import { getSessionToken, bridgeBase } from "./bridge";

// Inline prompt pack (Vite ?raw). Keys are file names used by packages/prompts.
import systemCore from "../../../../packages/prompts/system-core.md?raw";
import extractFacts from "../../../../packages/prompts/extract-facts.md?raw";
import detectConflicts from "../../../../packages/prompts/detect-conflicts.md?raw";
import readiness from "../../../../packages/prompts/readiness.md?raw";
import intake from "../../../../packages/prompts/intake.md?raw";
import patentStrategy from "../../../../packages/prompts/patent-strategy.md?raw";
import claimSkeleton from "../../../../packages/prompts/claim-skeleton.md?raw";
import draftClaims from "../../../../packages/prompts/draft-claims.md?raw";
import draftSpecification from "../../../../packages/prompts/draft-specification.md?raw";
import figureSpec from "../../../../packages/prompts/figure-spec.md?raw";
import draftAbstract from "../../../../packages/prompts/draft-abstract.md?raw";
import auditSupport from "../../../../packages/prompts/audit-support.md?raw";
import auditConsistency from "../../../../packages/prompts/audit-consistency.md?raw";
import auditFormalRules from "../../../../packages/prompts/audit-formal-rules.md?raw";

export const PROMPTS: Record<string, string> = {
  "system-core.md": systemCore,
  "extract-facts.md": extractFacts,
  "detect-conflicts.md": detectConflicts,
  "readiness.md": readiness,
  "intake.md": intake,
  "patent-strategy.md": patentStrategy,
  "claim-skeleton.md": claimSkeleton,
  "draft-claims.md": draftClaims,
  "draft-specification.md": draftSpecification,
  "figure-spec.md": figureSpec,
  "draft-abstract.md": draftAbstract,
  "audit-support.md": auditSupport,
  "audit-consistency.md": auditConsistency,
  "audit-formal-rules.md": auditFormalRules,
};

export const RULE_PACK_VERSION = "cnipa-2026-01-01";
export const PROMPT_VERSION = "0.1.0";

export function createBrowserRunner(autoConfirm: boolean): PipelineRunner {
  const provider = new DeepSeekLocalBridgeProvider({
    baseUrl: bridgeBase(),
    getSessionToken,
    autoConfirm,
  });
  return new PipelineRunner(provider, {
    prompts: PROMPTS,
    rulePackVersion: RULE_PACK_VERSION,
    promptVersion: PROMPT_VERSION,
  });
}

export function newLiveContext(title: string, text: string): PipelineContext {
  const ctx = mockPipelineContext(newId(), title);
  ctx.title = title;
  const paragraphs = text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  ctx.chunks = paragraphs.map((p, i) => ({
    id: `c${i + 1}`,
    assetId: "paste-1",
    chunkIndex: i,
    kind: "paragraph" as const,
    page: i + 1,
    text: p,
    contentHash: `h${i + 1}`,
  }));
  return ctx;
}

function newId(): string {
  return `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function stageResultOf(ctx: PipelineContext, stage: PipelineStage): StageResult | undefined {
  return ctx.results[stage];
}
