/**
 * V6-06 — the local repository (S06, 05-contracts §3–§5).
 *
 * One deep module owns every rule the browser needs before a matter reaches
 * storage: tenant scoping, the `expectedVersion` compare-and-swap, the archived
 * matter refusal, event ids that cannot be recorded twice, and blobs that must
 * hash to their recorded digest. It sits on a small `StorageBackend` seam so the
 * same rules run over IndexedDB in the browser and over an in-memory backend in
 * tests; the backend only learns `get`/`put`/`delete`/`getAll`/`getAllByIndex`
 * inside one transaction.
 *
 * The interface contract a caller must know:
 *
 * - A commit is all-or-nothing. The aggregate, its events and its blobs are
 *   written in one backend transaction; a refusal or a storage failure aborts
 *   it, and the previous version stays readable.
 * - `expectedVersion` 0 creates. Any other value updates: the stored version
 *   must equal it exactly, or the commit fails with `VERSION_CONFLICT` carrying
 *   the stored version. A commit never overwrites a newer write.
 * - A matter the actor cannot access does not exist for that actor: another
 *   tenant's matter, or a same-tenant matter the actor did not create (the R1
 *   local access rule; the cloud backend replaces it with tenant roles and the
 *   matter ACL), answers `RESOURCE_NOT_FOUND` from every read and write, never
 *   a hint that it exists.
 * - Identity comes from the verified actor, never from the payload: a create
 *   must name the acting user as `matter.createdBy`, an update cannot reassign
 *   it, and a user-kind event must record the acting user as its `actorId`.
 * - A record is written once. Repeating a commit whose event ids are already
 *   stored is refused, so a retried click cannot add a second event.
 * - An event may carry only the metadata keys its action allows (S06/C10), so
 *   document content cannot be stored through the activity seam.
 * - An asset's digest and length move only together with new bytes, and
 *   `readBlob` refuses bytes the matter's current asset record does not name.
 * - Records are validated for referential integrity here; contract shape (field
 *   names, enums, formats) is the contracts package's job at the process edge,
 *   and the V6-06 suite parses everything this module stores and returns.
 */

export const CONTRACT_VERSION = "v6.1" as const;

/** The stores a backend must provide. Events carry a `matterId` index. */
export const STORES = Object.freeze({
  matters: "matters",
  events: "events",
  blobs: "blobs",
} as const);

export type StoreName = (typeof STORES)[keyof typeof STORES];

export type StorageMode = "readonly" | "readwrite";

/**
 * The only surface a backend must satisfy. Values are structured-cloned on the
 * way in and out, so a caller cannot mutate stored state through a returned
 * object. `getAllByIndex` answers the values of `store` whose `index` property
 * equals `value`.
 */
export interface StorageTransaction {
  get(store: StoreName, key: string): Promise<unknown>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  getAll(store: StoreName): Promise<readonly unknown[]>;
  getAllByIndex(store: StoreName, index: string, value: string): Promise<readonly unknown[]>;
}

/**
 * A backend runs `run` inside one transaction. The transaction commits when
 * `run` resolves and the backend has nothing left to flush; if `run` throws or
 * rejects — including a refusal the repository raises — the backend aborts it
 * and nothing it wrote is visible afterwards. `run` may await requests on `tx`
 * and nothing else: a browser IndexedDB transaction auto-commits when the
 * event loop turns without a pending request, so work such as hashing happens
 * before the transaction opens.
 */
