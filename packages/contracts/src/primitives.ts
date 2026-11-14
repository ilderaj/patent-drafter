import { z } from "zod";

/**
 * Frozen contract version. Every command envelope and export manifest carries
 * this literal; changing it is a contract change, not a ticket-local edit.
 */
export const CONTRACT_VERSION = "v6.1" as const;
export const contractVersionSchema = z.literal(CONTRACT_VERSION);

/** RFC3339 UTC timestamp. Offsets other than `Z` and non-calendar dates are rejected. */
const isoDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isIsoDateTime(value: string): boolean {
  const match = isoDateTimePattern.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return Number.isFinite(Date.parse(value));
}

/** Calendar date without time zone conversion. */
const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: string): boolean {
  const match = localDatePattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export const idSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().refine(isIsoDateTime, "expected an RFC3339 UTC timestamp");
export const localDateSchema = z.string().refine(isLocalDate, "expected a real YYYY-MM-DD calendar date");
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase 64-character hex digest");
/** Command expected versions may be 0 (creation). */
export const versionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** Persisted objects start at version 1. */
export const persistedVersionSchema = versionSchema.min(1);

export const ROUTES = ["cn_um", "cn_invention", "us_nonprovisional", "pct"] as const;
export const routeSchema = z.enum(ROUTES);

export const LANGUAGES = ["zh-CN", "en-US"] as const;
export const languageSchema = z.enum(LANGUAGES);

export const ROLES = ["owner", "admin", "editor", "reviewer", "viewer"] as const;
export const roleSchema = z.enum(ROLES);

export const RUNTIMES = ["local_web", "cloud_web", "desktop", "demo"] as const;
export const runtimeSchema = z.enum(RUNTIMES);

export const GATE_ACTIONS = ["generate", "confirm", "prepare", "approve", "export", "download"] as const;
export const gateActionSchema = z.enum(GATE_ACTIONS);

/**
 * The six-field snapshot reference. Every field is required and has no default:
 * a command that cannot name its target must fail instead of falling back to
 * the current target.
 */
export const snapshotRefSchema = z
  .object({
    matterId: idSchema,
    targetId: idSchema,
    sourceVersion: persistedVersionSchema,
    targetConfigVersion: persistedVersionSchema,
    draftRevisionId: idSchema,
    figureRevisionId: idSchema,
  })
  .strict();

/** Draft input reference: the snapshot fields that do not depend on a draft. */
export const draftInputRefSchema = snapshotRefSchema.omit({ draftRevisionId: true });

export const acceptedSchema = z
  .object({
    jobId: idSchema,
    state: z.literal("queued"),
    pollAfterMs: z.number().int().min(0),
  })
  .strict();

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().min(1).nullable() }).strict();

export const capabilitySchema = z
  .object({
    key: z.string().min(1),
    state: z.enum(["available", "unavailable"]),
    reason: z.string().nullable(),
    evidenceVersion: z.string().nullable(),
  })
  .strict();

export const NOTIFY_CHANNELS = ["off", "in_app", "in_app_email"] as const;
export const notifyChannelSchema = z.enum(NOTIFY_CHANNELS);

export const THEME_IDS = ["native", "graphite", "cyan", "celadon"] as const;
export const themeIdSchema = z.enum(THEME_IDS);

export const COLOR_MODES = ["system", "light", "dark"] as const;
export const colorModeSchema = z.enum(COLOR_MODES);

export const preferenceSchema = z
  .object({
    userId: idSchema,
    version: persistedVersionSchema,
    locale: z.literal("zh-CN"),
    themeId: themeIdSchema,
    colorMode: colorModeSchema,
    notifications: z
      .object({
        deadline: notifyChannelSchema,
        review: notifyChannelSchema,
        job: notifyChannelSchema,
        service: notifyChannelSchema,
      })
      .strict(),
    telemetry: z.boolean(),
  })
  .strict();

