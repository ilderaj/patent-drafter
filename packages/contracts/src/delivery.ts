import { z } from "zod";
import {
  errorCodeSchema,
  gateActionSchema,
  idSchema,
  isoDateTimeSchema,
  languageSchema,
  localDateSchema,
  persistedVersionSchema,
  routeSchema,
  sha256Schema,
  snapshotRefSchema,
} from "./primitives.ts";
import { confirmationSchema, riskSchema } from "./draft.ts";

export const ruleAuthoritySchema = z.enum(["engineering", "official", "secondary", "unknown"]);
export const ruleVerificationSchema = z.enum(["verified", "unverified", "expired"]);
export const ruleActionSchema = z.enum(["prepare", "approve", "export"]);

export const ruleSchema = z
  .object({
    id: z.string().min(1),
    packVersion: z.string().min(1),
    category: riskSchema.shape.category,
    authority: ruleAuthoritySchema,
    verification: ruleVerificationSchema,
    jurisdiction: z.union([routeSchema, z.literal("all")]),
    documentKind: z.string().min(1),
    action: ruleActionSchema,
    basisUrl: z.string().nullable(),
    citation: z.string().nullable(),
    effectiveFrom: localDateSchema.nullable(),
    effectiveTo: localDateSchema.nullable(),
    verifiedBy: idSchema.nullable(),
    verifiedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const findingSchema = riskSchema.extend({
  status: z.enum(["open", "acknowledged", "resolved"]),
  evidenceNodeIds: z.array(idSchema),
});

export const checkRunStateSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const checkRunSchema = z
  .object({
    id: idSchema,
    snapshot: snapshotRefSchema,
    rulePackVersion: z.string().min(1),
    state: checkRunStateSchema,
    findings: z.array(findingSchema),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const approvalSchema = z
  .object({
    id: idSchema,
    snapshot: snapshotRefSchema,
    checkRunId: idSchema,
    confirmationIds: z.array(idSchema),
    actorId: idSchema,
    purpose: z.literal("internal_release"),
    note: z.string(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const gateContextSchema = z
  .object({
    action: gateActionSchema,
    snapshot: snapshotRefSchema,
    snapshotCurrent: z.boolean(),
    filesAvailable: z.boolean(),
    rulePackVersion: z.string().min(1),
    activeRulePackVersion: z.string().min(1),
    checkRun: checkRunSchema.nullable(),
    approval: approvalSchema.nullable(),
    confirmations: z.array(confirmationSchema),
    risks: z.array(riskSchema),
    now: isoDateTimeSchema,
  })
  .strict();

export const gateDecisionSchema = z
  .object({
    action: gateActionSchema,
    allowed: z.boolean(),
    evaluatedAt: isoDateTimeSchema,
    reasons: z.array(
      z.object({ code: errorCodeSchema, resourceId: idSchema.optional() }).strict(),
    ),
  })
  .strict()
  // A closed gate must state why; it never returns an unexplained refusal or a simulated success.
  .refine((decision) => decision.allowed || decision.reasons.length > 0, {
    message: "a disallowed gate decision requires at least one reason",
    path: ["reasons"],
  });

export const exportPackageKindSchema = z.enum(["preparation", "internally_approved"]);
export const exportConfirmationModeSchema = z.enum(["self_read", "professional_paragraphs"]);
export const exportFormatSchema = z.enum(["docx", "pdf", "patentpack", "xml"]);

export const exportRequestSchema = z
  .object({
    snapshot: snapshotRefSchema,
    packageKind: exportPackageKindSchema,
    confirmationMode: exportConfirmationModeSchema,
    formats: z.array(exportFormatSchema).min(1),
    checkRunId: idSchema,
    approvalId: idSchema.nullable(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (new Set(request.formats).size !== request.formats.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "formats contains duplicates", path: ["formats"] });
    }
    if (request.packageKind === "internally_approved" && request.approvalId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "internally_approved export requires approvalId",
        path: ["approvalId"],
      });
    }
    if (request.packageKind === "preparation" && request.approvalId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preparation export cannot carry approvalId",
        path: ["approvalId"],
      });
    }
  });

export const manifestFileSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    mime: z.string().min(1),
    bytes: z.number().int().min(0),
    sha256: sha256Schema,
  })
  .strict();

export const manifestSchema = z
  .object({
    schemaVersion: z.literal("export.v1"),
    exportId: idSchema,
    snapshot: snapshotRefSchema,
    astHash: sha256Schema,
    figureSetHash: sha256Schema,
    rulePackVersion: z.string().min(1),
    checkRunId: idSchema,
    approvalId: idSchema.nullable(),
    confirmationIds: z.array(idSchema),
    riskIds: z.array(idSchema),
    searchState: z.enum(["not_searched", "recorded"]),
    packageKind: exportPackageKindSchema,
    language: languageSchema,
    createdAt: isoDateTimeSchema,
    files: z.array(manifestFileSchema),
  })
  .strict();

export const reviewStatusSchema = z.enum(["draft", "sent", "responded", "closed", "revoked", "expired"]);

export const reviewSchema = z
  .object({
    id: idSchema,
    snapshot: snapshotRefSchema,
    recipientUserId: idSchema,
    grantId: idSchema,
    status: reviewStatusSchema,
    dueOn: localDateSchema.nullable(),
    expiresAt: isoDateTimeSchema,
    createdBy: idSchema,
  })
  .strict();

export const reviewFeedbackResolutionSchema = z.enum(["open", "accepted", "rejected", "deferred"]);

export const reviewFeedbackSchema = z
  .object({
    id: idSchema,
    reviewId: idSchema,
    authorId: idSchema,
    nodeId: idSchema.nullable(),
    quoteHash: sha256Schema.nullable(),
    comment: z.string(),
    replacementText: z.string().nullable(),
    attachmentIds: z.array(idSchema),
    resolution: reviewFeedbackResolutionSchema,
    resolutionReason: z.string().nullable(),
  })
  .strict();

export const resourceGrantSchema = z
  .object({
    id: idSchema,
    recipientUserId: idSchema,
    expiresAt: isoDateTimeSchema,
    purpose: z.enum(["review", "service"]),
    snapshot: snapshotRefSchema.nullable(),
    assetIds: z.array(idSchema),
    permissions: z.array(z.enum(["read", "comment", "download"])).min(1),
    consentRecordId: idSchema,
  })
  .strict()
  .refine((grant) => new Set(grant.permissions).size === grant.permissions.length, {
    message: "permissions contains duplicates",
    path: ["permissions"],
  });

export type Rule = z.infer<typeof ruleSchema>;
export type CheckRun = z.infer<typeof checkRunSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type GateContext = z.infer<typeof gateContextSchema>;
export type GateDecision = z.infer<typeof gateDecisionSchema>;
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type ReviewFeedback = z.infer<typeof reviewFeedbackSchema>;
export type ResourceGrant = z.infer<typeof resourceGrantSchema>;
