import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  languageSchema,
  localDateSchema,
  persistedVersionSchema,
  routeSchema,
  sha256Schema,
} from "./primitives.ts";

export const matterStatusSchema = z.enum(["active", "archived", "deletion_pending"]);

export const matterSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    version: persistedVersionSchema,
    title: z.string(),
    status: matterStatusSchema,
    sourceVersion: persistedVersionSchema,
    createdBy: idSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const targetConfigSchema = z
  .object({
    targetId: idSchema,
    version: persistedVersionSchema,
    route: routeSchema,
    language: languageSchema,
    purpose: z.literal("preparation"),
    applicantIds: z.array(idSchema),
    inventorIds: z.array(idSchema),
    priorityClaims: z.array(
      z
        .object({
          country: z.string().min(1),
          applicationNumber: z.string().min(1),
          filedOn: localDateSchema,
          evidenceAssetId: idSchema.nullable(),
          verification: z.enum(["unverified", "human_confirmed"]),
        })
        .strict(),
    ),
  })
  .strict();

export const targetSchema = z
  .object({
    id: idSchema,
    matterId: idSchema,
    status: z.enum(["active", "archived"]),
    configVersion: persistedVersionSchema,
    draftRevisionId: idSchema.nullable(),
    figureRevisionId: idSchema,
  })
  .strict();

export const assetPurposeSchema = z.enum([
  "source",
  "drawing",
  "receipt",
  "review_attachment",
  "service_attachment",
  "export",
]);

export const assetStateSchema = z.enum(["staging", "available", "quarantined", "missing_bytes", "purged"]);

export const assetSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    matterId: idSchema.nullable(),
    serviceOrderId: idSchema.nullable(),
    purpose: assetPurposeSchema,
    originalName: z.string().min(1),
    mime: z.string().min(1),
    byteLength: z.number().int().min(0),
    sha256: sha256Schema,
    state: assetStateSchema,
    objectKey: z.string().min(1),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  // An asset has exactly one owner: a matter or a service order.
  .refine((asset) => (asset.matterId === null) !== (asset.serviceOrderId === null), {
    message: "asset must have exactly one of matterId or serviceOrderId",
    path: ["matterId"],
  });

export const sourceParseStatusSchema = z.enum([
  "pending",
  "parsing",
  "parsed",
  "partial",
  "failed",
  "cancelled",
]);

export const sourceSchema = z
  .object({
    id: idSchema,
    matterId: idSchema,
    assetId: idSchema,
    retiredAt: isoDateTimeSchema.nullable(),
    parseStatus: sourceParseStatusSchema,
    parserVersion: z.string().nullable(),
    pageCount: z.number().int().min(0).nullable(),
    ocrNeeded: z.boolean(),
  })
  .strict();

