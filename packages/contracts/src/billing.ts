import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  persistedVersionSchema,
  routeSchema,
  sha256Schema,
  snapshotRefSchema,
} from "./primitives.ts";

const amountMinorSchema = z.number().int().min(0);
const currencySchema = z.string().min(1);

export const priceProductSchema = z.enum(["single_matter", "subscription", "service"]);
export const taxModeSchema = z.enum(["inclusive", "exclusive"]);
export const priceIntervalSchema = z.enum(["once", "month", "year"]);
export const renewalModeSchema = z.enum(["none", "manual", "automatic"]);
export const grantUnitSchema = z.enum(["matter_unlock", "model_unit", "regeneration"]);

export const priceVersionSchema = z
  .object({
    id: idSchema,
    environment: z.enum(["sandbox", "production"]),
    product: priceProductSchema,
    currency: currencySchema,
    amountMinor: amountMinorSchema,
    taxMode: taxModeSchema,
    interval: priceIntervalSchema,
    renewalMode: renewalModeSchema,
    termsVersion: z.string().min(1),
    refundPolicyVersion: z.string().min(1),
    grants: z.array(z.object({ unit: grantUnitSchema, quantity: z.number().int().min(0) }).strict()),
    status: z.enum(["draft", "active", "retired"]),
  })
  .strict();

export const paymentOrderPurposeSchema = z.enum(["single_matter", "subscription", "service"]);
export const paymentOrderStateSchema = z.enum([
  "created",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "refund_pending",
  "partially_refunded",
  "refunded",
]);

export const paymentOrderSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    version: persistedVersionSchema,
    purpose: paymentOrderPurposeSchema,
    matterId: idSchema.nullable(),
    serviceOrderId: idSchema.nullable(),
    priceVersionId: idSchema.nullable(),
    quoteVersionId: idSchema.nullable(),
    environment: z.enum(["sandbox", "production"]),
    amountMinor: amountMinorSchema,
    currency: currencySchema,
    state: paymentOrderStateSchema,
    gatewayId: z.string().min(1),
    gatewayOrderId: z.string().nullable(),
    paidAt: isoDateTimeSchema.nullable(),
  })
  .strict()
  // §8: a service order is quoted, software orders use a price; exactly one is set.
  .superRefine((order, ctx) => {
    const hasPrice = order.priceVersionId !== null;
    const hasQuote = order.quoteVersionId !== null;
    if (hasPrice === hasQuote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactly one of priceVersionId or quoteVersionId must be set",
        path: ["priceVersionId"],
      });
    }
    if (order.purpose === "service" ? !hasQuote : !hasPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "service orders require a quote; software orders require a price",
        path: [order.purpose === "service" ? "quoteVersionId" : "priceVersionId"],
      });
    }
  });

export const paymentEventSchema = z
  .object({
    gatewayId: z.string().min(1),
    eventId: z.string().min(1),
    orderId: idSchema,
    kind: z.enum(["paid", "failed", "refund", "subscription_updated"]),
    amountMinor: amountMinorSchema,
    currency: currencySchema,
    occurredAt: isoDateTimeSchema,
    payloadHash: sha256Schema,
  })
  .strict();

export const entitlementRightSchema = z.enum(["matter_access", "professional_tools"]);

export const entitlementSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    matterId: idSchema.nullable(),
    right: entitlementRightSchema,
    source: z.enum(["payment", "quota"]),
    sourceId: idSchema,
    startsAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    revokedAt: isoDateTimeSchema.nullable(),
  })
  .strict()
  // 单案使用权必须指向案件；租户级专业工具没有案件。
  .refine((entitlement) => (entitlement.right === "matter_access") === (entitlement.matterId !== null), {
    message: "matter_access requires matterId; professional_tools is tenant-scoped",
    path: ["matterId"],
  });

export const subscriptionSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    priceVersionId: idSchema,
    state: z.enum(["active", "past_due", "cancel_at_period_end", "ended"]),
    periodStart: isoDateTimeSchema,
    periodEnd: isoDateTimeSchema,
    renewalMode: renewalModeSchema,
  })
  .strict();

export const ledgerEntrySchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    unit: grantUnitSchema,
    quantity: z.number().int().min(0),
    kind: z.enum(["credit", "reserve", "capture", "release", "expire", "adjustment"]),
    reservationId: idSchema.nullable(),
    sourceId: idSchema,
    operationKey: z.string().min(1),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const serviceKindSchema = z.enum(["consultation", "document_review", "agent_referral"]);
export const serviceJurisdictionSchema = z.union([routeSchema, z.enum(["europe_service", "other"])]);

export const serviceOrderStatusSchema = z.enum([
  "requested",
  "matching",
  "quoted",
  "authorized",
  "awaiting_payment",
  "in_progress",
  "delivered",
  "closed",
  "cancelled",
]);

export const serviceOrderSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    version: persistedVersionSchema,
    matterId: idSchema.nullable(),
    kind: serviceKindSchema,
    jurisdiction: serviceJurisdictionSchema,
    need: z.string().min(1),
    contactEmail: z.string().min(1),
    contactWindow: z.string().nullable(),
    timeZone: z.string().min(1),
    status: serviceOrderStatusSchema,
    assigneeId: idSchema.nullable(),
    quoteVersionId: idSchema.nullable(),
    grantId: idSchema.nullable(),
    paymentOrderId: idSchema.nullable(),
  })
  .strict();

export const serviceQuoteSchema = z
  .object({
    id: idSchema,
    serviceOrderId: idSchema,
    version: persistedVersionSchema,
    providerIdentityId: idSchema,
    qualificationEvidenceId: idSchema,
    jurisdiction: serviceJurisdictionSchema,
    conflictCheck: z.enum(["pending", "clear", "declined"]),
    scope: z.string().min(1),
    exclusions: z.string(),
    deliverables: z.array(z.string().min(1)),
    amountMinor: amountMinorSchema,
    currency: currencySchema,
    taxMode: taxModeSchema,
    termsVersion: z.string().min(1),
    confidentialityVersion: z.string().min(1),
    refundPolicyVersion: z.string().min(1),
    expiresAt: isoDateTimeSchema,
    estimatedDeliveryAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const serviceAuthorizationSchema = z
  .object({
    id: idSchema,
    serviceOrderId: idSchema,
    quoteVersionId: idSchema,
    actorId: idSchema,
    scopeAcceptedAt: isoDateTimeSchema,
    materialsAcceptedAt: isoDateTimeSchema,
    snapshot: snapshotRefSchema.nullable(),
    assetIds: z.array(idSchema),
    recipientUserId: idSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const serviceMessageSchema = z
  .object({
    id: idSchema,
    serviceOrderId: idSchema,
    authorId: idSchema,
    text: z.string(),
    attachmentIds: z.array(idSchema),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export type PriceVersion = z.infer<typeof priceVersionSchema>;
export type PaymentOrder = z.infer<typeof paymentOrderSchema>;
export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export type Entitlement = z.infer<typeof entitlementSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type ServiceOrder = z.infer<typeof serviceOrderSchema>;
export type ServiceQuote = z.infer<typeof serviceQuoteSchema>;
export type ServiceAuthorization = z.infer<typeof serviceAuthorizationSchema>;
export type ServiceMessage = z.infer<typeof serviceMessageSchema>;
