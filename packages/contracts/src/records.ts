import { z } from "zod";
import { errorCodeSchema, idSchema, isoDateTimeSchema, localDateSchema, sha256Schema, snapshotRefSchema } from "./primitives.ts";

export const signatureEvidenceSchema = z
  .object({
    id: idSchema,
    targetId: idSchema,
    snapshot: snapshotRefSchema,
    assetId: idSchema,
    signerName: z.string().min(1),
    signedAt: isoDateTimeSchema.nullable(),
    verification: z.enum(["unverified", "human_confirmed"]),
  })
  .strict();

export const receiptStatusSchema = z.enum(["unverified", "confirmed", "superseded"]);
export const receiptMatchSchema = z.enum(["unknown", "matches", "differs"]);

export const receiptSchema = z
  .object({
    id: idSchema,
    targetId: idSchema,
    assetId: idSchema,
    authority: z.string().min(1),
    applicationNumber: z.string().min(1),
    filedOn: localDateSchema,
    receivedAt: isoDateTimeSchema.nullable(),
    status: receiptStatusSchema,
    snapshot: snapshotRefSchema.nullable(),
    submittedFiles: z.array(z.object({ assetId: idSchema, sha256: sha256Schema }).strict()),
    match: receiptMatchSchema,
    discrepancy: z.string().nullable(),
    confirmedBy: idSchema.nullable(),
    confirmedAt: isoDateTimeSchema.nullable(),
    supersedesId: idSchema.nullable(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    if (receipt.status === "confirmed" && (receipt.confirmedBy === null || receipt.confirmedAt === null)) {
      addIssue("confirmed receipt requires confirmedBy and confirmedAt", ["status"]);
    }
    if (receipt.match === "differs" && (receipt.discrepancy === null || receipt.discrepancy.length === 0)) {
      addIssue("a differing receipt must describe the discrepancy", ["discrepancy"]);
    }
  });

export const deadlineStatusSchema = z.enum(["suggested", "confirmed", "completed", "cancelled"]);

export const deadlineSchema = z
  .object({
    id: idSchema,
    targetId: idSchema,
    receiptId: idSchema.nullable(),
    title: z.string().min(1),
    dueOn: localDateSchema,
    timeZone: z.string().min(1),
    remindAt: isoDateTimeSchema.nullable(),
    basis: z.enum(["manual", "rule_suggestion"]),
    basisNote: z.string().min(1),
    ruleId: z.string().nullable(),
    status: deadlineStatusSchema,
    confirmedBy: idSchema.nullable(),
    confirmedAt: isoDateTimeSchema.nullable(),
  })
  .strict()
  // §7: only a confirmed deadline may remind; suggested deadlines never enter the inbox.
  .refine(
    (deadline) =>
      deadline.status === "suggested" ? deadline.remindAt === null && deadline.confirmedAt === null : true,
    { message: "a suggested deadline cannot carry a reminder or confirmation time", path: ["status"] },
  );

export const priorArtSchema = z
  .object({
    id: idSchema,
    targetId: idSchema,
    title: z.string().min(1),
    url: z.string().nullable(),
    publicationNumber: z.string().nullable(),
    familyKey: z.string().nullable(),
    discoveredOn: localDateSchema,
    relevance: z.string(),
    assetIds: z.array(idSchema),
    status: z.enum(["unreviewed", "reviewed", "dismissed"]),
    reviewerId: idSchema.nullable(),
    note: z.string().nullable(),
  })
  .strict();

export const inboxKindSchema = z.enum(["fact_conflict", "ai_confirmation", "check", "review", "deadline", "job", "service"]);

export const inboxItemSchema = z
  .object({
    id: idSchema,
    matterId: idSchema,
    targetId: idSchema.nullable(),
    kind: inboxKindSchema,
    resourceId: idSchema,
    state: z.enum(["open", "resolved"]),
    readAt: isoDateTimeSchema.nullable(),
    dueAt: isoDateTimeSchema.nullable(),
    actionPath: z.string().min(1),
  })
  .strict();

export const activityActorKindSchema = z.enum(["user", "worker", "webhook"]);

export const activityActionSchema = z.enum([
  "matter.created", "matter.renamed", "matter.archived",
  "source.committed", "source.retired", "snapshot.created",
  "target.created", "target.config_updated", "target.archived", "figures.bound",
  "revision.created", "revision.restored",
  "job.started", "job.succeeded", "job.failed", "job.cancelled", "job.adopted",
  "consent.granted", "consent.revoked", "check.completed",
  "confirmation.created", "confirmation.revoked", "approval.created", "approval.revoked",
  "export.created", "export.downloaded",
  "review.sent", "review.responded", "review.resolved", "review.revoked",
  "receipt.recorded", "receipt.confirmed", "deadline.confirmed", "deadline.completed",
  "payment.paid", "payment.refunded", "entitlement.granted", "entitlement.revoked",
  "service.requested", "service.quoted", "service.authorized", "service.delivered", "service.closed",
  "privacy.export", "privacy.delete", "member.added", "member.removed",
]);

// S06/C10 allow only compact operational facts (IDs, versions, counts, error codes, processor
// and model names); never content, secrets or request bodies. Free-text keys are not admitted.
export const activityMetadataKeySchema = z.enum(["version", "count", "stage", "provider", "model", "errorCode"]);
export const activityMetadataSchema = z
  .object({
    version: z.number().int().min(0),
    count: z.number().int().min(0),
    stage: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/),
    provider: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/).nullable(),
    model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/).nullable(),
    errorCode: errorCodeSchema,
  })
  .partial()
  .strict();

