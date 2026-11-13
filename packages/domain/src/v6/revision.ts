/**
 * V6-04 — targets and immutable draft revisions.
 *
 * Implements the revision rules from 05-contracts C01/C03 and S05: revisions are
 * append-only and per target, `sourceVersion` belongs to the matter, restoring a
 * revision copies it instead of reviving the old approvals, and `isCurrent`
 * compares every SnapshotRef field.
 *
 * Every export is a pure transition: it takes the current aggregate state and
 * returns a new one. Nothing here writes storage, reads the clock or allocates
 * ambient IDs — the caller injects both, so the same input always produces the
 * same output (V6-04-A03). A refused command returns the input state unchanged.
 */

/** 05-contracts §2 `SnapshotRef`; every field is required and never defaulted. */
export interface SnapshotRef {
  matterId: string;
  targetId: string;
  sourceVersion: number;
  targetConfigVersion: number;
  draftRevisionId: string;
  figureRevisionId: string;
}

/** 05-contracts §2 `DraftInputRef` — the snapshot minus the draft revision. */
export type DraftInputRef = Omit<SnapshotRef, "draftRevisionId">;

/** 05-contracts §4 `DraftRevision.reason`. */
export type RevisionReason =
  | "generated"
  | "edited"
  | "adopted_inputs"
  | "restored"
  | "review_accepted"
  | "imported";

/** Reasons a caller may hand to `saveRevision`; `restored` has its own command. */
export const SAVE_REASONS = ["generated", "edited", "review_accepted", "imported"] as const;
export type SaveReason = (typeof SAVE_REASONS)[number];

/** S05 recovery strategies: rebind figures to the restored revision or keep the current set. */
export const FIGURE_STRATEGIES = ["restore_bound", "keep_current"] as const;
export type FigureStrategy = (typeof FIGURE_STRATEGIES)[number];

/**
 * A draft revision. `ast` stays opaque here: the contract schema validates its
 * shape at the boundary, and this module owns ordering, parents and staleness.
 */
export interface RevisionRecord<Ast> {
  id: string;
  matterId: string;
  targetId: string;
  parentId: string | null;
  input: DraftInputRef;
  ast: Ast;
  astHash: string;
  reason: RevisionReason;
  restoredFrom: string | null;
  /** Test-origin marker is inherited through every revision transition. */
  testOutput?: boolean;
  createdBy: string;
  createdAt: string;
}

/**
 * A figure set revision (05-contracts §3). `entries` stay opaque for the same
 * reason the draft AST does: `figureSetRevisionSchema` owns their shape.
 */
export interface FigureSetRevision<Figure> {
  id: string;
  matterId: string;
  targetId: string;
  parentId: string | null;
  entries: readonly Figure[];
  hash: string;
  createdAt: string;
}

export interface TargetRevisions<Ast, Figure = unknown> {
  targetId: string;
  status: "active" | "archived";
  configVersion: number;
  /** The figure set the next revision binds to. */
  figureRevisionId: string;
  /** Append-only, oldest first. A restore_bound copies the set it restores from. */
  figureSets: readonly FigureSetRevision<Figure>[];
  headRevisionId: string | null;
  /** Append-only, oldest first. Never reordered or rewritten. */
  revisions: readonly RevisionRecord<Ast>[];
}

/** Aggregate root. `sourceVersion` is shared by every target of the matter (C01). */
export interface MatterRevisions<Ast, Figure = unknown> {
  matterId: string;
  sourceVersion: number;
  targets: Readonly<Record<string, TargetRevisions<Ast, Figure>>>;
}

/** Injected determinism: the only sources of IDs and time. */
export interface RevisionContext {
  newId: (label: string) => string;
  now: () => string;
  actorId: string;
}

export type RevisionErrorCode =
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_TRANSITION"
  | "INVALID_INPUT"
  | "INPUT_STALE";

export interface RevisionError {
  code: RevisionErrorCode;
  message: string;
  /** Candidate the caller must merge against; set for VERSION_CONFLICT. */
  latestRevisionId?: string;
  fields?: readonly { path: string; reason: string }[];
}

export interface FigureOutcome<Figure = unknown> {
  strategy: FigureStrategy | "unchanged";
  figureRevisionId: string;
  /** The figure set revision created by `restore_bound`; null when none was created. */
  figureRevision: FigureSetRevision<Figure> | null;
  /** True exactly when this transition appended a figure set revision. */
  created: boolean;
  /** keep_current only: the restored draft and the current figures come from different sets. */
  figureMismatch: boolean;
}

export type RevisionOutcome<Ast, Figure = unknown> =
  | {
      ok: true;
      state: MatterRevisions<Ast, Figure>;
      revision: RevisionRecord<Ast>;
      snapshot: SnapshotRef;
      figure: FigureOutcome<Figure>;
    }
  | { ok: false; error: RevisionError; state: MatterRevisions<Ast, Figure> };

