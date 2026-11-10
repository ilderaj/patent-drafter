import { z } from "zod";
import {
  draftInputRefSchema,
  idSchema,
  isoDateTimeSchema,
  languageSchema,
  sha256Schema,
  snapshotRefSchema,
} from "./primitives.ts";
import { sourceRefSchema } from "./matter.ts";

export const sectionKindSchema = z.enum([
  "technical_field",
  "background",
  "summary",
  "figures_description",
  "embodiments",
  "abstract",
]);

export const SECTION_KINDS = sectionKindSchema.options;

export const paragraphOriginSchema = z.enum(["human", "ai", "mixed", "legacy"]);

export const paragraphSchema = z
  .object({
    id: idSchema,
    text: z.string(),
    origin: paragraphOriginSchema,
    sourceRefs: z.array(sourceRefSchema),
    factIds: z.array(idSchema),
    figureIds: z.array(idSchema),
    generationJobId: idSchema.nullable(),
  })
  .strict();

export const claimFeatureSchema = z
  .object({
    id: idSchema,
    text: z.string().min(1),
    factIds: z.array(idSchema),
    supportParagraphIds: z.array(idSchema),
    status: z.enum(["supported", "partial", "unsupported"]),
  })
  .strict();

export const claimSchema = z
  .object({
    id: idSchema,
    number: z.number().int().min(1),
    dependsOn: z.array(idSchema),
    paragraphs: z.array(paragraphSchema),
    features: z.array(claimFeatureSchema),
  })
  .strict();

export const draftSectionSchema = z
  .object({ kind: sectionKindSchema, paragraphs: z.array(paragraphSchema) })
  .strict();

/**
 * Structural invariants from 05-contracts §4:
 * - claim numbers are unique and contiguous from 1;
 * - a claim may only depend on an existing earlier claim;
 * - node IDs are unique within one revision;
 * - each section kind has exactly one position.
 */
export const draftAstSchema = z
  .object({
    schemaVersion: z.literal("draft.v1"),
    language: languageSchema,
    title: z.string(),
    claims: z.array(claimSchema),
    sections: z.array(draftSectionSchema),
  })
  .strict()
  .superRefine((ast, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    const numbers = new Set<number>();
    const claimIds = new Set<string>();
    for (const [index, claim] of ast.claims.entries()) {
      if (numbers.has(claim.number)) addIssue(`duplicate claim number ${claim.number}`, ["claims", index, "number"]);
      numbers.add(claim.number);
      if (claimIds.has(claim.id)) addIssue(`duplicate claim id ${claim.id}`, ["claims", index, "id"]);
      claimIds.add(claim.id);
    }
    for (let expected = 1; expected <= ast.claims.length; expected += 1) {
      if (!numbers.has(expected)) addIssue(`claim numbers must be contiguous from 1; missing ${expected}`, ["claims"]);
    }

    const numberById = new Map(ast.claims.map((claim) => [claim.id, claim.number]));
    for (const [index, claim] of ast.claims.entries()) {
      if (new Set(claim.dependsOn).size !== claim.dependsOn.length) {
        addIssue("dependsOn contains duplicates", ["claims", index, "dependsOn"]);
      }
      for (const dependency of claim.dependsOn) {
        if (dependency === claim.id) {
          addIssue("claim cannot depend on itself", ["claims", index, "dependsOn"]);
          continue;
        }
        const dependencyNumber = numberById.get(dependency);
        if (dependencyNumber === undefined) {
          addIssue(`dependsOn references unknown claim ${dependency}`, ["claims", index, "dependsOn"]);
        } else if (dependencyNumber >= claim.number) {
          addIssue("claim can only depend on an earlier claim", ["claims", index, "dependsOn"]);
        }
      }
    }

    const nodeIds = new Set<string>();
    const paragraphIds = new Set<string>();
    const registerNode = (id: string, path: (string | number)[]) => {
      if (nodeIds.has(id)) addIssue(`duplicate node id ${id}`, path);
      nodeIds.add(id);
    };
    const registerParagraph = (paragraph: (typeof ast.claims)[number]["paragraphs"][number], path: (string | number)[]) => {
      registerNode(paragraph.id, [...path, "id"]);
      paragraphIds.add(paragraph.id);
    };

    for (const [claimIndex, claim] of ast.claims.entries()) {
      for (const [featureIndex, feature] of claim.features.entries()) {
        registerNode(feature.id, ["claims", claimIndex, "features", featureIndex, "id"]);
      }
      for (const [paragraphIndex, paragraph] of claim.paragraphs.entries()) {
        registerParagraph(paragraph, ["claims", claimIndex, "paragraphs", paragraphIndex]);
      }
    }

    const seenKinds = new Set<string>();
    for (const [sectionIndex, section] of ast.sections.entries()) {
      if (seenKinds.has(section.kind)) addIssue(`section kind ${section.kind} appears more than once`, ["sections", sectionIndex, "kind"]);
      seenKinds.add(section.kind);
      for (const [paragraphIndex, paragraph] of section.paragraphs.entries()) {
        registerParagraph(paragraph, ["sections", sectionIndex, "paragraphs", paragraphIndex]);
      }
    }

    for (const [claimIndex, claim] of ast.claims.entries()) {
      for (const [featureIndex, feature] of claim.features.entries()) {
        for (const paragraphId of feature.supportParagraphIds) {
          if (!paragraphIds.has(paragraphId)) {
            addIssue(`supportParagraphIds references unknown node ${paragraphId}`, [
              "claims",
              claimIndex,
              "features",
              featureIndex,
              "supportParagraphIds",
            ]);
          }
        }
      }
    }
  });