export const sourceRefSchema = z
  .object({
    sourceId: idSchema,
    chunkId: idSchema,
    chunkHash: sha256Schema,
    page: z.number().int().min(1).nullable(),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    quote: z.string().min(1),
    /**
     * Optional, backward compatible. Absent means an uploaded document. "user_answer"
     * marks a reference into the user's own saved intake answer (never a file or page).
     */
    origin: z.literal("user_answer").optional(),
    /** 1-based intake question number; required with origin "user_answer". */
    questionNo: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  // Half-open Unicode code point range over NFC text.
  .refine((ref) => ref.end > ref.start, { message: "end must be greater than start", path: ["end"] })
  .refine(
    (ref) => (ref.origin === "user_answer" ? ref.questionNo !== undefined && ref.page === null : ref.questionNo === undefined),
    { message: "user_answer references need questionNo and no page; document references must not carry questionNo", path: ["origin"] },
  );

export const chunkKindSchema = z.enum(["paragraph", "table", "image", "ocr_page"]);

const unitInterval = z.number().min(0).max(1);

export const chunkSchema = z
  .object({
    id: idSchema,
    sourceId: idSchema,
    parserVersion: z.string().min(1),
    index: z.number().int().min(0),
    kind: chunkKindSchema,
    text: z.string(),
    hash: sha256Schema,
    page: z.number().int().min(1).nullable(),
    rect: z
      .object({ x: unitInterval, y: unitInterval, w: unitInterval, h: unitInterval })
      .strict()
      .nullable(),
    ocrConfidence: unitInterval.nullable(),
  })
  .strict();

export const partySchema = z
  .object({
    id: idSchema,
    kind: z.enum(["person", "organization"]),
    name: z.string().min(1),
    roles: z.array(z.enum(["inventor", "applicant"])),
    country: z.string().nullable(),
  })
  .strict();

export const factKindSchema = z.enum(["problem", "structure", "method", "effect", "parameter", "material"]);
export const factStatusSchema = z.enum(["source_backed", "user_confirmed", "external_context", "unsupported"]);

export const factSchema = z
  .object({
    id: idSchema,
    statement: z.string().min(1),
    kind: factKindSchema,
    status: factStatusSchema,
    refs: z.array(sourceRefSchema),
    confirmedBy: idSchema.nullable(),
    confirmedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const factConflictSchema = z
  .object({
    id: idSchema,
    factIds: z.array(idSchema).min(1),
    state: z.enum(["open", "resolved", "retained"]),
    chosenFactIds: z.array(idSchema),
    reason: z.string().nullable(),
  })
  .strict();

export const intakeAnswersSchema = z
  .object({
    problem: z.string(),
    difference: z.string(),
    inventorIds: z.array(idSchema),
    disclosure: z
      .enum(["none", "private_showing", "public_event", "publication", "sale", "unsure"])
      .nullable(),
    maturity: z.enum(["tested_sample", "drawing", "idea"]).nullable(),
    disclosureDetail: z
      .object({
        occurredOn: localDateSchema.nullable(),
        audience: z.string(),
        confidentiality: z.enum(["yes", "no", "unknown"]),
        evidenceRefs: z.array(sourceRefSchema),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const sourceSnapshotSchema = z
  .object({
    matterId: idSchema,
    version: persistedVersionSchema,
    sourceIds: z.array(idSchema),
    facts: z.array(factSchema),
    conflicts: z.array(factConflictSchema),
    answers: intakeAnswersSchema,
    parties: z.array(partySchema),
    createdBy: idSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const drawingSchema = z
  .object({
    id: idSchema,
    matterId: idSchema,
    assetId: idSchema,
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    mime: z.enum(["image/png", "image/jpeg"]),
    sha256: sha256Schema,
    derivedFromAssetId: idSchema.nullable(),
  })
  .strict();

const numeralSchema = z.object({ value: z.string().min(1), label: z.string() }).strict();

export const figureEntrySchema = z
  .object({
    figureId: idSchema,
    number: z.number().int().min(1),
    title: z.string(),
    drawingId: idSchema.nullable(),
    numerals: z.array(numeralSchema),
  })
  .strict();

export const figureSetRevisionSchema = z
  .object({
    id: idSchema,
    matterId: idSchema,
    targetId: idSchema,
    parentId: idSchema.nullable(),
    entries: z.array(figureEntrySchema),
    hash: sha256Schema,
    createdAt: isoDateTimeSchema,
  })
  .strict()
  // Figure numbers may repeat (that is a check finding, DUPLICATE_FIGURE_NUMBER),
  // but one figure entry per figureId keeps the set addressable.
  .refine((revision) => new Set(revision.entries.map((entry) => entry.figureId)).size === revision.entries.length, {
    message: "figureId must be unique within a figure set revision",
    path: ["entries"],
  });

export type Matter = z.infer<typeof matterSchema>;
export type TargetConfig = z.infer<typeof targetConfigSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type Chunk = z.infer<typeof chunkSchema>;
export type Party = z.infer<typeof partySchema>;
export type Fact = z.infer<typeof factSchema>;
export type FactConflict = z.infer<typeof factConflictSchema>;
export type IntakeAnswers = z.infer<typeof intakeAnswersSchema>;
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type Drawing = z.infer<typeof drawingSchema>;
export type FigureSetRevision = z.infer<typeof figureSetRevisionSchema>;