export interface StorageBackend {
  transaction<T>(mode: StorageMode, run: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  close(): void;
}

/** Tenant and user the request is made for. Never taken from the payload. */
export interface Actor {
  tenantId: string;
  userId: string;
}

/** 05-contracts §3 `Matter`, declared structurally (see the note in the receipt). */
export interface MatterRecord {
  id: string;
  tenantId: string;
  version: number;
  title: string;
  status: "active" | "archived" | "deletion_pending";
  sourceVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 05-contracts §3 `Target`. */
export interface TargetRecord {
  id: string;
  matterId: string;
  status: "active" | "archived";
  configVersion: number;
  draftRevisionId: string | null;
  figureRevisionId: string;
}

/** 05-contracts §3 `Asset`. */
export interface AssetRecord {
  id: string;
  tenantId: string;
  matterId: string | null;
  serviceOrderId: string | null;
  purpose: "source" | "drawing" | "receipt" | "review_attachment" | "service_attachment" | "export";
  originalName: string;
  mime: string;
  byteLength: number;
  sha256: string;
  state: "staging" | "available" | "quarantined" | "missing_bytes" | "purged";
  objectKey: string;
  createdAt: string;
}

/** 05-contracts §2 `SnapshotRef` — six fields, no defaults. */
export interface SnapshotRecord {
  matterId: string;
  targetId: string;
  sourceVersion: number;
  targetConfigVersion: number;
  draftRevisionId: string;
  figureRevisionId: string;
}

/** 05-contracts §3 `Activity`. Metadata carries IDs, counts and codes only. */
export interface ActivityRecord {
  id: string;
  tenantId: string;
  matterId: string | null;
  targetId: string | null;
  actorId: string | null;
  actorKind: "user" | "worker" | "webhook";
  action: string;
  snapshot: SnapshotRecord | null;
  jobId: string | null;
  resourceId: string;
  occurredAt: string;
  metadata: Readonly<Record<string, string | number | null>>;
}

/**
 * The §10 activity actions, mirrored from `packages/contracts/src/records.ts`.
 * A runtime dependency on the contracts package cannot be declared here (see
 * the receipt), so the suite compares these mirrors with the frozen contract.
 */
export const ACTIVITY_ACTIONS = Object.freeze([
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
] as const);
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_METADATA_KEYS = Object.freeze([
  "version", "count", "stage", "provider", "model", "errorCode",
] as const);
export type ActivityMetadataKey = (typeof ACTIVITY_METADATA_KEYS)[number];

/**
 * V6-03 decision (conservative per-action allowlist): each action may carry
 * only the keys below. Actions mapped to `[]` carry empty metadata. This is a
 * privacy rule (S06/C10), so the repository enforces it on every written event
 * rather than trusting the producer; document content must never reach a row.
 */
export const ACTIVITY_METADATA_KEYS_BY_ACTION: Readonly<
  Record<ActivityAction, readonly ActivityMetadataKey[]>
> = Object.freeze({
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

/** §10 error codes, mirrored for the `errorCode` metadata key. */
export const CONTRACT_ERROR_CODES = Object.freeze([
  "INVALID_INPUT", "INVALID_CURSOR", "AUTH_REQUIRED", "SESSION_EXPIRED", "CSRF_INVALID",
  "ACTION_FORBIDDEN", "ENTITLEMENT_REQUIRED", "CONSENT_REQUIRED", "CONSENT_REVOKED",
  "RESOURCE_NOT_FOUND", "VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_EXPIRED",
  "STALE_BINDING", "INPUT_STALE", "JOB_OBSOLETE", "INVALID_TRANSITION", "ALREADY_UNLOCKED",
  "FILE_TOO_LARGE", "IMAGE_TOO_LARGE", "PARSE_BUDGET_EXCEEDED", "UNSUPPORTED_MEDIA",
  "MIME_MISMATCH", "HASH_MISMATCH", "INVALID_AST", "SOURCE_LOCATOR_INVALID", "PARSE_FAILED",
  "OCR_UNAVAILABLE", "MISSING_BYTES", "BAD_DRAWING", "DUPLICATE_FIGURE_NUMBER", "GATE_BLOCKED",
  "CONFIRMATION_REQUIRED", "CHECK_REQUIRED", "APPROVAL_REQUIRED", "PAYMENT_MISMATCH",
  "IMPORT_INVALID", "RATE_LIMITED", "QUOTA_EXCEEDED", "CAPABILITY_UNAVAILABLE",
  "RELEASE_GATE_CLOSED", "FORMAT_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "STORAGE_UNAVAILABLE",
  "PROVIDER_AUTH", "PROVIDER_REJECTED", "PROVIDER_SCHEMA_INVALID", "PROVIDER_TIMEOUT",
  "JOB_LIMIT_EXCEEDED", "INTERNAL_ERROR",
] as const);
export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];

/** What one matter owns; the unit a single transaction writes. */
export interface MatterAggregate {
  matter: MatterRecord;
  targets: readonly TargetRecord[];
  assets: readonly AssetRecord[];
}

/** Bytes to store for an asset, with the digest the asset record already names. */
export interface BlobWrite {
  assetId: string;
  bytes: Uint8Array;
  sha256: string;
  byteLength: number;
}

/** The payload of a write command: one aggregate, its events and its blobs. */
export interface MatterWrite {
  matter: MatterRecord;
  targets: readonly TargetRecord[];
  assets: readonly AssetRecord[];
  events: readonly ActivityRecord[];
  blobs: readonly BlobWrite[];
}

/** 05-contracts §4 `Command<P>`: the actor, tenant and gate never come from here. */
export interface Command<P> {
  contractVersion: string;
  expectedVersion: number;
  payload: P;
}

/**
 * §10 codes this module can answer with. The suite parses each one against
 * `errorCodeSchema`, so a code the contract does not define cannot appear.
 */
export type RepositoryErrorCode =
  | "INVALID_INPUT"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_TRANSITION"
  | "QUOTA_EXCEEDED"
  | "STORAGE_UNAVAILABLE"
  | "HASH_MISMATCH";

export interface RepositoryError {
  code: RepositoryErrorCode;
  message: string;
  /** The stored version, on a `VERSION_CONFLICT` the caller can retry from. */
  latestVersion?: number;
}

export type RepositoryResult<T> = { ok: true; data: T } | { ok: false; error: RepositoryError };

/** 05-contracts §4 `Result<T>` for the commit this module performed. */
export interface CommitResult {
  data: MatterAggregate;
  version: number;
  eventIds: readonly string[];
  requestId: string;
}

export interface CommitOptions {
  requestId: string;
}

export interface ConfirmationLedgerBlob {
  matterId: string;
  confirmations: readonly unknown[];
  revocations: readonly unknown[];
}

export interface ConfirmationLedgerWriteResult {
  matter: MatterRecord;
  version: number;
  eventId: string;
}

export interface MatterRead {
  data: MatterAggregate;
  version: number;
}

export interface MatterList {
  items: readonly MatterAggregate[];
  nextCursor: null;
}

export interface EventList {
  items: readonly ActivityRecord[];
  nextCursor: null;
}

export interface BlobRead {
  data: {
    asset: AssetRecord;
    bytes: Uint8Array;
  };
}

interface StoredAggregate {
  matter: MatterRecord;
  targets: readonly TargetRecord[];
  assets: readonly AssetRecord[];
}

interface StoredBlob {
  asset: AssetRecord;
  matterId: string;
  tenantId: string;
  sha256: string;
  byteLength: number;
  bytes: Uint8Array;
}

/** A refusal raised inside a transaction; the backend aborts it and rethrows. */
class Refusal extends Error {
  readonly code: RepositoryErrorCode;
  readonly latestVersion?: number;

  constructor(code: RepositoryErrorCode, message: string, latestVersion?: number) {
    super(message);
    this.name = "Refusal";
    this.code = code;
    this.latestVersion = latestVersion;
  }
}

/** The runtime cannot do the work at all (no WebCrypto); nothing was written. */
class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityError";
  }
}

export class LocalRepository {
  readonly backend: StorageBackend;