type ActivityMetadataKey = z.infer<typeof activityMetadataKeySchema>;
type ActivityAction = z.infer<typeof activityActionSchema>;

// V6-03 decision (NEEDS_DECISION "ACTIVITY-METADATA-BY-ACTION", conservative default):
// S06 requires a per-action whitelist but does not list the keys, so each action may carry only
// the keys below. Actions mapped to [] carry empty metadata. Widening a row needs a contract change.
export const ACTIVITY_METADATA_KEYS_BY_ACTION: Readonly<Record<ActivityAction, readonly ActivityMetadataKey[]>> =
  Object.freeze({
    "matter.created": ["version"],
    "matter.renamed": ["version"],
    "matter.archived": ["version"],
    "source.committed": ["version"],
    "source.retired": ["version"],
    "snapshot.created": ["version", "count"],
    "target.created": ["version"],
    "target.config_updated": ["version"],
    "target.archived": ["version"],
    "figures.bound": ["version", "count"],
    "revision.created": ["version"],
    "revision.restored": ["version"],
    "job.started": ["stage", "provider", "model"],
    "job.succeeded": ["stage", "count", "provider", "model"],
    "job.failed": ["stage", "errorCode", "provider", "model"],
    "job.cancelled": ["stage"],
    "job.adopted": ["version", "provider", "model"],
    "consent.granted": ["provider"],
    "consent.revoked": ["provider"],
    "check.completed": ["version", "count"],
    "confirmation.created": ["count"],
    "confirmation.revoked": ["count"],
    "approval.created": ["count"],
    "approval.revoked": [],
    "export.created": ["count"],
    "export.downloaded": [],
    "review.sent": [],
    "review.responded": ["count"],
    "review.resolved": [],
    "review.revoked": [],
    "receipt.recorded": [],
    "receipt.confirmed": [],
    "deadline.confirmed": [],
    "deadline.completed": [],
    "payment.paid": [],
    "payment.refunded": [],
    "entitlement.granted": [],
    "entitlement.revoked": [],
    "service.requested": [],
    "service.quoted": [],
    "service.authorized": [],
    "service.delivered": [],
    "service.closed": [],
    "privacy.export": [],
    "privacy.delete": [],
    "member.added": [],
    "member.removed": [],
  });

export const activitySchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    matterId: idSchema.nullable(),
    targetId: idSchema.nullable(),
    actorId: idSchema.nullable(),
    actorKind: activityActorKindSchema,
    action: activityActionSchema,
    snapshot: snapshotRefSchema.nullable(),
    jobId: idSchema.nullable(),
    resourceId: idSchema,
    occurredAt: isoDateTimeSchema,
    metadata: activityMetadataSchema,
  })
  .strict()
  .superRefine((activity, ctx) => {
    const allowed = new Set(ACTIVITY_METADATA_KEYS_BY_ACTION[activity.action]);
    for (const key of Object.keys(activity.metadata)) {
      if (!allowed.has(key as ActivityMetadataKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `metadata key ${key} is not allowed for ${activity.action}`,
          path: ["metadata", key],
        });
      }
    }

    if (activity.action === "job.succeeded" || activity.action === "job.adopted") {
      for (const key of ["provider", "model"] as const) {
        if (activity.metadata[key] === undefined || activity.metadata[key] === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required for ${activity.action}`,
            path: ["metadata", key],
          });
        }
      }
    }
  });

export type SignatureEvidence = z.infer<typeof signatureEvidenceSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Deadline = z.infer<typeof deadlineSchema>;
export type PriorArtRecord = z.infer<typeof priorArtSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type Activity = z.infer<typeof activitySchema>;