export interface SaveRevisionCommand<Ast> {
  targetId: string;
  /** `null` creates the first revision of a target that has none. */
  baseRevisionId: string | null;
  ast: Ast;
  astHash: string;
  reason: SaveReason;
  /** Marks initial local test output; edits/restores/input adoption inherit the marker. */
  testOutput?: boolean;
  /** Only a full generated replacement from a provider can start fresh provenance. Never used for editing. */
  generationExecution?: "provider" | "stub";
  /** Defaults to the base revision's input; may not point past the matter sourceVersion. */
  input?: DraftInputRef;
}

export interface RestoreRevisionCommand {
  targetId: string;
  revisionId: string;
  figureStrategy: FigureStrategy;
}

export interface AdoptInputsCommand {
  targetId: string;
  baseRevisionId: string;
  /** S05 核对后采纳新输入: the user must tick the review acknowledgement. */
  acknowledgedInputReview: boolean;
}

/** §2: `isCurrent` compares every SnapshotRef field. */
export function isCurrent(a: SnapshotRef, b: SnapshotRef): boolean {
  return (
    a.matterId === b.matterId &&
    a.targetId === b.targetId &&
    a.sourceVersion === b.sourceVersion &&
    a.targetConfigVersion === b.targetConfigVersion &&
    a.draftRevisionId === b.draftRevisionId &&
    a.figureRevisionId === b.figureRevisionId
  );
}

/** C01: a draft is stale when the input it adopted differs from the current input. */
export function isInputStale(input: DraftInputRef, current: DraftInputRef): boolean {
  return !(
    input.matterId === current.matterId &&
    input.targetId === current.targetId &&
    input.sourceVersion === current.sourceVersion &&
    input.targetConfigVersion === current.targetConfigVersion &&
    input.figureRevisionId === current.figureRevisionId
  );
}

/** The six-field reference a revision currently corresponds to, or `null` with no draft. */
export function currentSnapshot<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  targetId: string,
): SnapshotRef | null {
  const target = state.targets[targetId];
  if (!target || target.headRevisionId === null) return null;
  const revision = target.revisions.find((item) => item.id === target.headRevisionId);
  return revision ? snapshotOf(revision) : null;
}

export function snapshotOf<Ast>(revision: RevisionRecord<Ast>): SnapshotRef {
  return {
    matterId: revision.matterId,
    targetId: revision.targetId,
    sourceVersion: revision.input.sourceVersion,
    targetConfigVersion: revision.input.targetConfigVersion,
    draftRevisionId: revision.id,
    figureRevisionId: revision.input.figureRevisionId,
  };
}

/** The input a target would adopt right now: current source, config and figure set. */
export function currentInput<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  targetId: string,
): DraftInputRef | null {
  const target = state.targets[targetId];
  if (!target) return null;
  return {
    matterId: state.matterId,
    targetId,
    sourceVersion: state.sourceVersion,
    targetConfigVersion: target.configVersion,
    figureRevisionId: target.figureRevisionId,
  };
}

/**
 * Append a generated, edited, reviewed or imported revision.
 * Refuses a base that is not the target's head, so a stale editor cannot
 * silently overwrite a newer revision (S05-A04 `VERSION_CONFLICT`).
 */
export function saveRevision<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  command: SaveRevisionCommand<Ast>,
  context: RevisionContext,
): RevisionOutcome<Ast, Figure> {
  const entered = requireWritableTarget(state, command.targetId);
  if (!entered.ok) return entered;
  const { target } = entered;

  if (!(SAVE_REASONS as readonly string[]).includes(command.reason)) {
    return fail(state, "INVALID_INPUT", `saveRevision does not accept reason ${String(command.reason)}`, [
      { path: "reason", reason: "use restoreRevision for restored drafts" },
    ]);
  }
  if (command.baseRevisionId !== target.headRevisionId) {
    return conflict(state, target);
  }

  const base = command.baseRevisionId === null ? null : target.revisions.find((item) => item.id === command.baseRevisionId);
  if (command.baseRevisionId !== null && !base) {
    return fail(state, "VERSION_CONFLICT", `base revision ${command.baseRevisionId} is not a revision of this target`, undefined, target.headRevisionId ?? undefined);
  }

  const input = command.input ?? base?.input ?? currentInput(state, command.targetId);
  if (!input) return fail(state, "RESOURCE_NOT_FOUND", `unknown target ${command.targetId}`);
  if (input.matterId !== state.matterId || input.targetId !== command.targetId) {
    return fail(state, "INVALID_INPUT", "input must belong to the same matter and target", [
      { path: "input", reason: "matterId and targetId must match the target being written" },
    ]);
  }
  if (input.sourceVersion > state.sourceVersion) {
    return fail(state, "INPUT_STALE", `input sourceVersion ${input.sourceVersion} is newer than the matter`, [
      { path: "input.sourceVersion", reason: `latest available is ${state.sourceVersion}` },
    ]);
  }

  const freshProviderDraft = command.reason === "generated" && command.generationExecution === "provider";
  const testOutput = command.testOutput === true || (!freshProviderDraft && base?.testOutput === true);
  const revision: RevisionRecord<Ast> = {
    id: context.newId("draft-revision"),
    matterId: state.matterId,
    targetId: command.targetId,
    parentId: command.baseRevisionId,
    input: { ...input },
    ast: copyOf(command.ast),
    astHash: command.astHash,
    reason: command.reason,
    restoredFrom: null,
    ...(testOutput ? { testOutput: true } : {}),
    createdBy: context.actorId,
    createdAt: context.now(),
  };

  return accepted(state, target, revision, {
    strategy: "unchanged",
    figureRevisionId: target.figureRevisionId,
    figureRevision: null,
    figureMismatch: false,
  });
}