  constructor(backend: StorageBackend) {
    this.backend = backend;
  }

  /**
   * Read one matter with its targets and assets. A matter the actor cannot
   * access — another tenant's, or a same-tenant matter the actor did not create
   * (the R1 local rule) — answers `RESOURCE_NOT_FOUND`, so a probe cannot tell
   * it apart from a missing one (S06-A05).
   */
  async loadMatter(actor: Actor, matterId: string): Promise<RepositoryResult<MatterRead>> {
    const problem = checkActor(actor) ?? checkKey(matterId);
    if (problem) return fail(problem);
    try {
      return await this.backend.transaction("readonly", async (tx) => {
        const aggregate = await readOwnedAggregate(tx, actor, matterId);
        return result({
          data: cloneAggregate(aggregate),
          version: aggregate.matter.version,
        });
      });
    } catch (error) {
      return fail(toRepositoryError(error));
    }
  }

  /**
   * The explicit archived-to-active transition (S06-A08). This is intentionally
   * separate from `commit`: ordinary writes to archived matters remain refused.
   * The activity whitelist has no unarchive action, so this writes only the
   * aggregate and emits no event or blob.
   */
  async unarchiveMatter(
    actor: Actor,
    command: { matterId: string; expectedVersion: number; updatedAt: string },
  ): Promise<RepositoryResult<{ matter: MatterRecord; version: number }>> {
    const problem = checkActor(actor) ?? checkKey(command?.matterId);
    if (problem) return fail(problem);
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) {
      return fail({ code: "INVALID_INPUT", message: "expectedVersion must be a non-negative integer" });
    }
    if (typeof command.updatedAt !== "string" || command.updatedAt.length === 0) {
      return fail({ code: "INVALID_INPUT", message: "updatedAt must be a non-empty timestamp" });
    }
    try {
      return await this.backend.transaction("readwrite", async (tx) => {
        const aggregate = asAggregate(await tx.get(STORES.matters, command.matterId));
        if (aggregate === null || !ownsMatter(aggregate.matter, actor)) {
          throw new Refusal("RESOURCE_NOT_FOUND", `matter ${command.matterId} not found`);
        }
        if (aggregate.matter.version !== command.expectedVersion) {
          throw new Refusal(
            "VERSION_CONFLICT",
            `matter ${command.matterId} is at version ${aggregate.matter.version}, not ${command.expectedVersion}`,
            aggregate.matter.version,
          );
        }
        if (aggregate.matter.status !== "archived") {
          throw new Refusal(
            "INVALID_TRANSITION",
            `matter ${command.matterId} is ${aggregate.matter.status}; only archived matters can be unarchived`,
          );
        }
        const matter: MatterRecord = {
          ...aggregate.matter,
          status: "active",
          version: command.expectedVersion + 1,
          updatedAt: command.updatedAt,
        };
        await tx.put(STORES.matters, command.matterId, {
          matter,
          targets: structuredClone(aggregate.targets),
          assets: structuredClone(aggregate.assets),
        } satisfies StoredAggregate);
        return result({ matter: structuredClone(matter), version: matter.version });
      });
    } catch (error) {
      return fail(toRepositoryError(error));
    }
  }

  /** The actor's matters, newest first; empty on a fresh local database. */
  async listMatters(actor: Actor): Promise<RepositoryResult<MatterList>> {
    const problem = checkActor(actor);
    if (problem) return fail(problem);
    try {
      return await this.backend.transaction("readonly", async (tx) => {
        const rows = await tx.getAll(STORES.matters);
        const items = rows
          .map(asAggregate)
          .filter((item): item is StoredAggregate => item !== null && ownsMatter(item.matter, actor))
          .sort((a, b) => b.matter.updatedAt.localeCompare(a.matter.updatedAt) || a.matter.id.localeCompare(b.matter.id))
          .map(cloneAggregate);
        return result({ items, nextCursor: null });
      });
    } catch (error) {
      return fail(toRepositoryError(error));
    }
  }

