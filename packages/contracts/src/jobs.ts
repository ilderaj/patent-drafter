import { z } from "zod";
import {
  draftInputRefSchema,
  errorCodeSchema,
  idSchema,
  isoDateTimeSchema,
  persistedVersionSchema,
  sha256Schema,
  snapshotRefSchema,
} from "./primitives.ts";

export const providerModeSchema = z.enum(["platform", "byok", "local", "stub"]);
export const providerPurposeSchema = z.enum(["extract", "draft", "check", "ocr"]);
export const trainingPolicySchema = z.enum(["no_training", "allowed", "unknown"]);
export const providerStatusSchema = z.enum(["disabled", "test_only", "approved"]);

export const providerProfileSchema = z
  .object({
    id: idSchema,
    version: persistedVersionSchema,
    mode: providerModeSchema,
    adapterId: z.string().min(1),
    modelId: z.string().min(1),
    processorName: z.string().min(1),
    processingRegion: z.string().nullable(),
    retentionPolicyVersion: z.string().nullable(),
    trainingPolicy: trainingPolicySchema,
    termsVersion: z.string().nullable(),
    allowedPurposes: z.array(providerPurposeSchema),
    capabilities: z
      .object({
        structuredOutput: z.boolean(),
        visionInput: z.boolean(),
        imageGeneration: z.boolean(),
        contextWindowTokens: z.number().int().min(1).nullable(),
        maxOutputTokens: z.number().int().min(1).nullable(),
      })
      .strict(),
    status: providerStatusSchema,
    credentialRef: idSchema.nullable(),
  })
  .strict()
  // C12: approval requires known processing facts; anything unknown stays disabled or test_only.
  .superRefine((profile, ctx) => {
    if (profile.status !== "approved") return;
    const missing = ["processingRegion", "retentionPolicyVersion", "termsVersion"].filter(
      (field) => profile[field as "processingRegion" | "retentionPolicyVersion" | "termsVersion"] === null,
    );
    const empty = ["processingRegion", "retentionPolicyVersion", "termsVersion"].filter(
      (field) => profile[field as "processingRegion" | "retentionPolicyVersion" | "termsVersion"] === "",
    );
    if (missing.length > 0 || empty.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `approved provider profile requires non-empty ${[...missing, ...empty].join(", ")}`,
        path: ["status"],
      });
    }
    if (profile.trainingPolicy === "unknown") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "approved profile cannot have trainingPolicy=unknown", path: ["trainingPolicy"] });
    }
  });

export const consentScopeSchema = z
  .object({
    matterId: idSchema,
    targetId: idSchema.nullable(),
    sourceVersion: persistedVersionSchema,
    assetIds: z.array(idSchema),
    chunkIds: z.array(idSchema),
    factIds: z.array(idSchema),
    draftRevisionIds: z.array(idSchema),
    figureRevisionIds: z.array(idSchema),
    payloadManifestHash: sha256Schema,
  })
  .strict();

export const consentSchema = z
  .object({
    id: idSchema,
    actorId: idSchema,
    providerProfileId: idSchema,
    providerProfileVersion: persistedVersionSchema,
    purpose: providerPurposeSchema,
    scope: consentScopeSchema,
    processorName: z.string().min(1),
    processingRegion: z.string().min(1),
    retentionPolicyVersion: z.string().min(1),
    trainingPolicy: z.enum(["no_training", "allowed"]),
    termsVersion: z.string().min(1),
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const jobKindSchema = z.enum([
  "parse",
  "extract",
  "generate",
  "check",
  "export",
  "recovery_export",
  "data_export",
  "delete",
]);

export const jobStateSchema = z.enum([
  "queued",
  "running",
  "cancel_requested",
  "cancelled",
  "succeeded",
  "failed",
  "interrupted",
]);

export const generateStageSchema = z.enum(["facts", "support", "claims", "specification", "checks"]);

export const jobInputSchema = z.union([draftInputRefSchema, snapshotRefSchema]);

export const jobProgressSchema = z
  .object({
    completed: z.number().int().min(0),
    total: z.number().int().min(0).nullable(),
    unit: z.enum(["stage", "page", "file"]),
  })
  .strict();

export const jobDispositionSchema = z.enum(["pending", "ready", "obsolete_result", "adopted", "discarded"]);

export const jobSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    matterId: idSchema.nullable(),
    targetId: idSchema.nullable(),
    version: persistedVersionSchema,
    kind: jobKindSchema,
    state: jobStateSchema,
    createdBy: idSchema,
    input: jobInputSchema.nullable(),
    baseDraftRevisionId: idSchema.nullable(),
    payloadHash: sha256Schema,
    consentId: idSchema.nullable(),
    providerProfileId: idSchema.nullable(),
    providerProfileVersion: persistedVersionSchema.nullable(),
    promptVersion: z.string().min(1),
    stageVersion: z.string().min(1),
    rulePackVersion: z.string().nullable(),
    stage: z.string().nullable(),
    attempt: z.number().int().min(0),
    leaseOwner: idSchema.nullable(),
    leaseExpiresAt: isoDateTimeSchema.nullable(),
    progress: jobProgressSchema,
    cancelRequestedAt: isoDateTimeSchema.nullable(),
    resultId: idSchema.nullable(),
    disposition: jobDispositionSchema,
    errorCode: errorCodeSchema.nullable(),
    usageUnknown: z.boolean(),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  // A failed job names its error; other states may still carry a diagnostic code
  // (for example an interrupted R1 run), so only the failed direction is fixed.
  .refine((job) => job.state !== "failed" || job.errorCode !== null, {
    message: "a failed job must name its errorCode",
    path: ["errorCode"],
  });

export const stageOutputSchema = z
  .object({
    jobId: idSchema,
    stage: z.string().min(1),
    attempt: z.number().int().min(0),
    inputHash: sha256Schema,
    outputHash: sha256Schema,
    schemaVersion: z.string().min(1),
    artifactId: idSchema,
    completedAt: isoDateTimeSchema,
  })
  .strict();

export const modelInvocationSchema = z
  .object({
    id: idSchema,
    jobId: idSchema,
    stage: z.string().min(1),
    attempt: z.number().int().min(0),
    providerProfileId: idSchema,
    modelId: z.string().min(1),
    consentId: idSchema.nullable(),
    requestHash: sha256Schema,
    inputTokens: z.number().int().min(0).nullable(),
    outputTokens: z.number().int().min(0).nullable(),
    costMinor: z.number().int().min(0).nullable(),
    currency: z.string().nullable(),
    usageUnknown: z.boolean(),
    status: z.enum(["started", "succeeded", "failed", "cancelled"]),
  })
  .strict();

export type ProviderProfile = z.infer<typeof providerProfileSchema>;
export type ConsentScope = z.infer<typeof consentScopeSchema>;
export type Consent = z.infer<typeof consentSchema>;
export type JobKind = z.infer<typeof jobKindSchema>;
export type JobState = z.infer<typeof jobStateSchema>;
export type Job = z.infer<typeof jobSchema>;
export type StageOutput = z.infer<typeof stageOutputSchema>;
export type ModelInvocation = z.infer<typeof modelInvocationSchema>;
