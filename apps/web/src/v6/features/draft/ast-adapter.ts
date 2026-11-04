import {
  SECTION_KINDS,
  draftAstSchema,
  type Claim,
  type DraftAST,
  type DraftRevision,
  type Paragraph,
  type SectionKind,
  type SnapshotRef,
} from "../../../../../../packages/contracts/src/index.ts";
import type { Fact, SourceRef, TargetConfig } from "../../../../../../packages/contracts/src/matter.ts";

/** One visible section in the editor; `present` keeps a read-only round trip exact. */
export interface DraftEditorSection {
  kind: SectionKind;
  present: boolean;
  paragraphs: Paragraph[];
}

/** Editable view of DraftAST. Paragraph and claim ids remain the contract node ids. */
export interface DraftEditorModel {
  schemaVersion: DraftAST["schemaVersion"];
  language: DraftAST["language"];
  title: string;
  claims: Claim[];
  sections: DraftEditorSection[];
}

export interface ParagraphLocation {
  claimId?: string;
  sectionKind?: SectionKind;
}

export interface DraftAstIssue {
  path: string;
  reason: string;
  nodeId: string | null;
  claimNumber: number | null;
  sectionKind: SectionKind | null;
}

export type DraftAstValidation =
  | { ok: true; ast: DraftAST }
  | { ok: false; issues: DraftAstIssue[] };

export interface SupportFactView {
  id: string;
  statement: string | null;
  status: Fact["status"] | null;
  sourceRefs: SourceRef[];
}

export interface SupportTableRow {
  claimId: string;
  claimNumber: number;
  featureId: string;
  featureText: string;
  factIds: string[];
  supportParagraphIds: string[];
  featureStatus: "supported" | "partial" | "unsupported";
  facts: SupportFactView[];
  sourceRefs: SourceRef[];
  priorityClaims: {
    country: string;
    applicationNumber: string;
    verification: "unverified" | "human_confirmed";
  }[];
}

/** A revision-bound source for downstream preview or export adapters. */
export interface DraftRevisionProjection {
  revisionId: string;
  snapshot: SnapshotRef;
  ast: DraftAST;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Draft paragraph insertion requires crypto.randomUUID().");
  }
  return globalThis.crypto.randomUUID();
}

/** Map a validated contract AST to all six editor sections without inventing AST nodes. */
export function draftAstToEditorModel(ast: DraftAST): DraftEditorModel {
  const parsed = draftAstSchema.parse(ast);
  const byKind = new Map(parsed.sections.map((section) => [section.kind, section]));
  return {
    schemaVersion: parsed.schemaVersion,
    language: parsed.language,
    title: parsed.title,
    claims: clone(parsed.claims),
    sections: SECTION_KINDS.map((kind) => {
      const section = byKind.get(kind);
      return {
        kind,
        present: section !== undefined,
        paragraphs: section ? clone(section.paragraphs) : [],
      };
    }),
  };
}

/** Convert the editor model back to DraftAST; omitted empty sections stay omitted. */
export function editorModelToDraftAst(model: DraftEditorModel): DraftAST {
  return {
    schemaVersion: model.schemaVersion,
    language: model.language,
    title: model.title,
    claims: clone(model.claims),
    sections: model.sections
      .filter((section) => section.present || section.paragraphs.length > 0)
      .map(({ kind, paragraphs }) => ({ kind, paragraphs: clone(paragraphs) })),
  };
}

function editedOrigin(origin: Paragraph["origin"]): Paragraph["origin"] {
  if (origin === "ai") return "mixed";
  if (origin === "legacy") return "human";
  return origin;
}

/** Return a copied model with one paragraph edited and its provenance updated. */
export function editParagraph(
  model: DraftEditorModel,
  location: ParagraphLocation,
  paragraphIndex: number,
  text: string,
): DraftEditorModel {
  const next = clone(model);
  const paragraphs = paragraphsAt(next, location);
  if (!paragraphs || !paragraphs[paragraphIndex]) return next;
  const paragraph = paragraphs[paragraphIndex];
  paragraphs[paragraphIndex] = {
    ...paragraph,
    text,
    origin: editedOrigin(paragraph.origin),
  };
  return next;
}

/** Insert a new, human-authored paragraph after `paragraphIndex` (-1 inserts first). */
export function insertParagraph(
  model: DraftEditorModel,
  location: ParagraphLocation,
  paragraphIndex: number,
  newId: () => string = randomId,
): DraftEditorModel {
  const next = clone(model);
  const paragraphs = paragraphsAt(next, location, true);
  if (!paragraphs) return next;
  const at = Math.max(0, Math.min(paragraphIndex + 1, paragraphs.length));
  paragraphs.splice(at, 0, {
    id: newId(),
    text: "",
    origin: "human",
    sourceRefs: [],
    factIds: [],
    figureIds: [],
    generationJobId: null,
  });
  return next;
}

/** Delete a paragraph from a copied model. The caller persists deletion as a revision. */
export function deleteParagraph(
  model: DraftEditorModel,
  location: ParagraphLocation,
  paragraphIndex: number,
): DraftEditorModel {
  const next = clone(model);
  const paragraphs = paragraphsAt(next, location);
  if (paragraphs && paragraphIndex >= 0 && paragraphIndex < paragraphs.length) {
    paragraphs.splice(paragraphIndex, 1);
  }
  return next;
}

function paragraphsAt(
  model: DraftEditorModel,
  location: ParagraphLocation,
  createSection = false,
): Paragraph[] | null {
  if (location.claimId) {
    return model.claims.find((claim) => claim.id === location.claimId)?.paragraphs ?? null;
  }
  if (location.sectionKind) {
    let section = model.sections.find((item) => item.kind === location.sectionKind);
    if (!section && createSection) {
      section = { kind: location.sectionKind, present: true, paragraphs: [] };
      model.sections.push(section);
    }
    if (!section) return null;
    section.present = true;
    return section.paragraphs;
  }
  return null;
}