/**
 * Restore an earlier revision by copying it into a new revision (S05-A05).
 * The copy is a new snapshot, so confirmations and approvals bound to the old
 * revision are not current afterwards — they are never resurrected.
 */
export function restoreRevision<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  command: RestoreRevisionCommand,
  context: RevisionContext,
): RevisionOutcome<Ast, Figure> {
  const entered = requireWritableTarget(state, command.targetId);
  if (!entered.ok) return entered;
  const { target } = entered;

  const source = target.revisions.find((item) => item.id === command.revisionId);
  if (!source) {
    // A revision of another matter or target is not addressable here: 404, not 403.
    return fail(state, "RESOURCE_NOT_FOUND", `revision ${command.revisionId} is not part of target ${command.targetId}`);
  }
  const parent = target.headRevisionId === null ? null : target.revisions.find((item) => item.id === target.headRevisionId) ?? null;
  const testOutput = source.testOutput === true || parent?.testOutput === true;
  if (!(FIGURE_STRATEGIES as readonly string[]).includes(command.figureStrategy)) {
    return fail(state, "INVALID_INPUT", `unknown figure strategy ${String(command.figureStrategy)}`, [
      { path: "figureStrategy", reason: `expected one of ${FIGURE_STRATEGIES.join(", ")}` },
    ]);
  }

  const restoreBound = command.figureStrategy === "restore_bound";
  let figureRevision: FigureSetRevision<Figure> | null = null;
  let figureRevisionId = target.figureRevisionId;

  if (restoreBound) {
    // The restored draft must be shown against the figures it was written for.
    const sourceSet = target.figureSets.find((item) => item.id === source.input.figureRevisionId);
    if (!sourceSet) {
      return fail(
        state,
        "RESOURCE_NOT_FOUND",
        `figure set ${source.input.figureRevisionId} bound to ${source.id} is not retained for target ${command.targetId}`,
      );
    }
    // A new revision over the same entries: the restored draft and the current
    // figures stay separately reviewable, and the previous sets are never edited.
    // The copied entries are the source set's entries verbatim, so its
    // content-addressed hash still describes them.
    figureRevision = {
      id: context.newId("figure-set"),
      matterId: state.matterId,
      targetId: command.targetId,
      parentId: target.figureRevisionId,
      entries: copyOf(sourceSet.entries),
      hash: sourceSet.hash,
      createdAt: context.now(),
    };
    figureRevisionId = figureRevision.id;
  }

  const revision: RevisionRecord<Ast> = {
    id: context.newId("draft-revision"),
    matterId: state.matterId,
    targetId: command.targetId,
    parentId: target.headRevisionId,
    input: { ...source.input, figureRevisionId },
    ast: copyOf(source.ast),
    astHash: source.astHash,
    reason: "restored",
    restoredFrom: source.id,
    ...(testOutput ? { testOutput: true } : {}),
    createdBy: context.actorId,
    createdAt: context.now(),
  };

  return accepted(state, target, revision, {
    strategy: command.figureStrategy,
    figureRevisionId,
    figureRevision,
    // restore_bound rebuilds the set the draft was written against, so only
    // keep_current can leave the draft and the figures on different sets.
    figureMismatch: command.figureStrategy === "keep_current" && source.input.figureRevisionId !== target.figureRevisionId,
  });
}

/**
 * 「核对后采纳新输入」 (S05-A06): adopt the current input without changing the AST.
 * The acknowledgement is a command field, not a UI state: without it the command
 * is refused. Confirmations do not carry over because the result is a new revision.
 */