  /** The matter's activity, newest first (S06: `occurredAt desc`). */
  async listEvents(actor: Actor, matterId: string): Promise<RepositoryResult<EventList>> {
    const problem = checkActor(actor) ?? checkKey(matterId);
    if (problem) return fail(problem);
    try {
      return await this.backend.transaction("readonly", async (tx) => {
        // The matter is checked first so another tenant's activity is a 404,
        // not an empty feed that pretends the matter has no history.
        await readOwnedAggregate(tx, actor, matterId);
        const rows = await tx.getAllByIndex(STORES.events, "matterId", matterId);
        const items = rows
          .filter(isRecord)
          .filter((event) => event.tenantId === actor.tenantId && event.matterId === matterId)
          .map((event) => structuredClone(event) as unknown as ActivityRecord)
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
        return result({ items, nextCursor: null });
      });
    } catch (error) {
      return fail(toRepositoryError(error));
    }
  }

  /**
   * The stored bytes for an asset, re-hashed on the way out. Bytes whose digest
   * no longer matches the asset record are refused with `HASH_MISMATCH` rather
   * than handed to the page as if they were the document the record describes.
   */
  async readBlob(actor: Actor, assetId: string): Promise<RepositoryResult<BlobRead>> {
    const problem = checkActor(actor) ?? checkKey(assetId);
    if (problem) return fail(problem);
    let stored: StoredBlob;
    let asset: AssetRecord;
    try {
      const found = await this.backend.transaction("readonly", async (tx) => {
        const row = asBlob(await tx.get(STORES.blobs, assetId));
        if (!row || row.tenantId !== actor.tenantId || row.asset.id !== assetId) {
          throw new Refusal("RESOURCE_NOT_FOUND", `no stored bytes for asset ${assetId}`);
        }
        // The bytes are only the asset's bytes if the asset record the matter
        // currently carries still names the digest they were stored under.
        const aggregate = await readOwnedAggregate(tx, actor, row.matterId);
        const current = aggregate.assets.find((item) => item.id === assetId);
        if (!current) {
          throw new Refusal("RESOURCE_NOT_FOUND", `matter ${row.matterId} no longer carries asset ${assetId}`);
        }
        if (current.sha256 !== row.sha256 || current.byteLength !== row.byteLength) {
          throw new Refusal(
            "HASH_MISMATCH",
            `stored bytes for asset ${assetId} do not match the asset record`,
          );
        }
        return { stored: row, asset: structuredClone(current) };
      });
      stored = found.stored;
      asset = found.asset;
    } catch (error) {
      return fail(toRepositoryError(error));
    }
    try {
      const digest = await sha256Hex(stored.bytes);
      if (digest !== stored.sha256 || stored.bytes.byteLength !== stored.byteLength) {
        return fail({
          code: "HASH_MISMATCH",
          message: `stored bytes for asset ${assetId} do not match their digest`,
        });
      }
      return result({ data: { asset, bytes: new Uint8Array(stored.bytes) } });
    } catch (error) {
      return fail(toRepositoryError(error));
    }
  }

