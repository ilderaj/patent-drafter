import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./primitives.ts";

export const privacyRequestSchema = z
  .object({
    requesterId: idSchema,
    scope: z.enum(["user", "matter", "tenant"]),
    scopeId: idSchema,
    kind: z.enum(["export", "delete"]),
    state: z.enum(["queued", "running", "completed", "failed", "held"]),
    requestedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
    jobId: idSchema,
    retentionExceptions: z.array(
      z
        .object({
          category: z.enum(["billing", "audit"]),
          legalBasis: z.string().min(1),
          retainUntil: isoDateTimeSchema,
          approvedBy: idSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .refine((request) => (request.state === "completed") === (request.completedAt !== null), {
    message: "completedAt must be present exactly when state is completed",
    path: ["completedAt"],
  });

/**
 * Engineering defaults from 05-contracts §11. These are not contractual
 * retention periods; G-REGION must approve production values.
 */
export const retentionPolicySchema = z
  .object({
    version: z.string().min(1),
    stagingHours: z.literal(24),
    exportCacheDays: z.literal(7),
    applicationLogDays: z.literal(30),
    backupDays: z.literal(35),
    primaryPurgeTargetHours: z.literal(24),
    billingRetainDays: z.number().int().min(0).nullable(),
    auditRetainDays: z.number().int().min(0).nullable(),
  })
  .strict();

export type PrivacyRequest = z.infer<typeof privacyRequestSchema>;
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