export function adoptInputs<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  command: AdoptInputsCommand,
  context: RevisionContext,
): RevisionOutcome<Ast, Figure> {
  const entered = requireWritableTarget(state, command.targetId);
  if (!entered.ok) return entered;
  const { target } = entered;

  if (command.acknowledgedInputReview !== true) {
    return fail(state, "INVALID_INPUT", "adopting new inputs requires the核对 acknowledgement", [
      { path: "acknowledgedInputReview", reason: "the user must confirm the new facts were checked" },
    ]);
  }
  if (command.baseRevisionId !== target.headRevisionId) {
    return conflict(state, target);
  }

  const base = target.revisions.find((item) => item.id === command.baseRevisionId);
  if (!base) {
    return fail(state, "VERSION_CONFLICT", `base revision ${command.baseRevisionId} is not the target head`, undefined, target.headRevisionId ?? undefined);
  }
  const input = currentInput(state, command.targetId);
  if (!input) return fail(state, "RESOURCE_NOT_FOUND", `unknown target ${command.targetId}`);
  const testOutput = base.testOutput === true;

  const revision: RevisionRecord<Ast> = {
    id: context.newId("draft-revision"),
    matterId: state.matterId,
    targetId: command.targetId,
    parentId: base.id,
    input,
    ast: copyOf(base.ast),
    astHash: base.astHash,
    reason: "adopted_inputs",
    restoredFrom: null,
    ...(testOutput ? { testOutput: true } : {}),
    createdBy: context.actorId,
    createdAt: context.now(),
  };

  return accepted(state, target, revision, {
    strategy: "unchanged",
    figureRevisionId: input.figureRevisionId,
    figureRevision: null,
    figureMismatch: false,
  });
}

/**
 * Switching the visible target is a read. It returns the same state so a view
 * change can never bump a version (S05 / V6-04-A02).
 */
export function switchTargetView<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  targetId: string,
):
  | { ok: true; state: MatterRevisions<Ast, Figure>; target: TargetRevisions<Ast, Figure> }
  | { ok: false; error: RevisionError; state: MatterRevisions<Ast, Figure> } {
  const target = state.targets[targetId];
  if (!target) return fail(state, "RESOURCE_NOT_FOUND", `unknown target ${targetId}`);
  return { ok: true, state, target };
}

function requireWritableTarget<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  targetId: string,
):
  | { ok: true; target: TargetRevisions<Ast, Figure> }
  | { ok: false; error: RevisionError; state: MatterRevisions<Ast, Figure> } {
  const target = state.targets[targetId];
  if (!target) return fail(state, "RESOURCE_NOT_FOUND", `unknown target ${targetId}`);
  if (target.status === "archived") {
    return fail(state, "INVALID_TRANSITION", `target ${targetId} is archived; unarchive it before writing`);
  }
  return { ok: true, target };
}

function conflict<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  target: TargetRevisions<Ast, Figure>,
): { ok: false; error: RevisionError; state: MatterRevisions<Ast, Figure> } {
  return fail(
    state,
    "VERSION_CONFLICT",
    "the base revision is no longer the target head; reload and merge before saving",
    undefined,
    target.headRevisionId ?? undefined,
  );
}

function fail<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  code: RevisionErrorCode,
  message: string,
  fields?: readonly { path: string; reason: string }[],
  latestRevisionId?: string,
): { ok: false; error: RevisionError; state: MatterRevisions<Ast, Figure> } {
  const error: RevisionError = { code, message };
  if (fields) error.fields = fields;
  if (latestRevisionId !== undefined) error.latestRevisionId = latestRevisionId;
  return { ok: false, error, state };
}

function accepted<Ast, Figure = unknown>(
  state: MatterRevisions<Ast, Figure>,
  target: TargetRevisions<Ast, Figure>,
  revision: RevisionRecord<Ast>,
  figure: Omit<FigureOutcome<Figure>, "created">,
): RevisionOutcome<Ast, Figure> {
  const nextTarget: TargetRevisions<Ast, Figure> = {
    ...target,
    headRevisionId: revision.id,
    figureRevisionId: figure.figureRevisionId,
    figureSets: figure.figureRevision ? [...target.figureSets, figure.figureRevision] : target.figureSets,
    revisions: [...target.revisions, revision],
  };
  return {
    ok: true,
    state: { ...state, targets: { ...state.targets, [target.targetId]: nextTarget } },
    revision,
    snapshot: snapshotOf(revision),
    figure: { ...figure, created: figure.figureRevision !== null },
  };
}

/** Copy an AST so a restored revision never aliases the revision it was copied from. */
function copyOf<Ast>(ast: Ast): Ast {
  return typeof structuredClone === "function" ? structuredClone(ast) : JSON.parse(JSON.stringify(ast));
}