  /**
   * Write one version of a matter. The version is read inside the same
   * transaction that writes, so two tabs racing from the same version cannot
   * both succeed: the loser gets `VERSION_CONFLICT` with the winner's version.
   */
  async commit(
    actor: Actor,
    command: Command<MatterWrite>,
    options: CommitOptions,
  ): Promise<RepositoryResult<CommitResult>> {
    const problem = checkEnvelope(actor, command, options);
    if (problem) return fail(problem);
    const write = command.payload;
    const shape = checkWrite(actor, write);
    if (shape) return fail(shape);

    const nextVersion = command.expectedVersion + 1;
    if (write.matter.version !== nextVersion) {
      return fail({
        code: "INVALID_INPUT",
        message: `matter.version must be ${nextVersion} for expectedVersion ${command.expectedVersion}`,
      });
    }
    let hashes: RepositoryError | null;
    try {
      hashes = await checkBlobs(write);
    } catch (error) {
      return fail(toRepositoryError(error));
    }
    if (hashes) return fail(hashes);

    try {
      const committed = await this.backend.transaction("readwrite", async (tx) => {
        const existing = asAggregate(await tx.get(STORES.matters, write.matter.id));
        if (existing !== null && !ownsMatter(existing.matter, actor)) {
          throw new Refusal("RESOURCE_NOT_FOUND", `matter ${write.matter.id} not found`);
        }
        if (command.expectedVersion === 0) {
          if (existing !== null) {
            throw new Refusal(
              "VERSION_CONFLICT",
              `matter ${write.matter.id} already exists at version ${existing.matter.version}`,
              existing.matter.version,
            );
          }
          if (write.matter.createdBy !== actor.userId) {
            // Identity comes from the verified actor, never from the payload.
            throw new Refusal("INVALID_INPUT", "a create must record the acting user as matter.createdBy");
          }
        } else {
          if (existing === null) {
            throw new Refusal("RESOURCE_NOT_FOUND", `matter ${write.matter.id} not found`);
          }
          if (existing.matter.version !== command.expectedVersion) {
            throw new Refusal(
              "VERSION_CONFLICT",
              `matter ${write.matter.id} is at version ${existing.matter.version}, not ${command.expectedVersion}`,
              existing.matter.version,
            );
          }
          if (existing.matter.status !== "active") {
            // S06-A08: an archived matter is read-only until it is unarchived.
            throw new Refusal(
              "INVALID_TRANSITION",
              `matter ${write.matter.id} is ${existing.matter.status} and cannot be written`,
            );
          }
          if (write.matter.createdBy !== existing.matter.createdBy) {
            throw new Refusal("INVALID_INPUT", "matter.createdBy cannot be reassigned");
          }
        }

        // An asset's recorded digest may only move together with new bytes: a
        // digest change without a blob would leave bytes under the old digest
        // while the matter names the new one, so readBlob could not vouch for them.
        if (existing !== null) {
          const previous = new Map(existing.assets.map((asset) => [asset.id, asset]));
          for (const asset of write.assets) {
            const before = previous.get(asset.id);
            if (before === undefined) continue;
            if (before.sha256 === asset.sha256 && before.byteLength === asset.byteLength) continue;
            if (!write.blobs.some((blob) => blob.assetId === asset.id)) {
              throw new Refusal(
                "HASH_MISMATCH",
                `asset ${asset.id} changed its digest without new bytes`,
              );
            }
          }
        }

        for (const event of write.events) {
          // A recorded event id is never recorded twice: a retry after a lost
          // acknowledgement fails here instead of adding a second side effect.
          if ((await tx.get(STORES.events, event.id)) !== undefined) {
            throw new Refusal("INVALID_INPUT", `event ${event.id} is already recorded`);
          }
          // A user action is attributed to the verified actor, not to a name the
          // payload supplies; worker and webhook events may carry their own id.
          if (event.actorKind === "user" && event.actorId !== actor.userId) {
            throw new Refusal("INVALID_INPUT", `event ${event.id} must record the acting user`);
          }
        }

        await tx.put(STORES.matters, write.matter.id, {
          matter: structuredClone(write.matter),
          targets: structuredClone(write.targets),
          assets: structuredClone(write.assets),
        } satisfies StoredAggregate);
        for (const event of write.events) {
          await tx.put(STORES.events, event.id, structuredClone(event));
        }
        for (const blob of write.blobs) {
          const asset = write.assets.find((item) => item.id === blob.assetId) as AssetRecord;
          const stored: StoredBlob = {
            asset: structuredClone(asset),
            matterId: write.matter.id,
            tenantId: write.matter.tenantId,
            sha256: blob.sha256,
            byteLength: blob.byteLength,
            bytes: new Uint8Array(blob.bytes),
          };
          await tx.put(STORES.blobs, blob.assetId, stored);
        }

        return {
          data: cloneAggregate(write),
          version: nextVersion,
          eventIds: write.events.map((event) => event.id),
          requestId: options.requestId,
        } satisfies CommitResult;
      });
      return result(committed);
    } catch (error) {
      return fail(toRepositoryError(error));
    }
  }

  /**
   * Append one confirmation ledger state and its activity event while holding
   * the same matter-version compare-and-swap used by other writes (C03).
   * Confirmation records are feature-owned, so this narrow seam stores their
   * scoped blob without changing the general MatterWrite contract.
   */
  async writeConfirmationLedger(
    actor: Actor,
    matterId: string,
    expectedVersion: number,
    ledger: ConfirmationLedgerBlob,
    event: ActivityRecord,
    updatedAt: string,
  ): Promise<RepositoryResult<ConfirmationLedgerWriteResult>> {
    const problem = checkActor(actor) ?? checkKey(matterId);
    if (problem) return fail(problem);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return fail({ code: "INVALID_INPUT", message: "expectedVersion must be a persisted matter version" });
    }
    if (ledger?.matterId !== matterId || !Array.isArray(ledger.confirmations) || !Array.isArray(ledger.revocations)) {
      return fail({ code: "INVALID_INPUT", message: "confirmation ledger must belong to the requested matter" });
    }
    if (typeof updatedAt !== "string" || updatedAt.length === 0 || event?.occurredAt !== updatedAt) {
      return fail({ code: "INVALID_INPUT", message: "event time and updatedAt must match" });
    }
    if ((event.action !== "confirmation.created" && event.action !== "confirmation.revoked")
      || event.matterId !== matterId || event.tenantId !== actor.tenantId || event.actorId !== actor.userId
      || event.actorKind !== "user" || event.targetId === null || event.snapshot === null
      || event.snapshot.matterId !== matterId || event.snapshot.targetId !== event.targetId
      || event.metadata.count !== 1) {
      return fail({ code: "INVALID_INPUT", message: "confirmation event does not match the actor, matter and snapshot" });
    }
    const activityProblem = checkActivity(event);
    if (activityProblem) return fail(activityProblem);