export const draftRevisionReasonSchema = z.enum([
  "generated",
  "edited",
  "adopted_inputs",
  "restored",
  "review_accepted",
  "imported",
]);

export const draftRevisionSchema = z
  .object({
    id: idSchema,
    matterId: idSchema,
    targetId: idSchema,
    parentId: idSchema.nullable(),
    input: draftInputRefSchema,
    ast: draftAstSchema,
    astHash: sha256Schema,
    reason: draftRevisionReasonSchema,
    restoredFrom: idSchema.nullable(),
    /** True when this revision descends from local fixture generation. */
    testOutput: z.boolean().optional(),
    createdBy: idSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const riskCategorySchema = z.enum(["blocker", "risk", "unverified", "policy"]);

export const riskAnchorSchema = z
  .object({
    nodeId: idSchema.nullable(),
    section: z.union([sectionKindSchema, z.literal("claims")]).nullable(),
    locked: z.boolean(),
  })
  .strict();

export const riskSchema = z
  .object({
    id: idSchema,
    category: riskCategorySchema,
    title: z.string().min(1),
    explanation: z.string(),
    ruleId: z.string().min(1),
    requiresAcknowledgement: z.boolean(),
    anchor: riskAnchorSchema,
  })
  .strict();

export const previewSchema = z
  .object({
    snapshot: snapshotRefSchema,
    access: z.enum(["preview", "full", "local_unmetered"]),
    title: z.string(),
    language: languageSchema,
    claims: z.array(claimSchema),
    technicalField: z.array(paragraphSchema),
    background: z.array(paragraphSchema),
    lockedSections: z.array(sectionKindSchema),
    risks: z.array(riskSchema),
    inputStale: z.boolean(),
  })
  .strict();

export const fullDraftSchema = z
  .object({
    snapshot: snapshotRefSchema,
    ast: draftAstSchema,
    risks: z.array(riskSchema),
    inputStale: z.boolean(),
  })
  .strict();

export const revisionSummarySchema = z
  .object({
    id: idSchema,
    parentId: idSchema.nullable(),
    reason: draftRevisionReasonSchema,
    restoredFrom: idSchema.nullable(),
    input: draftInputRefSchema,
    inputStale: z.boolean(),
    createdBy: idSchema,
    createdAt: isoDateTimeSchema,
    aiParagraphCount: z.number().int().min(0),
    confirmedAiParagraphCount: z.number().int().min(0),
  })
  .strict()
  .refine((summary) => summary.confirmedAiParagraphCount <= summary.aiParagraphCount, {
    message: "confirmedAiParagraphCount cannot exceed aiParagraphCount",
    path: ["confirmedAiParagraphCount"],
  });

export const confirmationIdentitySchema = z.enum(["authenticated", "local_self_reported", "legacy_unverified"]);
export const confirmationKindSchema = z.enum(["full_read", "ai_paragraph", "risk_ack"]);

export const confirmationSchema = z
  .object({
    id: idSchema,
    snapshot: snapshotRefSchema,
    actorId: idSchema,
    identity: confirmationIdentitySchema,
    kind: confirmationKindSchema,
    paragraphId: idSchema.nullable(),
    riskId: idSchema.nullable(),
    checkRunId: idSchema.nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  // §4: ai_paragraph binds one ai/mixed paragraph; risk_ack binds a risk and its check run.
  .superRefine((confirmation, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    if (confirmation.kind === "ai_paragraph" && confirmation.paragraphId === null) {
      addIssue("ai_paragraph confirmation requires paragraphId", ["paragraphId"]);
    }
    if (confirmation.kind === "risk_ack") {
      if (confirmation.riskId === null) addIssue("risk_ack confirmation requires riskId", ["riskId"]);
      if (confirmation.checkRunId === null) addIssue("risk_ack confirmation requires checkRunId", ["checkRunId"]);
    }
    if (confirmation.kind === "full_read" && (confirmation.paragraphId !== null || confirmation.riskId !== null)) {
      addIssue("full_read confirmation cannot bind a paragraph or risk", ["kind"]);
    }
  });

export const revocationObjectTypeSchema = z.enum(["confirmation", "approval", "consent", "review", "grant"]);

export const revocationSchema = z
  .object({
    id: idSchema,
    objectType: revocationObjectTypeSchema,
    objectId: idSchema,
    actorId: idSchema,
    reason: z.string().min(1),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export type SectionKind = z.infer<typeof sectionKindSchema>;
export type Paragraph = z.infer<typeof paragraphSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type DraftAST = z.infer<typeof draftAstSchema>;
export type DraftRevision = z.infer<typeof draftRevisionSchema>;
export type RiskDTO = z.infer<typeof riskSchema>;
export type PreviewDTO = z.infer<typeof previewSchema>;
export type FullDraftDTO = z.infer<typeof fullDraftSchema>;
export type RevisionSummary = z.infer<typeof revisionSummarySchema>;
export type Confirmation = z.infer<typeof confirmationSchema>;
export type Revocation = z.infer<typeof revocationSchema>;