export const sessionSchema = z
  .object({
    userId: idSchema,
    tenantId: idSchema,
    membershipId: idSchema,
    role: roleSchema,
    csrfToken: z.string().min(1),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

/** Error codes from 05-contracts §10. `reasons.code` in gate and API errors uses this set. */
export const ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_CURSOR",
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "CSRF_INVALID",
  "ACTION_FORBIDDEN",
  "ENTITLEMENT_REQUIRED",
  "CONSENT_REQUIRED",
  "CONSENT_REVOKED",
  "RESOURCE_NOT_FOUND",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_EXPIRED",
  "STALE_BINDING",
  "INPUT_STALE",
  "JOB_OBSOLETE",
  "INVALID_TRANSITION",
  "ALREADY_UNLOCKED",
  "FILE_TOO_LARGE",
  "IMAGE_TOO_LARGE",
  "PARSE_BUDGET_EXCEEDED",
  "UNSUPPORTED_MEDIA",
  "MIME_MISMATCH",
  "HASH_MISMATCH",
  "INVALID_AST",
  "SOURCE_LOCATOR_INVALID",
  "PARSE_FAILED",
  "OCR_UNAVAILABLE",
  "MISSING_BYTES",
  "BAD_DRAWING",
  "DUPLICATE_FIGURE_NUMBER",
  "GATE_BLOCKED",
  "CONFIRMATION_REQUIRED",
  "CHECK_REQUIRED",
  "APPROVAL_REQUIRED",
  "PAYMENT_MISMATCH",
  "IMPORT_INVALID",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "CAPABILITY_UNAVAILABLE",
  "RELEASE_GATE_CLOSED",
  "FORMAT_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  "PROVIDER_AUTH",
  "PROVIDER_REJECTED",
  "PROVIDER_REQUEST_INVALID",
  "PROVIDER_SCHEMA_INVALID",
  "PROVIDER_TIMEOUT",
  "JOB_LIMIT_EXCEEDED",
  "INTERNAL_ERROR",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

/**
 * 05-contracts §10 maps a group of provider codes to `502/504`. One HTTP status
 * is required per response, so timeouts map to 504 and the rest of that group
 * to 502.
 */
export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<(typeof ERROR_CODES)[number], number>> = Object.freeze({
  INVALID_INPUT: 400,
  INVALID_CURSOR: 400,
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  CSRF_INVALID: 403,
  ACTION_FORBIDDEN: 403,
  ENTITLEMENT_REQUIRED: 403,
  CONSENT_REQUIRED: 403,
  CONSENT_REVOKED: 403,
  RESOURCE_NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_EXPIRED: 409,
  STALE_BINDING: 409,
  INPUT_STALE: 409,
  JOB_OBSOLETE: 409,
  INVALID_TRANSITION: 409,
  ALREADY_UNLOCKED: 409,
  FILE_TOO_LARGE: 413,
  IMAGE_TOO_LARGE: 413,
  PARSE_BUDGET_EXCEEDED: 413,
  UNSUPPORTED_MEDIA: 415,
  MIME_MISMATCH: 415,
  HASH_MISMATCH: 422,
  INVALID_AST: 422,
  SOURCE_LOCATOR_INVALID: 422,
  PARSE_FAILED: 422,
  OCR_UNAVAILABLE: 422,
  MISSING_BYTES: 422,
  BAD_DRAWING: 422,
  DUPLICATE_FIGURE_NUMBER: 422,
  GATE_BLOCKED: 422,
  CONFIRMATION_REQUIRED: 422,
  CHECK_REQUIRED: 422,
  APPROVAL_REQUIRED: 422,
  PAYMENT_MISMATCH: 422,
  IMPORT_INVALID: 422,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  CAPABILITY_UNAVAILABLE: 503,
  RELEASE_GATE_CLOSED: 503,
  FORMAT_UNAVAILABLE: 503,
  PROVIDER_UNAVAILABLE: 503,
  STORAGE_UNAVAILABLE: 503,
  PROVIDER_AUTH: 502,
  PROVIDER_REJECTED: 502,
  PROVIDER_REQUEST_INVALID: 400,
  PROVIDER_SCHEMA_INVALID: 502,
  PROVIDER_TIMEOUT: 504,
  JOB_LIMIT_EXCEEDED: 502,
  INTERNAL_ERROR: 500,
});

export function httpStatusForErrorCode(code: (typeof ERROR_CODES)[number]): number {
  return HTTP_STATUS_BY_ERROR_CODE[code];
}

const fieldErrorSchema = z.object({ path: z.string().min(1), reason: z.string().min(1) }).strict();

const reasonSchema = z
  .object({ code: errorCodeSchema, resourceId: idSchema.optional(), action: z.string().min(1).optional() })
  .strict();

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1),
        requestId: idSchema,
        retryable: z.boolean(),
        latestVersion: versionSchema.optional(),
        fields: z.array(fieldErrorSchema).optional(),
        reasons: z.array(reasonSchema).optional(),
      })
      .strict(),
  })
  .strict();

/** `Command<P>` envelope: no actor, tenant, gate or paid flags may be supplied by the payload. */
export const commandSchema = <P extends z.ZodTypeAny>(payload: P) =>
  z
    .object({
      contractVersion: contractVersionSchema,
      expectedVersion: versionSchema,
      payload,
    })
    .strict();

/** `Result<T>` envelope returned by queries and synchronous writes. */
export const resultSchema = <T extends z.ZodTypeAny>(data: T) =>
  z
    .object({
      data,
      version: persistedVersionSchema,
      eventIds: z.array(idSchema),
      requestId: idSchema,
    })
    .strict();

export interface Command<P> {
  contractVersion: typeof CONTRACT_VERSION;
  expectedVersion: number;
  payload: P;
}

export interface Result<T> {
  data: T;
  version: number;
  eventIds: string[];
  requestId: string;
}

export interface SnapshotRef {
  matterId: string;
  targetId: string;
  sourceVersion: number;
  targetConfigVersion: number;
  draftRevisionId: string;
  figureRevisionId: string;
}

export type DraftInputRef = Omit<SnapshotRef, "draftRevisionId">;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type GateAction = (typeof GATE_ACTIONS)[number];