    try {
      return await this.backend.transaction("readwrite", async (tx) => {
        const aggregate = asAggregate(await tx.get(STORES.matters, matterId));
        if (aggregate === null || !ownsMatter(aggregate.matter, actor)) {
          throw new Refusal("RESOURCE_NOT_FOUND", `matter ${matterId} not found`);
        }
        if (aggregate.matter.version !== expectedVersion) {
          throw new Refusal(
            "VERSION_CONFLICT",
            `matter ${matterId} is at version ${aggregate.matter.version}, not ${expectedVersion}`,
            aggregate.matter.version,
          );
        }
        if (aggregate.matter.status !== "active") {
          throw new Refusal("INVALID_TRANSITION", `matter ${matterId} is ${aggregate.matter.status} and cannot be written`);
        }
        const target = aggregate.targets.find((item) => item.id === event.targetId && item.matterId === matterId);
        if (!target) {
          throw new Refusal("RESOURCE_NOT_FOUND", `target ${event.targetId} not found`);
        }
        const eventSnapshot = event.snapshot;
        if (eventSnapshot === null) {
          throw new Refusal("INVALID_INPUT", `event ${event.id} must carry a snapshot`);
        }
        if (event.action === "confirmation.created") {
          if (eventSnapshot.sourceVersion !== aggregate.matter.sourceVersion
            || eventSnapshot.targetConfigVersion !== target.configVersion
            || eventSnapshot.draftRevisionId !== target.draftRevisionId
            || eventSnapshot.figureRevisionId !== target.figureRevisionId) {
            throw new Refusal("INVALID_TRANSITION", `confirmation event snapshot is not current for matter ${matterId}`);
          }
        } else {
          // §4: revocation appends a record and is not restricted to a current
          // snapshot. It must still name the confirmation row being revoked and
          // that row's exact SnapshotRef, so a stale or forged id cannot retire
          // a different confirmation.
          const confirmation = ledger.confirmations.find(
            (item) => isRecord(item) && item.id === event.resourceId,
          );
          if (!isRecord(confirmation) || typeof confirmation.id !== "string") {
            throw new Refusal("RESOURCE_NOT_FOUND", `confirmation ${event.resourceId} is not in this ledger`);
          }
          if (confirmation.actorId !== actor.userId) {
            throw new Refusal("INVALID_INPUT", `confirmation ${confirmation.id} belongs to another actor`);
          }
          if (!isRecord(confirmation.snapshot) || !sameSnapshotRecord(confirmation.snapshot, eventSnapshot)
            || confirmation.snapshot.matterId !== matterId || confirmation.snapshot.targetId !== target.id) {
            throw new Refusal("INVALID_INPUT", `confirmation ${confirmation.id} snapshot does not match the event`);
          }
          const revocation = ledger.revocations.find(
            (item) => isRecord(item) && item.objectType === "confirmation" && item.objectId === confirmation.id,
          );
          if (!isRecord(revocation)) {
            throw new Refusal("INVALID_INPUT", `confirmation ${confirmation.id} has no appended revocation`);
          }
          if (revocation.actorId !== actor.userId) {
            throw new Refusal("INVALID_INPUT", `revocation ${String(revocation.id)} belongs to another actor`);
          }
        }
        if ((await tx.get(STORES.events, event.id)) !== undefined) {
          throw new Refusal("INVALID_INPUT", `event ${event.id} is already recorded`);
        }

        const nextMatter: MatterRecord = {
          ...aggregate.matter,
          version: expectedVersion + 1,
          updatedAt,
        };
        await tx.put(STORES.matters, matterId, {
          matter: nextMatter,
          targets: structuredClone(aggregate.targets),
          assets: structuredClone(aggregate.assets),
        } satisfies StoredAggregate);
        await tx.put(STORES.events, event.id, structuredClone(event));
        await tx.put(STORES.blobs, confirmationLedgerKey(actor, matterId), {
          kind: "draft-review.confirmations",
          tenantId: actor.tenantId,
          actorId: actor.userId,
          matterId,
          ledger: structuredClone(ledger),
        });
        return result({ matter: structuredClone(nextMatter), version: nextMatter.version, eventId: event.id });
      });
    } catch (error) {
      return fail(toRepositoryError(error));
    }
  }

  /** Detach from the backend. A closed backend refuses further work. */
  close(): void {
    this.backend.close();
  }
}

export function openLocalRepository(backend: StorageBackend): LocalRepository {
  return new LocalRepository(backend);
}

/** Lowercase hex SHA-256 of `bytes`, the digest form `Asset.sha256` stores. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new CapabilityError("WebCrypto is unavailable; bytes cannot be verified");
  const digest = await subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function result<T>(data: T): RepositoryResult<T> {
  return { ok: true, data };
}

function fail(error: RepositoryError): RepositoryResult<never> {
  return { ok: false, error };
}

/**
 * Any failure that is not a repository refusal is a backend failure. A quota
 * exhaustion is the one the page must name differently from a broken database,
 * so it keeps its own code; everything else is `STORAGE_UNAVAILABLE`.
 */
function toRepositoryError(error: unknown): RepositoryError {
  if (error instanceof Refusal) {
    return error.latestVersion === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, latestVersion: error.latestVersion };
  }
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  if (name === "CapabilityError") {
    return { code: "STORAGE_UNAVAILABLE", message: error instanceof Error ? error.message : String(error) };
  }
  if (name === "QuotaExceededError") {
    return { code: "QUOTA_EXCEEDED", message: "local storage is full; free space and retry" };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "STORAGE_UNAVAILABLE", message: `local storage failed: ${message}` };
}