/** Apply a claim number or dependency edit without mutating the prior model. */
export function editClaim(
  model: DraftEditorModel,
  claimId: string,
  change: Partial<Pick<Claim, "number" | "dependsOn">>,
): DraftEditorModel {
  return {
    ...clone(model),
    claims: model.claims.map((claim) => claim.id === claimId
      ? { ...clone(claim), ...clone(change) }
      : clone(claim)),
  };
}

/** Run the frozen DraftAST schema and translate each Zod path to its AST node. */
export function validateEditorModel(model: DraftEditorModel): DraftAstValidation {
  const ast = editorModelToDraftAst(model);
  const result = draftAstSchema.safeParse(ast);
  if (result.success) return { ok: true, ast: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => mapIssue(ast, issue.path, issue.message)) };
}

export function validateFigureReferences(ast: DraftAST, currentFigureIds: ReadonlySet<string>): DraftAstIssue[] {
  const issues: DraftAstIssue[] = [];
  const checkParagraph = (paragraph: Paragraph, path: (string | number)[]) => {
    for (const figureId of paragraph.figureIds) {
      if (!currentFigureIds.has(figureId)) {
        issues.push(mapIssue(ast, [...path, "figureIds"], `figureIds references unknown figure ${figureId}`));
      }
    }
  };
  for (const [claimIndex, claim] of ast.claims.entries()) {
    for (const [paragraphIndex, paragraph] of claim.paragraphs.entries()) {
      checkParagraph(paragraph, ["claims", claimIndex, "paragraphs", paragraphIndex]);
    }
  }
  for (const [sectionIndex, section] of ast.sections.entries()) {
    for (const [paragraphIndex, paragraph] of section.paragraphs.entries()) {
      checkParagraph(paragraph, ["sections", sectionIndex, "paragraphs", paragraphIndex]);
    }
  }
  return issues;
}

function mapIssue(ast: DraftAST, path: readonly (string | number)[], reason: string): DraftAstIssue {
  const issue: DraftAstIssue = {
    path: path.map(String).join("."),
    reason,
    nodeId: null,
    claimNumber: null,
    sectionKind: null,
  };
  if (path[0] === "claims" && typeof path[1] === "number") {
    const claim = ast.claims[path[1]];
    if (claim) {
      issue.claimNumber = claim.number;
      issue.nodeId = claim.id;
      if (path[2] === "paragraphs" && typeof path[3] === "number") {
        issue.nodeId = claim.paragraphs[path[3]]?.id ?? claim.id;
      } else if (path[2] === "features" && typeof path[3] === "number") {
        issue.nodeId = claim.features[path[3]]?.id ?? claim.id;
      }
    }
  } else if (path[0] === "sections" && typeof path[1] === "number") {
    const section = ast.sections[path[1]];
    if (section) {
      issue.sectionKind = section.kind;
      if (path[2] === "paragraphs" && typeof path[3] === "number") {
        issue.nodeId = section.paragraphs[path[3]]?.id ?? null;
      }
    }
  }
  return issue;
}

/** Build feature→fact/support/source trace rows from this AST and persisted facts. */
export function buildSupportTable(
  ast: DraftAST,
  facts: readonly Fact[] = [],
  priorityClaims: TargetConfig["priorityClaims"] = [],
): SupportTableRow[] {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const priority = priorityClaims.map((claim) => ({
    country: claim.country,
    applicationNumber: claim.applicationNumber,
    verification: claim.verification,
  }));
  return ast.claims.flatMap((claim) => claim.features.map((feature) => {
    const linkedFacts = feature.factIds.map((id) => factById.get(id)).filter((fact): fact is Fact => fact !== undefined);
    const refs = new Map<string, SourceRef>();
    for (const fact of linkedFacts) {
      for (const ref of fact.refs) refs.set(sourceRefKey(ref), clone(ref));
    }
    return {
      claimId: claim.id,
      claimNumber: claim.number,
      featureId: feature.id,
      featureText: feature.text,
      factIds: [...feature.factIds],
      supportParagraphIds: [...feature.supportParagraphIds],
      featureStatus: feature.status,
      facts: feature.factIds.map((id) => {
        const fact = factById.get(id);
        return {
          id,
          statement: fact?.statement ?? null,
          status: fact?.status ?? null,
          sourceRefs: fact ? clone(fact.refs) : [],
        };
      }),
      sourceRefs: [...refs.values()],
      priorityClaims: clone(priority),
    };
  }));
}

function sourceRefKey(ref: SourceRef): string {
  return `${ref.sourceId}/${ref.chunkId}/${ref.start}/${ref.end}/${ref.chunkHash}`;
}

/** Bind preview content to the exact new DraftRevision and its six-field snapshot. */
export function projectDraftRevision(revision: DraftRevision): DraftRevisionProjection {
  return {
    revisionId: revision.id,
    snapshot: {
      matterId: revision.matterId,
      targetId: revision.targetId,
      sourceVersion: revision.input.sourceVersion,
      targetConfigVersion: revision.input.targetConfigVersion,
      draftRevisionId: revision.id,
      figureRevisionId: revision.input.figureRevisionId,
    },
    ast: clone(revision.ast),
  };
}

/** Preview and export consumers receive the same revision-bound content projection. */
export function projectDraftPreview(revision: DraftRevision): DraftRevisionProjection {
  return projectDraftRevision(revision);
}

export function projectDraftExport(revision: DraftRevision): DraftRevisionProjection {
  return projectDraftRevision(revision);
}
