import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import "../../../../apps/web/src/styles.css";
import "../../../../apps/web/src/v6/styles/theme.css";
import "../../../../apps/web/src/v6/routes/v6.css";
import { STORES, LocalRepository } from "../../../../apps/web/src/v6/lib/repository.ts";
import { createSelfServiceMatter, parseV6Path, LOCAL_ACTOR } from "../../../../apps/web/src/v6/routes/navigation.ts";
import { ProfessionalWorkbench } from "../../../../apps/web/src/v6/features/workbench/Workbench.tsx";

const matterId = "33333333-3333-4333-8333-333333333351";
const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const now = "2026-11-05T12:00:00.000Z";

class MemoryBackend {
  private readonly data = new Map<string, Map<string, unknown>>(Object.values(STORES).map((name) => [name, new Map()]));
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  transaction<T>(mode: "readonly" | "readwrite", run: (tx: MemoryTransaction) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("backend is closed"));
    if (mode !== "readwrite") return this.run(run);
    const next = this.queue.then(() => this.run(run));
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async run<T>(run: (tx: MemoryTransaction) => Promise<T>): Promise<T> {
    const before = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const store = (name: string) => this.data.get(name);
    const tx: MemoryTransaction = {
      get: async (name, key) => {
        const value = store(name)?.get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (name, key, value) => { store(name)?.set(key, structuredClone(value)); },
      delete: async (name, key) => { store(name)?.delete(key); },
      getAll: async (name) => [...(store(name)?.values() ?? [])].map((value) => structuredClone(value)),
      getAllByIndex: async (name, index, value) => [...(store(name)?.values() ?? [])]
        .filter((row) => isRecord(row) && row[index] === value)
        .map((row) => structuredClone(row)),
    };
    try {
      return await run(tx);
    } catch (error) {
      this.data.clear();
      for (const [name, storeMap] of before) this.data.set(name, storeMap);
      throw error;
    }
  }

  close(): void { this.closed = true; }
}

interface MemoryTransaction {
  get(store: string, key: string): Promise<unknown>;
  put(store: string, key: string, value: unknown): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  getAll(store: string): Promise<readonly unknown[]>;
  getAllByIndex(store: string, index: string, value: string): Promise<readonly unknown[]>;
}

interface BrowserState {
  matterId: string;
  created: boolean;
  initialCount: number;
  initialUrl: string;
}

function RoutedWorkbench({ repository }: { repository: LocalRepository }) {
  const location = useLocation();
  const route = parseV6Path(location.pathname);
  if (route.kind !== "matter") return <p data-testid="route-unavailable">案件不可用</p>;
  return <ProfessionalWorkbench repository={repository} actor={LOCAL_ACTOR} matterId={route.matterId}
    targetId={route.targetId} tab={route.tab} />;
}

async function main() {
  const backend = new MemoryBackend();
  const repository = new LocalRepository(backend as never);
  const created = await createSelfServiceMatter(repository, LOCAL_ACTOR, { matterId, eventId, requestId, now });
  if (!created.ok) throw new Error(created.message);
  const before = await repository.listMatters(LOCAL_ACTOR);
  const state: BrowserState = {
    matterId,
    created: created.created,
    initialCount: before.data.items.length,
    initialUrl: `/v6/matters/${matterId}/overview`,
  };
  (window as unknown as { __v622: BrowserState }).__v622 = state;
  const root = createRoot(document.getElementById("root") as HTMLElement);
  (window as unknown as { __v622ShowMissing: () => void }).__v622ShowMissing = () => {
    root.render(
      <MemoryRouter key="missing" initialEntries={["/v6/matters/33333333-3333-4333-8333-333333333399/overview"]}>
        <RoutedWorkbench repository={repository} />
      </MemoryRouter>,
    );
  };
  root.render(
    <MemoryRouter initialEntries={[state.initialUrl]}>
      <RoutedWorkbench repository={repository} />
    </MemoryRouter>,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const root = document.getElementById("root");
  if (root) root.textContent = `浏览器挂载失败：${message}`;
  (window as unknown as { __workbenchMountError: string }).__workbenchMountError = message;
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