function checkActor(actor: Actor): RepositoryError | null {
  if (!isText(actor?.tenantId) || !isText(actor?.userId)) {
    return { code: "INVALID_INPUT", message: "actor must name a tenant and a user" };
  }
  return null;
}

function checkKey(key: unknown): RepositoryError | null {
  return isText(key) ? null : { code: "INVALID_INPUT", message: "id must be a non-empty string" };
}

function checkEnvelope(actor: Actor, command: Command<MatterWrite>, options: CommitOptions): RepositoryError | null {
  const actorProblem = checkActor(actor);
  if (actorProblem) return actorProblem;
  if (command?.contractVersion !== CONTRACT_VERSION) {
    return { code: "INVALID_INPUT", message: `contractVersion must be ${CONTRACT_VERSION}` };
  }
  if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) {
    return { code: "INVALID_INPUT", message: "expectedVersion must be a non-negative integer" };
  }
  if (!isText(options?.requestId)) {
    return { code: "INVALID_INPUT", message: "requestId must be a non-empty string" };
  }
  if (typeof command.payload !== "object" || command.payload === null) {
    return { code: "INVALID_INPUT", message: "payload must be a matter write" };
  }
  return null;
}

/**
 * Referential integrity of one write: every row points at this matter and this
 * tenant, ids do not collide inside the batch, and every blob names an asset the
 * same write carries.
 */
function checkWrite(actor: Actor, write: MatterWrite): RepositoryError | null {
  const matter = write.matter;
  if (!isText(matter?.id) || !isText(matter.tenantId)) {
    return { code: "INVALID_INPUT", message: "matter must carry its id and tenant" };
  }
  if (matter.tenantId !== actor.tenantId) {
    return { code: "RESOURCE_NOT_FOUND", message: `matter ${matter.id} not found` };
  }
  if (!Array.isArray(write.targets) || !Array.isArray(write.assets) || !Array.isArray(write.events) || !Array.isArray(write.blobs)) {
    return { code: "INVALID_INPUT", message: "a write must carry targets, assets, events and blobs" };
  }

  const targetIds = new Set<string>();
  for (const target of write.targets) {
    if (!isText(target?.id) || target.matterId !== matter.id) {
      return { code: "INVALID_INPUT", message: "every target must belong to the written matter" };
    }
    if (targetIds.has(target.id)) return { code: "INVALID_INPUT", message: `target ${target.id} is listed twice` };
    targetIds.add(target.id);
  }

  const assetIds = new Set<string>();
  for (const asset of write.assets) {
    if (!isText(asset?.id) || asset.matterId !== matter.id || asset.tenantId !== matter.tenantId) {
      return { code: "INVALID_INPUT", message: "every asset must belong to the written matter and tenant" };
    }
    if (assetIds.has(asset.id)) return { code: "INVALID_INPUT", message: `asset ${asset.id} is listed twice` };
    assetIds.add(asset.id);
  }

  const eventIds = new Set<string>();
  for (const event of write.events) {
    if (!isText(event?.id) || event.matterId !== matter.id || event.tenantId !== matter.tenantId) {
      return { code: "INVALID_INPUT", message: "every event must belong to the written matter and tenant" };
    }
    if (eventIds.has(event.id)) return { code: "INVALID_INPUT", message: `event ${event.id} is listed twice` };
    eventIds.add(event.id);
    // S06/C10: an event may carry only the action's whitelisted metadata, so
    // document content cannot be stored through this seam.
    const activityProblem = checkActivity(event);
    if (activityProblem) return activityProblem;
  }

  const blobIds = new Set<string>();
  for (const blob of write.blobs) {
    if (!isText(blob?.assetId) || !assetIds.has(blob.assetId)) {
      return { code: "INVALID_INPUT", message: "every blob must name an asset the write carries" };
    }
    if (blobIds.has(blob.assetId)) {
      return { code: "INVALID_INPUT", message: `blob ${blob.assetId} is listed twice` };
    }
    blobIds.add(blob.assetId);
  }
  return null;
}

/** Bytes must be the asset's bytes: length, declared digest and real digest. */
async function checkBlobs(write: MatterWrite): Promise<RepositoryError | null> {
  for (const blob of write.blobs) {
    const asset = write.assets.find((item) => item.id === blob.assetId) as AssetRecord;
    if (!(blob.bytes instanceof Uint8Array)) {
      return { code: "INVALID_INPUT", message: `blob ${blob.assetId} must carry Uint8Array bytes` };
    }
    if (blob.bytes.byteLength !== blob.byteLength || asset.byteLength !== blob.byteLength) {
      return { code: "INVALID_INPUT", message: `blob ${blob.assetId} length does not match the asset` };
    }
    if (blob.sha256 !== asset.sha256) {
      return { code: "HASH_MISMATCH", message: `blob ${blob.assetId} digest does not match the asset` };
    }
    if ((await sha256Hex(blob.bytes)) !== blob.sha256) {
      return { code: "HASH_MISMATCH", message: `blob ${blob.assetId} bytes do not hash to the recorded digest` };
    }
  }
  return null;
}

