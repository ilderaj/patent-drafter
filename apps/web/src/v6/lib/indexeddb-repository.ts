/**
 * V6-06 — the IndexedDB adapter for the local repository.
 *
 * This module is the browser end of the `StorageBackend` seam. It knows how to
 * open the database, create its three stores on first use, and run one
 * callback inside one transaction; every rule about what may be written lives
 * in `repository.ts`. The `IDBFactory` is injectable so the suite can run the
 * real adapter against a small in-memory implementation of the parts of
 * IndexedDB it uses.
 *
 * Transaction semantics this adapter guarantees to the repository:
 *
 * - `run` sees a transaction over all three stores.
 * - If `run` resolves, the promise resolves only after the transaction reports
 *   `complete`, so a caller never reads "saved" from a transaction that will
 *   still abort.
 * - If `run` throws or rejects, the transaction is aborted before the error is
 *   rethrown; a quota failure therefore leaves the previous version intact.
 */
import { STORES } from "./repository.ts";
import type { StorageBackend, StorageMode, StorageTransaction, StoreName } from "./repository.ts";

export const DATABASE_NAME = "patent.v6.local";
export const DATABASE_VERSION = 1;

/** The index `listEvents` reads instead of scanning every event. */
export const EVENTS_MATTER_INDEX = "matterId";

export interface IndexedDbOptions {
  /** Injectable factory; defaults to the runtime's `indexedDB`. */
  factory?: IDBFactory;
  databaseName?: string;
  databaseVersion?: number;
}

/**
 * Open the local database and return the repository's backend. Rejects with a
 * named error when the runtime has no IndexedDB or when the open is blocked by
 * another tab holding an older version.
 */
export async function openIndexedDbBackend(options: IndexedDbOptions = {}): Promise<StorageBackend> {
  const factory = options.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) {
    throw new Error("IndexedDB is unavailable in this runtime");
  }
  const database = await openDatabase(
    factory,
    options.databaseName ?? DATABASE_NAME,
    options.databaseVersion ?? DATABASE_VERSION,
  );
  return {
    transaction: (mode, run) => runTransaction(database, mode, run),
    close: () => database.close(),
  };
}

function openDatabase(factory: IDBFactory, name: string, version: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const request = factory.open(name, version);

    request.onupgradeneeded = () => createStores(request.result);

    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("IndexedDB open failed"));
    };

    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("IndexedDB open is blocked by another connection"));
    };

    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        // The open was reported blocked and its promise already rejected; do not
        // leak the connection that arrived afterwards.
        database.close();
        return;
      }
      settled = true;
      // Another tab upgrading the database closes this connection instead of
      // blocking it forever.
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

/** Idempotent across upgrades: a store or index that exists is left alone. */
function createStores(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(STORES.matters)) {
    database.createObjectStore(STORES.matters);
  }
  if (!database.objectStoreNames.contains(STORES.events)) {
    const events = database.createObjectStore(STORES.events);
    events.createIndex(EVENTS_MATTER_INDEX, "matterId", { unique: false });
  }
  if (!database.objectStoreNames.contains(STORES.blobs)) {
    database.createObjectStore(STORES.blobs);
  }
}

async function runTransaction<T>(
  database: IDBDatabase,
  mode: StorageMode,
  run: (tx: StorageTransaction) => Promise<T>,
): Promise<T> {
  const transaction = database.transaction([STORES.matters, STORES.events, STORES.blobs], mode);
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
  // The completion promise is awaited only after `run` settles; keep a rejection
  // it may raise while `run` is still working from surfacing as unhandled.
  completion.catch(() => undefined);

  const store = (name: StoreName) => transaction.objectStore(name);
  const api: StorageTransaction = {
    get: (name, key) => requestResult(store(name).get(key)),
    put: async (name, key, value) => {
      await requestResult(store(name).put(value, key));
    },
    delete: async (name, key) => {
      await requestResult(store(name).delete(key));
    },
    getAll: (name) => requestResult(store(name).getAll()),
    getAllByIndex: (name, index, value) => requestResult(store(name).index(index).getAll(value)),
  };

  try {
    const value = await run(api);
    // A transaction that aborted after `run` resolved still must not be reported
    // as written, so wait for `complete` before answering.
    await completion;
    return value;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Already aborted or already committed; the error below is the real one.
    }
    await completion.catch(() => undefined);
    throw error;
  }
}

function requestResult<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error ?? new Error("IndexedDB request failed"));
  });
}
