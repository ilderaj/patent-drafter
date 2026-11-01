/**
 * V6-14 engine — create, update, read-only switching, EP refusal, isolation
 * and snapshot validation (V6-14-A01, V6-14-A02).
 *
 * Every write goes through the real `LocalRepository` over the in-memory
 * backend. "No writes" is proven by comparing a fingerprint of every store.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createTarget,
  loadTargetsView,
  updateTargetConfig,
  EP_ROUTE_MESSAGE,
  UNKNOWN_ROUTE_MESSAGE,
} from "../../../../apps/web/src/v6/features/targets/targets.ts";
import { CONTRACT_VERSION } from "../../../../apps/web/src/v6/lib/repository.ts";
import {
  ACTOR_A,
  ACTOR_B,
  ACTOR_C,
  ASSET_1,
  FOREIGN_ASSET,
  MATTER_A,
  ORG_1,
  PERSON_1,
  PERSON_2,
  T1,
  T2,
  T3,
  UNKNOWN_PARTY,
  aggregate,
  archiveMatter,
  config,
  eventsOf,
  readyView,
  rowsOfKind,
  seed,
  seedForeignMatter,
  storageFingerprint,
  targetEvents,
} from "./harness.mjs";

const at = (iso) => ({ now: () => iso });

async function createTwo(repository) {
  const a = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1));
  assert.equal(a.ok, true, a.ok ? "" : JSON.stringify(a.error));
  const b = await createTarget(
    repository,
    ACTOR_A,
    MATTER_A,
    { config: config("us_nonprovisional", { applicantIds: [PERSON_2], inventorIds: [PERSON_1, PERSON_2] }) },
    at(T2),
  );
  assert.equal(b.ok, true, b.ok ? "" : JSON.stringify(b.error));
  return { a: a.data, b: b.data };
}

test("V6-14-A01 creates a target with a TargetConfig for each supported route", async () => {
  for (const route of ["cn_um", "cn_invention", "us_nonprovisional", "pct"]) {
    const { repository } = await seed();
    const created = await createTarget(repository, ACTOR_A, MATTER_A, { config: config(route) }, at(T1));
    assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
    const { target, config: saved } = created.data;
    assert.equal(target.configVersion, 1);
    assert.equal(target.status, "active");
    assert.equal(saved.route, route);
    assert.equal(saved.version, 1);
    assert.equal(saved.targetId, target.id);
    assert.equal(saved.purpose, "preparation");
    assert.equal(saved.language, "zh-CN", "US/PCT default to the zh-CN preparation draft");
    const view = await readyView(repository);
    assert.equal(view.targets.length, 1);
    assert.equal(view.targets[0].config.route, route);
    assert.equal(view.targets[0].configAvailable, true);
    const agg = await aggregate(repository);
    assert.equal(agg.matter.version, 2, "the matter version moves once");
    const events = targetEvents(await eventsOf(repository));
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "target.created");
  }
});

test("V6-14-A01 refuses EP and unknown routes with INVALID_INPUT and writes nothing", async () => {
  const { backend, repository } = await seed();
  const before = storageFingerprint(backend);
  for (const route of ["EP", "ep", "european", "jp", "", "cn_design"]) {
    const result = await createTarget(repository, ACTOR_A, MATTER_A, { config: config(route) }, {
      ...at(T1),
      requestKey: `ep-${route || "blank"}`,
    });
    assert.equal(result.ok, false, `route ${route} must be refused`);
    assert.equal(result.error.code, "INVALID_INPUT");
    const reasons = result.error.fields.filter((field) => field.path === "route").map((field) => field.reason);
    assert.equal(reasons.length, 1);
    if (route.toUpperCase() === "EP" || route === "european") assert.equal(reasons[0], EP_ROUTE_MESSAGE);
    else if (route !== "") assert.equal(reasons[0], UNKNOWN_ROUTE_MESSAGE);
  }
  assert.equal(storageFingerprint(backend), before, "no row, claim, event or version changed");
  const view = await readyView(repository);
  assert.equal(view.targets.length, 0, "EP was never mapped to another route");
});

test("V6-14-A01 a matter is not capped at two targets (S03: professional mode adds targets)", async () => {
  const { repository } = await seed();
  const { a, b } = await createTwo(repository);
  const third = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("pct") }, at(T3));
  assert.equal(third.ok, true, third.ok ? "" : JSON.stringify(third.error));
  const view = await readyView(repository);
  assert.deepEqual(
    view.targets.map((item) => item.id),
    [a.target.id, b.target.id, third.data.target.id],
  );
  assert.equal(view.targets[2].config.route, "pct");
});

test("V6-14-A02 an asset that is not available is neither offered nor accepted as priority evidence", async () => {
  for (const state of ["staging", "quarantined", "missing_bytes", "purged"]) {
    const { backend, repository } = await seed();
    const loaded = await repository.loadMatter(ACTOR_A, MATTER_A);
    assert.equal(loaded.ok, true);
    const current = loaded.data.data;
    const moved = await repository.commit(
      ACTOR_A,
      {
        contractVersion: CONTRACT_VERSION,
        expectedVersion: current.matter.version,
        payload: {
          matter: { ...current.matter, version: current.matter.version + 1, updatedAt: T1 },
          targets: current.targets,
          assets: current.assets.map((asset) => (asset.id === ASSET_1 ? { ...asset, state } : asset)),
          events: [],
          blobs: [],
        },
      },
      { requestId: "adadadad-adad-4dad-8dad-adadadadadad" },
    );
    assert.equal(moved.ok, true, moved.ok ? "" : JSON.stringify(moved.error));

    const view = await readyView(repository);
    assert.equal(view.evidenceAssets.some((asset) => asset.id === ASSET_1), false, `${state} asset is not listed`);

    const before = storageFingerprint(backend);
    const claim = { country: "CN", applicationNumber: "202610000001.0", filedOn: "2026-01-05", evidenceAssetId: ASSET_1 };
    const refused = await createTarget(
      repository,
      ACTOR_A,
      MATTER_A,
      { config: config("cn_invention", { priorityClaims: [claim] }) },
      at(T2),
    );
    assert.equal(refused.ok, false, `${state} asset must be refused`);
    assert.equal(refused.error.code, "INVALID_INPUT");
    assert.equal(refused.error.fields[0].path, "priorityClaims.0.evidenceAssetId");
    assert.match(refused.error.fields[0].reason, new RegExp(state));
    assert.equal(storageFingerprint(backend), before, "nothing is written");
  }
});

test("V6-14-A02 updating target A bumps only A's configVersion; B's config and version are unchanged", async () => {
  const { repository } = await seed();
  const { a, b } = await createTwo(repository);
  const beforeView = await readyView(repository);
  const bBefore = beforeView.targets.find((item) => item.id === b.target.id);
  const matterBefore = (await aggregate(repository)).matter.version;
  const eventsBefore = targetEvents(await eventsOf(repository)).length;

  const updated = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    a.target.id,
    { baseVersion: 1, config: config("cn_invention", { applicantIds: [ORG_1, PERSON_2] }) },
    at(T3),
  );
  assert.equal(updated.ok, true, updated.ok ? "" : JSON.stringify(updated.error));
  assert.equal(updated.data.target.configVersion, 2);
  assert.equal(updated.data.config.version, 2);
  assert.equal(updated.data.config.route, "cn_invention");

  const after = await readyView(repository);
  const aAfter = after.targets.find((item) => item.id === a.target.id);
  const bAfter = after.targets.find((item) => item.id === b.target.id);
  assert.equal(aAfter.configVersion, 2);
  assert.equal(aAfter.config.route, "cn_invention");
  assert.deepEqual(bAfter, bBefore, "target B is byte-for-byte the same view");
  assert.equal(bAfter.configVersion, 1);

  const agg = await aggregate(repository);
  assert.equal(agg.matter.version, matterBefore + 1, "the matter version moves exactly once");
  const events = targetEvents(await eventsOf(repository));
  assert.equal(events.length, eventsBefore + 1, "exactly one new event");
  const event = events.find((item) => item.action === "target.config_updated");
  assert.equal(event.targetId, a.target.id);
  assert.deepEqual(event.metadata, { version: 2 }, "metadata only: no config content in the event");
  assert.equal(event.snapshot, null);
  assert.equal(JSON.stringify(event).includes(ORG_1), false, "no party id leaks into the event");
});

test("V6-14-A02 switching and reading targets is read-only", async () => {
  const { backend, repository } = await seed();
  await createTwo(repository);
  const before = storageFingerprint(backend);
  for (let index = 0; index < 5; index += 1) {
    const view = await loadTargetsView(repository, ACTOR_A, MATTER_A);
    assert.equal(view.ok, true);
    assert.equal(view.view.targets.length, 2);
  }
  assert.equal(storageFingerprint(backend), before, "no version, event or row changed by reads");
});

test("V6-14-A02 a stale baseVersion is VERSION_CONFLICT and writes nothing", async () => {
  const { backend, repository } = await seed();
  const { a } = await createTwo(repository);
  const first = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    a.target.id,
    { baseVersion: 1, config: config("cn_invention") },
    at(T3),
  );
  assert.equal(first.ok, true);
  const before = storageFingerprint(backend);
  const stale = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    a.target.id,
    { baseVersion: 1, config: config("pct") },
    at(T3),
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "VERSION_CONFLICT");
  assert.equal(stale.error.latestVersion, 2);
  assert.equal(storageFingerprint(backend), before);
});

test("V6-14-A02 update refuses EP without touching either target", async () => {
  const { backend, repository } = await seed();
  const { a } = await createTwo(repository);
  const before = storageFingerprint(backend);
  const result = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    a.target.id,
    { baseVersion: 1, config: config("EP") },
    at(T3),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.equal(result.error.fields[0].reason, EP_ROUTE_MESSAGE);
  assert.equal(storageFingerprint(backend), before);
});

test("another tenant or another actor gets RESOURCE_NOT_FOUND and writes nothing", async () => {
  const { backend, repository } = await seed();
  const { a } = await createTwo(repository);
  await seedForeignMatter(repository);
  const before = storageFingerprint(backend);
  for (const actor of [ACTOR_B, ACTOR_C]) {
    const read = await loadTargetsView(repository, actor, MATTER_A);
    assert.equal(read.ok, false);
    assert.equal(read.error.code, "RESOURCE_NOT_FOUND");
    const created = await createTarget(repository, actor, MATTER_A, { config: config("cn_um") }, at(T3));
    assert.equal(created.ok, false);
    assert.equal(created.error.code, "RESOURCE_NOT_FOUND");
    const keyed = await createTarget(repository, actor, MATTER_A, { config: config("cn_um") }, {
      ...at(T3),
      requestKey: "probe-1",
    });
    assert.equal(keyed.ok, false);
    assert.equal(keyed.error.code, "RESOURCE_NOT_FOUND");
    const updated = await updateTargetConfig(
      repository,
      actor,
      MATTER_A,
      a.target.id,
      { baseVersion: 1, config: config("cn_invention") },
      at(T3),
    );
    assert.equal(updated.ok, false);
    assert.equal(updated.error.code, "RESOURCE_NOT_FOUND");
  }
  assert.equal(storageFingerprint(backend), before);
});

test("an archived matter refuses create and update with INVALID_TRANSITION", async () => {
  const { backend, repository } = await seed();
  const { a } = await createTwo(repository);
  await archiveMatter(repository);
  const before = storageFingerprint(backend);
  const created = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("pct") }, at(T3));
  assert.equal(created.ok, false);
  assert.equal(created.error.code, "INVALID_TRANSITION");
  const updated = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    a.target.id,
    { baseVersion: 1, config: config("cn_invention") },
    at(T3),
  );
  assert.equal(updated.ok, false);
  assert.equal(updated.error.code, "INVALID_TRANSITION");
  assert.equal(storageFingerprint(backend), before);
  const view = await readyView(repository);
  assert.equal(view.matterStatus, "archived");
});

test("config is validated against the snapshot: parties, inventor kind, priority date and evidence", async () => {
  const { backend, repository } = await seed();
  await seedForeignMatter(repository);
  const before = storageFingerprint(backend);
  const cases = [
    [{ applicantIds: [UNKNOWN_PARTY] }, "applicantIds"],
    [{ inventorIds: [UNKNOWN_PARTY] }, "inventorIds"],
    [{ inventorIds: [ORG_1] }, "inventorIds"],
    [{ priorityClaims: [{ country: "CN", applicationNumber: "CN2026000001", filedOn: "2026-02-30" }] }, "priorityClaims.0.filedOn"],
    [{ priorityClaims: [{ country: "CN", applicationNumber: "CN2026000001", filedOn: "2026/01/01" }] }, "priorityClaims.0.filedOn"],
    [
      {
        priorityClaims: [
          { country: "CN", applicationNumber: "CN2026000001", filedOn: "2026-01-05", evidenceAssetId: FOREIGN_ASSET },
        ],
      },
      "priorityClaims.0.evidenceAssetId",
    ],
    [
      {
        priorityClaims: [
          { country: "CN", applicationNumber: "CN2026000001", filedOn: "2026-01-05", evidenceAssetId: "not-an-asset" },
        ],
      },
      "priorityClaims.0.evidenceAssetId",
    ],
    [{ priorityClaims: [{ country: "", applicationNumber: "", filedOn: "2026-01-05" }] }, "priorityClaims.0.country"],
  ];
  for (const [overrides, path] of cases) {
    const result = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_invention", overrides) }, at(T1));
    assert.equal(result.ok, false, `expected ${path} to be refused`);
    assert.equal(result.error.code, "INVALID_INPUT");
    assert.ok(
      result.error.fields.some((field) => field.path === path),
      `expected a field error on ${path}, got ${JSON.stringify(result.error.fields)}`,
    );
  }
  assert.equal(storageFingerprint(backend), before);
  assert.equal(rowsOfKind(backend, "target.config").length, 0);
});

test("a valid priority claim keeps its evidence asset and defaults verification to unverified", async () => {
  const { repository } = await seed();
  const created = await createTarget(
    repository,
    ACTOR_A,
    MATTER_A,
    {
      config: config("pct", {
        priorityClaims: [
          { country: "CN", applicationNumber: "CN2026000001", filedOn: "2026-01-05", evidenceAssetId: ASSET_1 },
        ],
      }),
    },
    at(T1),
  );
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.deepEqual(created.data.config.priorityClaims, [
    {
      country: "CN",
      applicationNumber: "CN2026000001",
      filedOn: "2026-01-05",
      evidenceAssetId: ASSET_1,
      verification: "unverified",
    },
  ]);
});

test("en-US is refused at write time while translation_en is unavailable", async () => {
  const { backend, repository } = await seed();
  const before = storageFingerprint(backend);
  const result = await createTarget(
    repository,
    ACTOR_A,
    MATTER_A,
    { config: { ...config("us_nonprovisional"), language: "en-US" } },
    at(T1),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.equal(result.error.fields[0].path, "language");
  assert.match(result.error.fields[0].reason, /英文/);
  assert.equal(storageFingerprint(backend), before);
});

test("a matter with no intake snapshot reads as empty and refuses party ids it does not know", async () => {
  const { repository } = await seed({ withSnapshot: false });
  const view = await readyView(repository);
  assert.equal(view.targets.length, 0);
  assert.equal(view.snapshotEmpty, true);
  assert.equal(view.parties.length, 0);
  const result = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_INPUT");
  const empty = await createTarget(
    repository,
    ACTOR_A,
    MATTER_A,
    { config: config("cn_um", { applicantIds: [], inventorIds: [] }) },
    at(T1),
  );
  assert.equal(empty.ok, true, "a config with no parties is still a valid route choice");
});
