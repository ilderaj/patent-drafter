/**
 * V6-15 engine — capability, manifest, consent, revocation and gate rules.
 *
 * Every test goes through the public module used by the React panel. The
 * fixtures are synthetic; no model, network, provider adapter or real material
 * is involved. S04-A04..A09 (job runner behaviour) are not implemented by this
 * ticket and are not claimed here.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_AI_CONFIG,
  canGrantConsent,
  grantConsent,
  loadAiView,
  requestRealInvocation,
  revokeConsent,
  toSafeInvocationRow,
  unknownProfileFields,
  validateConsentForUse,
} from "../../../../apps/web/src/v6/features/ai/ai.ts";
import {
  ACTOR_A,
  ACTOR_B,
  ACTOR_C,
  ASSET_1,
  ASSET_2,
  CHUNK_1,
  CHUNK_2,
  CHUNK_MARKER,
  DRAFT_1,
  DRAFT_2,
  FACT_MARKER,
  FIG_1,
  FIG_2,
  GOOD_PROFILE_ID,
  GOOD_PROFILE_VERSION,
  INVOCATION_ID,
  MATTER_A,
  MATTER_B,
  T0,
  T1,
  T2,
  T3,
  TARGET_A,
  TARGET_B,
  UNKNOWN_PROFILE_ID,
  UNKNOWN_PROFILE_VERSION,
  addSourceAsset,
  archiveMatter,
  configWithProfilePatch,
  consentEvents,
  createSecondMatter,
  eventsOf,
  grantInput,
  matterRecord,
  readyView,
  seed,
  seedInvocation,
  storedRows,
} from "./harness.mjs";

function expectOk(result, label = "result") {
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.error)}`);
  return result.data;
}

function expectError(result, code, label = "result") {
  assert.equal(result.ok, false, `${label}: expected ${code}, got success`);
  assert.equal(result.error.code, code, `${label}: ${JSON.stringify(result.error)}`);
  return result.error;
}

// ---------------------------------------------------------------------------
// V6-15-A01: honest capabilities and provider profiles
// ---------------------------------------------------------------------------

test("V6-15 engine: capabilities never claim local, byok or platform outbound availability in R1", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const byMode = Object.fromEntries(view.capabilities.map((capability) => [capability.mode, capability]));

  assert.equal(view.releaseGate, "closed");
  assert.equal(view.runtime, "local_web");
  assert.equal(byMode.local.state, "unavailable");
  assert.match(byMode.local.reason, /R4|桌面版/);
  assert.equal(byMode.byok.state, "unavailable");
  assert.match(byMode.byok.reason, /R2|R4|密钥/);
  assert.equal(byMode.platform.state, "unavailable");
  assert.match(byMode.platform.reason, /RELEASE_GATE_CLOSED/);
  assert.equal(byMode.stub.state, "available");
  for (const capability of view.capabilities) {
    assert.ok(capability.evidenceVersion === null || typeof capability.evidenceVersion === "string");
  }

  const good = view.profiles.find((profile) => profile.id === GOOD_PROFILE_ID);
  assert.ok(good);
  assert.equal(good.mode, "platform");
  assert.equal(good.consent.required, true);
  assert.equal(good.consent.canGrant, true);
  assert.deepEqual(good.consent.unknownFields, []);
  assert.equal(good.fields.processingRegion.display, "cn-synthetic-1");

  const unknown = view.profiles.find((profile) => profile.id === UNKNOWN_PROFILE_ID);
  assert.ok(unknown);
  assert.equal(unknown.consent.canGrant, false);
  assert.deepEqual(unknown.consent.unknownFields, [
    "processingRegion",
    "retentionPolicyVersion",
    "trainingPolicy",
    "termsVersion",
  ]);
  assert.equal(unknown.fields.processingRegion.display, "未知");
  assert.equal(unknown.fields.processingRegion.known, false);
  assert.equal(unknown.fields.retentionPolicyVersion.display, "未知");
  assert.equal(unknown.fields.trainingPolicy.display, "未知");
  assert.equal(unknown.fields.termsVersion.display, "未知");
  assert.ok(unknown.consent.unknownFields.length > 0);

  for (const profile of view.profiles.filter((candidate) => candidate.mode !== "platform")) {
    assert.equal(profile.consent.canGrant, false, `${profile.mode} must not be grantable in R1`);
  }
  assert.equal(DEFAULT_AI_CONFIG.profiles.some((profile) => profile.mode === "local"), true);
  assert.equal(canGrantConsent(DEFAULT_AI_CONFIG.profiles.find((profile) => profile.mode === "local")), false);
  assert.deepEqual(
    unknownProfileFields(DEFAULT_AI_CONFIG.profiles.find((profile) => profile.id === UNKNOWN_PROFILE_ID)),
    ["processingRegion", "retentionPolicyVersion", "trainingPolicy", "termsVersion"],
  );
});

test("V6-15 engine: a manifest lists exactly the current source files, counts and target revisions", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const manifest = view.manifest;

  assert.equal(view.kind, "ready");
  assert.deepEqual(manifest.files.map((file) => file.name), ["fixture-a.txt", "fixture-b.txt"]);
  assert.deepEqual(manifest.files.map((file) => file.pageCount), [3, 5]);
  assert.equal(manifest.factCount, 2);
  assert.deepEqual([...manifest.chunkIds].sort(), [CHUNK_1, CHUNK_2].sort());
  assert.deepEqual(manifest.draftRevisionIds, [DRAFT_1, DRAFT_2]);
  assert.deepEqual(manifest.figureRevisionIds, [FIG_1, FIG_2]);
  assert.equal(manifest.scope.matterId, MATTER_A);
  assert.equal(manifest.scope.targetId, null);
  assert.match(manifest.payloadManifestHash, /^[0-9a-f]{64}$/);
  assert.equal(manifest.scope.payloadManifestHash, manifest.payloadManifestHash);
  assert.deepEqual(manifest.scope.assetIds, [ASSET_1, ASSET_2]);

  const again = await readyView(repository);
  assert.equal(again.manifest.payloadManifestHash, manifest.payloadManifestHash, "the hash is deterministic");

  const targetView = await readyView(repository, ACTOR_A, { targetId: TARGET_A });
  assert.equal(targetView.manifest.targetId, TARGET_A);
  assert.deepEqual(targetView.manifest.draftRevisionIds, [DRAFT_1]);
  assert.deepEqual(targetView.manifest.figureRevisionIds, [FIG_1]);
  assert.equal(targetView.manifest.payloadManifestHash === manifest.payloadManifestHash, false);

  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes(CHUNK_MARKER), false, "chunk text must not reach the view");
  assert.equal(serialized.includes(FACT_MARKER), false, "fact value must not reach the view");

  for (const pattern of ["PROMPT-MUST-NOT-LEAK", "sk-KEY-MUST-NOT-LEAK", "CASE-CONTENT-MUST-NOT-LEAK"]) {
    assert.equal(serialized.includes(pattern), false);
  }
});

test("V6-15 engine: unknown page counts and missing facts stay visible without inventing data", async () => {
  const { repository } = await seed({ assets: 1, targets: 1, withParse: false, withSnapshot: false });
  const view = await readyView(repository);
  assert.equal(view.manifest.files.length, 1);
  assert.equal(view.manifest.files[0].pageCount, null, "unknown page count is not guessed");
  assert.equal(view.manifest.factCount, 0);
  assert.deepEqual(view.manifest.chunkIds, []);
  const granted = await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
    requestKey: "unknown-counts",
    now: () => T1,
  });
  expectOk(granted, "grant with unknown page count and no facts");
});

test("V6-15 engine: an empty workspace is the no-matters view, not a fake matter", async () => {
  const { repository } = await seed();
  const result = await loadAiView(repository, ACTOR_A, null);
  const view = expectOk(result);
  assert.equal(view.kind, "empty");
  assert.equal(view.emptyReason, "no_matters");
  assert.match(view.message, /案件/);
  assert.ok(view.capabilities.length > 0);
  assert.ok(view.profiles.length > 0);
  assert.equal("manifest" in view, false);
});

// ---------------------------------------------------------------------------
// Unknown profile fields block consent
// ---------------------------------------------------------------------------

test("V6-15 engine: unknown processor fields make consent impossible and report the fields", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const unknown = view.profiles.find((profile) => profile.id === UNKNOWN_PROFILE_ID);
  assert.equal(unknown.consent.canGrant, false);

  const attempt = await grantConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    {
      providerProfileId: UNKNOWN_PROFILE_ID,
      providerProfileVersion: UNKNOWN_PROFILE_VERSION,
      purpose: "extract",
      targetId: null,
      manifestHash: view.manifest.payloadManifestHash,
      scope: view.manifest.scope,
      expiresAt: null,
    },
    { requestKey: "unknown-profile", now: () => T1 },
  );
  const error = expectError(attempt, "CAPABILITY_UNAVAILABLE");
  assert.deepEqual([...error.fields].sort(), [
    "processingRegion",
    "retentionPolicyVersion",
    "termsVersion",
    "trainingPolicy",
  ]);
  assert.equal(storedRows(backend, "ai.consent").length, 0);
  assert.deepEqual(consentEvents(await eventsOf(repository)), []);

  const approvedButUnknown = {
    ...DEFAULT_AI_CONFIG.profiles[0],
    processingRegion: null,
    retentionPolicyVersion: null,
    termsVersion: null,
    trainingPolicy: "unknown",
  };
  const config = configWithProfilePatch(GOOD_PROFILE_ID, approvedButUnknown);
  const second = await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
    requestKey: "unknown-approved",
    now: () => T1,
    config,
  });
  const secondError = expectError(second, "CAPABILITY_UNAVAILABLE");
  assert.ok(secondError.fields.some((field) => field.startsWith("processingRegion")), JSON.stringify(secondError));
  assert.equal(storedRows(backend, "ai.consent").length, 0);
});

// ---------------------------------------------------------------------------
// V6-15-A02: manifest binding and consent records
// ---------------------------------------------------------------------------

test("V6-15 engine: a grant saves the profile facts, scope, one allowlisted event and can be validated", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view);
  const granted = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: "grant-1",
    now: () => T1,
  });
  const data = expectOk(granted);
  assert.equal(data.created, true);
  const consent = data.consent;
  assert.match(consent.id, /^[0-9a-f-]{36}$/);
  assert.equal(consent.actorId, ACTOR_A.userId);
  assert.equal(consent.providerProfileId, GOOD_PROFILE_ID);
  assert.equal(consent.providerProfileVersion, GOOD_PROFILE_VERSION);
  assert.equal(consent.purpose, "extract");
  assert.equal(consent.processorName, "Synthetic Processor A");
  assert.equal(consent.processingRegion, "cn-synthetic-1");
  assert.equal(consent.retentionPolicyVersion, "retention-2026.1");
  assert.equal(consent.trainingPolicy, "no_training");
  assert.equal(consent.termsVersion, "terms-2026.1");
  assert.equal(consent.createdAt, T1);
  assert.equal(consent.expiresAt, null);
  assert.deepEqual(consent.scope, view.manifest.scope);

  const events = await eventsOf(repository);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.action, "consent.granted");
  assert.equal(event.resourceId, consent.id);
  assert.equal(event.actorId, ACTOR_A.userId);
  assert.equal(event.targetId, null);
  assert.equal(event.occurredAt, T1);
  assert.deepEqual(Object.keys(event.metadata).sort(), ["provider"]);
  assert.equal(event.metadata.provider, GOOD_PROFILE_ID);

  const rows = storedRows(backend, "ai.consent");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requestKey, "grant-1");
  assert.equal(rows[0].tenantId, ACTOR_A.tenantId);
  assert.equal(rows[0].matterId, MATTER_A);

  const reloaded = await readyView(repository);
  assert.equal(reloaded.consents.length, 1);
  assert.equal(reloaded.consents[0].id, consent.id);
  assert.equal(reloaded.consents[0].status, "active");
  assert.equal(reloaded.consents[0].stale, false);
  assert.deepEqual(reloaded.invocations, []);

  const checked = expectOk(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: consent.id,
      purpose: "extract",
      targetId: null,
    }),
  );
  assert.equal(checked.consent.id, consent.id);
  assert.equal(checked.consent.status, "active");
  assert.equal(checked.manifest.payloadManifestHash, view.manifest.payloadManifestHash);
  assert.equal(checked.manifest.scope.assetIds.length, 2);
});

test("V6-15 engine: a stale manifest hash or a mismatched scope is refused without writing", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view);

  const staleHash = await grantConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    { ...input, manifestHash: "b".repeat(64) },
    { requestKey: "stale-hash", now: () => T1 },
  );
  expectError(staleHash, "STALE_BINDING");

  const staleScope = await grantConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    { ...input, scope: { ...view.manifest.scope, assetIds: [ASSET_1] } },
    { requestKey: "stale-scope", now: () => T1 },
  );
  expectError(staleScope, "STALE_BINDING");

  await addSourceAsset(repository, backend);
  const addedFile = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: "stale-file",
    now: () => T1,
  });
  expectError(addedFile, "STALE_BINDING");

  assert.equal(storedRows(backend, "ai.consent").length, 0);
  assert.deepEqual(consentEvents(await eventsOf(repository)), []);
});

test("V6-15 engine: adding a file makes the old consent stale and unusable (S04-A02)", async () => {
  const { backend, repository } = await seed();
  const before = await readyView(repository);
  const first = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(before), {
      requestKey: "old-file",
      now: () => T1,
    }),
  );
  expectOk(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: first.consent.id,
      purpose: "extract",
      targetId: null,
    }),
  );

  await addSourceAsset(repository, backend);
  const after = await readyView(repository);
  assert.notEqual(after.manifest.payloadManifestHash, before.manifest.payloadManifestHash);
  const oldConsent = after.consents.find((consent) => consent.id === first.consent.id);
  assert.ok(oldConsent);
  assert.equal(oldConsent.stale, true);
  assert.deepEqual(after.staleConsentIds, [first.consent.id]);

  expectError(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: first.consent.id,
      purpose: "extract",
      targetId: null,
    }),
    "CONSENT_REQUIRED",
  );

  const renewed = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(after), {
      requestKey: "new-file",
      now: () => T2,
    }),
  );
  assert.notEqual(renewed.consent.id, first.consent.id);
  assert.equal(renewed.created, true);

  const final = await readyView(repository);
  assert.equal(final.consents.length, 2);
  assert.equal(final.consents.find((consent) => consent.id === first.consent.id).stale, true);
  assert.equal(final.consents.find((consent) => consent.id === renewed.consent.id).stale, false);
  expectOk(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: renewed.consent.id,
      purpose: "extract",
      targetId: null,
    }),
  );
});

test("V6-15 engine: a purpose change requires a separate consent", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const extract = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
      requestKey: "purpose-extract",
      now: () => T1,
    }),
  );
  expectError(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: extract.consent.id,
      purpose: "draft",
      targetId: null,
    }),
    "CONSENT_REQUIRED",
  );

  const draft = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view, { purpose: "draft" }), {
      requestKey: "purpose-draft",
      now: () => T2,
    }),
  );
  assert.notEqual(draft.consent.id, extract.consent.id);
  assert.equal(draft.consent.purpose, "draft");
  expectOk(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: draft.consent.id,
      purpose: "draft",
      targetId: null,
    }),
  );
  const final = await readyView(repository);
  assert.equal(final.consents.length, 2);
  assert.ok(final.consents.every((consent) => consent.status === "active" && consent.stale === false));
});

test("V6-15 engine: changed processor, region, retention, training or terms invalidates the old consent", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const first = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
      requestKey: "provider-old",
      now: () => T1,
    }),
  );
  expectOk(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: first.consent.id,
      purpose: "extract",
      targetId: null,
    }),
  );

  const changed = configWithProfilePatch(GOOD_PROFILE_ID, {
    processingRegion: "eu-synthetic-2",
    retentionPolicyVersion: "retention-2026.2",
    termsVersion: "terms-2026.2",
  });
  expectError(
    await validateConsentForUse(
      repository,
      ACTOR_A,
      MATTER_A,
      { consentId: first.consent.id, purpose: "extract", targetId: null },
      { config: changed },
    ),
    "CONSENT_REQUIRED",
  );
  const changedView = await readyView(repository, ACTOR_A, { config: changed });
  assert.equal(changedView.consents.find((consent) => consent.id === first.consent.id).stale, true);

  const renewed = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
      requestKey: "provider-new",
      now: () => T2,
      config: changed,
    }),
  );
  assert.equal(renewed.consent.processingRegion, "eu-synthetic-2");
  assert.equal(renewed.consent.retentionPolicyVersion, "retention-2026.2");
  assert.equal(renewed.consent.termsVersion, "terms-2026.2");
  assert.notEqual(renewed.consent.id, first.consent.id);

  expectOk(
    await validateConsentForUse(
      repository,
      ACTOR_A,
      MATTER_A,
      { consentId: renewed.consent.id, purpose: "extract", targetId: null },
      { config: changed },
    ),
  );
  expectError(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: renewed.consent.id,
      purpose: "extract",
      targetId: null,
    }),
    "CONSENT_REQUIRED",
  );
  const after = await readyView(repository, ACTOR_A, { config: changed });
  assert.equal(after.consents.find((consent) => consent.id === first.consent.id).stale, true);
  assert.equal(after.consents.find((consent) => consent.id === renewed.consent.id).stale, false);
});

test("V6-15 engine: an expired consent stays historical and cannot authorize", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view, { expiresAt: T2 });
  const granted = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, input, { requestKey: "expiring", now: () => T1 }),
  );
  expectOk(
    await validateConsentForUse(
      repository,
      ACTOR_A,
      MATTER_A,
      { consentId: granted.consent.id, purpose: "extract", targetId: null },
      { now: () => T1 },
    ),
  );
  expectError(
    await validateConsentForUse(
      repository,
      ACTOR_A,
      MATTER_A,
      { consentId: granted.consent.id, purpose: "extract", targetId: null },
      { now: () => T2 },
    ),
    "CONSENT_REQUIRED",
  );
  const later = await readyView(repository, ACTOR_A, { now: () => T3 });
  assert.equal(later.consents[0].status, "expired");
  assert.deepEqual(later.staleConsentIds, [], "expired is not a material-staleness warning");

  const past = await grantConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    grantInput(view, { expiresAt: T0 }),
    { requestKey: "past-expiry", now: () => T1 },
  );
  expectError(past, "INVALID_INPUT");
});

test("V6-15 engine: target-scoped consent does not cover another target or the whole matter", async () => {
  const { repository } = await seed();
  const targetView = await readyView(repository, ACTOR_A, { targetId: TARGET_A });
  const granted = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(targetView), {
      requestKey: "target-a",
      now: () => T1,
    }),
  );
  assert.equal(granted.consent.scope.targetId, TARGET_A);
  assert.deepEqual(granted.consent.scope.draftRevisionIds, [DRAFT_1]);

  expectOk(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: granted.consent.id,
      purpose: "extract",
      targetId: TARGET_A,
    }),
  );
  expectError(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: granted.consent.id,
      purpose: "extract",
      targetId: TARGET_B,
    }),
    "CONSENT_REQUIRED",
  );
  expectError(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: granted.consent.id,
      purpose: "extract",
      targetId: null,
    }),
    "CONSENT_REQUIRED",
  );

  const scoped = await readyView(repository, ACTOR_A, { targetId: TARGET_A });
  assert.equal(scoped.consents[0].stale, false);
  const whole = await readyView(repository);
  assert.equal(whole.consents[0].stale, false, "another target's manifest does not mark this consent stale");
});

// ---------------------------------------------------------------------------
// V6-15-A03: revocation and the closed release gate
// ---------------------------------------------------------------------------

test("V6-15 engine: revocation is append-only, blocks use, and a second revocation adds no event", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const granted = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
      requestKey: "revoke-grant",
      now: () => T1,
    }),
  );
  const revoked = expectOk(
    await revokeConsent(repository, ACTOR_A, MATTER_A, { consentId: granted.consent.id }, {
      requestKey: "revoke-1",
      now: () => T2,
    }),
  );
  assert.equal(revoked.revokedAt, T2);
  assert.equal(revoked.alreadyRevoked, false);

  let events = await eventsOf(repository);
  const grantedEvents = events.filter((event) => event.action === "consent.granted");
  let revokedEvents = events.filter((event) => event.action === "consent.revoked");
  assert.equal(grantedEvents.length, 1);
  assert.equal(revokedEvents.length, 1);
  assert.equal(revokedEvents[0].resourceId, granted.consent.id);
  assert.deepEqual(Object.keys(revokedEvents[0].metadata), ["provider"]);
  assert.equal(revokedEvents[0].metadata.provider, GOOD_PROFILE_ID);
  assert.match(revokedEvents[0].metadata.provider, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/);

  expectError(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: granted.consent.id,
      purpose: "extract",
      targetId: null,
    }),
    "CONSENT_REVOKED",
  );

  const revokedView = await readyView(repository);
  assert.equal(revokedView.consents[0].status, "revoked");
  assert.equal(revokedView.consents[0].stale, false);
  assert.equal(revokedView.consents[0].revokedAt, T2);

  const second = expectOk(
    await revokeConsent(repository, ACTOR_A, MATTER_A, { consentId: granted.consent.id }, {
      requestKey: "revoke-2",
      now: () => T3,
    }),
  );
  assert.equal(second.alreadyRevoked, true);
  assert.equal(second.revokedAt, T2);

  const secondReplay = expectOk(
    await revokeConsent(repository, ACTOR_A, MATTER_A, { consentId: granted.consent.id }, {
      requestKey: "revoke-2",
      now: () => T4,
    }),
  );
  assert.equal(secondReplay.revokedAt, T2);
  assert.equal(secondReplay.alreadyRevoked, true, "a keyed retry replays the original answer");

  const replay = await revokeConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    { consentId: granted.consent.id },
    { requestKey: "revoke-1", now: () => T3 },
  );
  const replayed = expectOk(replay);
  assert.equal(replay.replayed, true);
  assert.equal(replayed.revokedAt, T2);

  events = await eventsOf(repository);
  revokedEvents = events.filter((event) => event.action === "consent.revoked");
  assert.equal(revokedEvents.length, 1, "the revocation event is never duplicated");
  assert.equal(storedRows(backend, "ai.consent").length, 1, "the historical Consent row remains");

  const renewed = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
      requestKey: "renewed-after-revoke",
      now: () => T3,
    }),
  );
  assert.notEqual(renewed.consent.id, granted.consent.id);
  assert.equal(renewed.created, true);
  expectOk(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: renewed.consent.id,
      purpose: "extract",
      targetId: null,
    }),
  );
  const final = await readyView(repository);
  assert.equal(final.consents.length, 2);
  assert.equal(final.consents.find((consent) => consent.id === granted.consent.id).status, "revoked");
  assert.equal(final.consents.find((consent) => consent.id === renewed.consent.id).status, "active");
});

test("V6-15 engine: request keys replay the original response and conflict on different content", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view);
  const first = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: "idem-grant",
    now: () => T1,
  });
  const firstData = expectOk(first);
  assert.equal(firstData.created, true);

  const replay = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: "idem-grant",
    now: () => T3,
  });
  const replayData = expectOk(replay);
  assert.equal(replay.replayed, true);
  assert.equal(replayData.consent.id, firstData.consent.id);
  assert.equal(replayData.created, true);
  assert.equal(storedRows(backend, "ai.consent").length, 1);
  assert.equal((await eventsOf(repository)).filter((event) => event.action === "consent.granted").length, 1);

  const conflict = await grantConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    grantInput(view, { purpose: "draft" }),
    { requestKey: "idem-grant", now: () => T2 },
  );
  expectError(conflict, "IDEMPOTENCY_CONFLICT");
  assert.equal(storedRows(backend, "ai.consent").length, 1);
  assert.equal((await eventsOf(repository)).filter((event) => event.action === "consent.granted").length, 1);

  await createSecondMatter(repository);
  const otherMatter = await grantConsent(repository, ACTOR_A, MATTER_B, input, {
    requestKey: "idem-grant",
    now: () => T2,
  });
  expectError(otherMatter, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(consentEvents(await eventsOf(repository, ACTOR_A, MATTER_B)), []);

  const revoke = expectOk(
    await revokeConsent(repository, ACTOR_A, MATTER_A, { consentId: firstData.consent.id }, {
      requestKey: "idem-revoke",
      now: () => T2,
    }),
  );
  const revokeReplay = expectOk(
    await revokeConsent(repository, ACTOR_A, MATTER_A, { consentId: firstData.consent.id }, {
      requestKey: "idem-revoke",
      now: () => T3,
    }),
  );
  assert.equal(revokeReplay.revokedAt, revoke.revokedAt);
  assert.equal(
    (await eventsOf(repository)).filter((event) => event.action === "consent.revoked").length,
    1,
  );

  const secondConsent = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view, { purpose: "draft" }), {
      requestKey: "idem-second",
      now: () => T2,
    }),
  );
  const revokeConflict = await revokeConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    { consentId: secondConsent.consent.id },
    { requestKey: "idem-revoke", now: () => T3 },
  );
  expectError(revokeConflict, "IDEMPOTENCY_CONFLICT");
  assert.equal(
    (await eventsOf(repository)).filter((event) => event.action === "consent.revoked").length,
    1,
  );
});

test("V6-15 engine: an archived matter replays a completed key but refuses new work", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view);
  const granted = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, input, {
      requestKey: "archive-grant",
      now: () => T1,
    }),
  );
  await archiveMatter(repository, T2);
  assert.equal((await matterRecord(repository)).status, "archived");

  const replay = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: "archive-grant",
    now: () => T3,
  });
  const replayData = expectOk(replay);
  assert.equal(replay.replayed, true);
  assert.equal(replayData.consent.id, granted.consent.id);
  assert.equal((await eventsOf(repository)).filter((event) => event.action === "consent.granted").length, 1);

  expectError(
    await grantConsent(repository, ACTOR_A, MATTER_A, input, {
      requestKey: "archive-new",
      now: () => T3,
    }),
    "INVALID_TRANSITION",
  );
  assert.equal((await eventsOf(repository)).filter((event) => event.action === "consent.granted").length, 1);
  assert.equal(storedRows(backend, "ai.consent").length, 1);

  expectError(
    await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: granted.consent.id,
      purpose: "extract",
      targetId: null,
    }),
    "INVALID_TRANSITION",
  );
  expectError(
    await revokeConsent(repository, ACTOR_A, MATTER_A, { consentId: granted.consent.id }, {
      requestKey: "archive-revoke",
      now: () => T3,
    }),
    "INVALID_TRANSITION",
  );
  assert.equal((await eventsOf(repository)).filter((event) => event.action === "consent.revoked").length, 0);

  const archivedView = await readyView(repository);
  assert.equal(archivedView.matter.status, "archived");
  assert.equal(archivedView.consents[0].status, "active");
});

test("V6-15 engine: another actor or tenant cannot read, grant, validate or revoke", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const granted = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
      requestKey: "boundary-grant",
      now: () => T1,
    }),
  );
  const baselineEvents = (await eventsOf(repository)).length;
  const baselineRows = storedRows(backend, "ai.consent").length;
  const baselineVersion = (await matterRecord(repository)).version;

  for (const actor of [ACTOR_B, ACTOR_C]) {
    expectError(await loadAiView(repository, actor, MATTER_A), "RESOURCE_NOT_FOUND");
    expectError(
      await validateConsentForUse(repository, actor, MATTER_A, {
        consentId: granted.consent.id,
        purpose: "extract",
        targetId: null,
      }),
      "RESOURCE_NOT_FOUND",
    );
    expectError(
      await revokeConsent(repository, actor, MATTER_A, { consentId: granted.consent.id }, {
        requestKey: `boundary-revoke-${actor.userId}`,
        now: () => T2,
      }),
      "RESOURCE_NOT_FOUND",
    );
    expectError(
      await grantConsent(repository, actor, MATTER_A, grantInput(view), {
        requestKey: `boundary-grant-${actor.userId}`,
        now: () => T2,
      }),
      "RESOURCE_NOT_FOUND",
    );
  }

  assert.equal((await eventsOf(repository)).length, baselineEvents);
  assert.equal(storedRows(backend, "ai.consent").length, baselineRows);
  assert.equal((await matterRecord(repository)).version, baselineVersion);
});

test("V6-15 engine: the real invocation gate closes before storage or network", async () => {
  const { repository } = await seed();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network must not be used");
  };
  try {
    const versionBefore = (await matterRecord(repository)).version;
    const result = await requestRealInvocation(
      /** The gate must not inspect storage at all. */ null,
      ACTOR_A,
      MATTER_A,
      {
        consentId: null,
        providerProfileId: GOOD_PROFILE_ID,
        providerProfileVersion: GOOD_PROFILE_VERSION,
        purpose: "extract",
        targetId: null,
      },
    );
    expectError(result, "RELEASE_GATE_CLOSED");
    assert.equal(fetchCalls, 0);
    assert.equal((await matterRecord(repository)).version, versionBefore);
    assert.deepEqual(consentEvents(await eventsOf(repository)), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V6-15 engine: S04-A01 an incomplete profile still cannot start a real call", async () => {
  const { backend, repository } = await seed();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network must not be used");
  };
  try {
    const view = await readyView(repository);
    const unknown = view.profiles.find((profile) => profile.id === UNKNOWN_PROFILE_ID);
    assert.ok(unknown);
    assert.equal(unknown.consent.canGrant, false);
    assert.ok(unknown.consent.unknownFields.includes("processingRegion"));

    const versionBefore = (await matterRecord(repository)).version;
    const eventCountBefore = (await eventsOf(repository)).length;
    const consentRowsBefore = storedRows(backend, "ai.consent").length;

    expectError(
      await requestRealInvocation(repository, ACTOR_A, MATTER_A, {
        consentId: null,
        providerProfileId: unknown.id,
        providerProfileVersion: unknown.version,
        purpose: "extract",
        targetId: null,
      }),
      "RELEASE_GATE_CLOSED",
    );
    expectError(
      await requestRealInvocation(repository, ACTOR_A, MATTER_A, {
        consentId: null,
        providerProfileId: unknown.id,
        providerProfileVersion: unknown.version,
        purpose: "ocr",
        targetId: TARGET_A,
      }),
      "RELEASE_GATE_CLOSED",
    );

    assert.equal(fetchCalls, 0);
    assert.equal((await matterRecord(repository)).version, versionBefore);
    assert.equal((await eventsOf(repository)).length, eventCountBefore);
    assert.equal(storedRows(backend, "ai.consent").length, consentRowsBefore);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V6-15 engine: the invocation view model projects contract metadata only", async () => {
  const { backend, repository } = await seed();
  const invocation = await seedInvocation(backend);
  const view = await readyView(repository);
  assert.equal(view.invocations.length, 1);
  const row = view.invocations[0];
  assert.equal(row.id, INVOCATION_ID);
  assert.equal(row.stage, "extract");
  assert.equal(row.status, "succeeded");
  assert.equal(row.inputTokens, 12);
  assert.equal(row.outputTokens, 34);
  assert.equal(row.costMinor, 7);
  assert.equal("prompt" in row, false);
  assert.equal("content" in row, false);
  assert.equal("apiKey" in row, false);

  const serialized = JSON.stringify(view);
  for (const marker of [
    "PROMPT-MUST-NOT-LEAK",
    "CASE-CONTENT-MUST-NOT-LEAK",
    "sk-KEY-MUST-NOT-LEAK",
    CHUNK_MARKER,
    FACT_MARKER,
  ]) {
    assert.equal(serialized.includes(marker), false, `${marker} leaked into the view`);
  }

  const projected = toSafeInvocationRow(invocation);
  assert.ok(projected);
  assert.deepEqual(Object.keys(projected).sort(), [
    "attempt",
    "consentId",
    "costMinor",
    "currency",
    "id",
    "inputTokens",
    "jobId",
    "modelId",
    "outputTokens",
    "providerProfileId",
    "requestHash",
    "stage",
    "status",
    "usageUnknown",
    "at",
    "errorCode",
    "execution",
    "executionLocation",
  ].sort());
  assert.equal(toSafeInvocationRow({ ...invocation, id: "not-a-uuid" }), null);
});