const ACTIVITY_ACTION_SET: ReadonlySet<string> = new Set(ACTIVITY_ACTIONS);
const CONTRACT_ERROR_CODE_SET: ReadonlySet<string> = new Set(CONTRACT_ERROR_CODES);
const STAGE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * The action must be in the §10 whitelist and its metadata may carry only that
 * action's keys, with the contract's value grammar. A caller cannot smuggle
 * document content into an event through an unexpected key or a free-text value.
 */
function checkActivity(event: ActivityRecord): RepositoryError | null {
  const action = event.action;
  if (typeof action !== "string" || !ACTIVITY_ACTION_SET.has(action)) {
    return { code: "INVALID_INPUT", message: `activity action ${String(action)} is not in the §10 whitelist` };
  }
  const metadata = event.metadata;
  if (!isRecord(metadata) || Array.isArray(metadata)) {
    return { code: "INVALID_INPUT", message: `event ${event.id} metadata must be an object` };
  }
  const allowed = new Set(ACTIVITY_METADATA_KEYS_BY_ACTION[action as ActivityAction]);
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowed.has(key as ActivityMetadataKey)) {
      return { code: "INVALID_INPUT", message: `metadata key ${key} is not allowed for ${action}` };
    }
    const problem = checkMetadataValue(key as ActivityMetadataKey, value);
    if (problem) return { code: "INVALID_INPUT", message: `metadata.${key} for ${action} ${problem}` };
  }
  if (action === "job.succeeded" || action === "job.adopted") {
    for (const key of ["provider", "model"]) {
      const value = metadata[key];
      if (value === undefined || value === null) {
        return { code: "INVALID_INPUT", message: `${key} is required for ${action}` };
      }
    }
  }
  return null;
}

function checkMetadataValue(key: ActivityMetadataKey, value: unknown): string | null {
  switch (key) {
    case "version":
    case "count":
      return Number.isSafeInteger(value) && (value as number) >= 0 ? null : "must be a non-negative integer";
    case "stage":
      return typeof value === "string" && STAGE_PATTERN.test(value) ? null : "must be a lowercase stage token";
    case "provider":
    case "model":
      if (value === null) return null;
      return typeof value === "string" && NAME_PATTERN.test(value) ? null : "must be a processor/model name or null";
    case "errorCode":
      return typeof value === "string" && CONTRACT_ERROR_CODE_SET.has(value) ? null : "must be a §10 error code";
    default:
      return "is not a known metadata key";
  }
}

async function readOwnedAggregate(
  tx: StorageTransaction,
  actor: Actor,
  matterId: string,
): Promise<StoredAggregate> {
  const aggregate = asAggregate(await tx.get(STORES.matters, matterId));
  if (aggregate === null || !ownsMatter(aggregate.matter, actor)) {
    throw new Refusal("RESOURCE_NOT_FOUND", `matter ${matterId} not found`);
  }
  return aggregate;
}

/**
 * The R1 local access rule: a matter belongs to the user who created it. The
 * contract's tenant roles and per-matter ACL need membership data that this
 * ticket's write set does not carry; the cloud backend implements them.
 */
function ownsMatter(matter: MatterRecord, actor: Actor): boolean {
  return matter.tenantId === actor.tenantId && matter.createdBy === actor.userId;
}

function asAggregate(value: unknown): StoredAggregate | null {
  if (!isRecord(value)) return null;
  const candidate = value as { matter?: unknown; targets?: unknown; assets?: unknown };
  if (!isRecord(candidate.matter)) return null;
  if (!Array.isArray(candidate.targets) || !Array.isArray(candidate.assets)) return null;
  return value as unknown as StoredAggregate;
}

function asBlob(value: unknown): StoredBlob | null {
  if (!isRecord(value)) return null;
  const candidate = value as { asset?: unknown; bytes?: unknown; tenantId?: unknown; sha256?: unknown; byteLength?: unknown };
  if (!isRecord(candidate.asset)) return null;
  if (!(candidate.bytes instanceof Uint8Array)) return null;
  if (!isText(candidate.tenantId) || !isText(candidate.sha256) || typeof candidate.byteLength !== "number") return null;
  return value as unknown as StoredBlob;
}

function cloneAggregate(aggregate: StoredAggregate): StoredAggregate {
  return {
    matter: structuredClone(aggregate.matter),
    targets: aggregate.targets.map((target) => structuredClone(target)),
    assets: aggregate.assets.map((asset) => structuredClone(asset)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function confirmationLedgerKey(actor: Actor, matterId: string): string {
  return `draft-review/confirmations/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}`;
}

function sameSnapshotRecord(a: Record<string, unknown>, b: SnapshotRecord): boolean {
  return a.matterId === b.matterId
    && a.targetId === b.targetId
    && a.sourceVersion === b.sourceVersion
    && a.targetConfigVersion === b.targetConfigVersion
    && a.draftRevisionId === b.draftRevisionId
    && a.figureRevisionId === b.figureRevisionId;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
