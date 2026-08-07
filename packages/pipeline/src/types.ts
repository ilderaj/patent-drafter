// Pipeline orchestration types. Mirrors docs/architecture.md ADR-003 (18 stages).
import type { PipelineStage, SourceAsset, SourceChunk } from "@patent/domain";

export interface RunMeta {
  stage: PipelineStage;
  provider: string;
  model: string | null;
  promptVersion: string;
  rulePackVersion: string;
  startedAt: string;
  finishedAt: string;
  ms: number;
  cached: boolean;
}

export interface StageResult {
  stage: PipelineStage;
  /** Validated structured output of the stage (see schemas.ts). */
  output: unknown;
  meta: RunMeta;
}

/**
 * Working state of one drafting project through the pipeline.
 * Persistable as JSON (no functions), so the web app can snapshot and resume.
 */
export interface PipelineContext {
  projectId: string;
  title: string;
  assets: SourceAsset[];
  chunks: SourceChunk[];
  /** questionId -> user answer text (filled at the intake pause). */
  userAnswers: Record<string, string>;
  results: Partial<Record<PipelineStage, StageResult>>;
  rulePackVersion: string;
  promptVersion: string;
}

export interface PipelineOptions {
  /** Directory containing packages/prompts markdown files. */
  promptsDir: string;
  rulePackVersion: string;
  promptVersion: string;
}

export type StageOutput<T> = { stage: PipelineStage; output: T; meta: RunMeta };
