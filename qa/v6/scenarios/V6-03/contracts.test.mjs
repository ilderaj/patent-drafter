import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The contract package ships TypeScript sources; Node runs them with type
// stripping. A `.ts` specifier is required because the tests run as plain ESM.
import * as contracts from '../../../../packages/contracts/src/index.ts';

const {
  FIXTURES,
  FIXTURE_IDS,
  entitySchemas,
  snapshotRefSchema,
  draftInputRefSchema,
  commandSchema,
  exportRequestSchema,
  matterSchema,
  draftAstSchema,
  gateDecisionSchema,
  apiErrorSchema,
  activitySchema,
  paymentOrderSchema,
  confirmationSchema,
  contractVersionSchema,
  errorCodeSchema,
  ERROR_CODES,
  GATE_ACTIONS,
  HTTP_STATUS_BY_ERROR_CODE,
  httpStatusForErrorCode,
} = contracts;

const CONTRACT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/contracts/src');

const SNAPSHOT_FIELDS = [
  'matterId',
  'targetId',
  'sourceVersion',
  'targetConfigVersion',
  'draftRevisionId',
  'figureRevisionId',
];

function rejects(schema, value) {
  return schema.safeParse(value).success === false;
}

test('V6-03-A01: every fixture validates against its registered schema', () => {
  const fixtureKeys = Object.keys(FIXTURES).sort();
  const schemaKeys = Object.keys(entitySchemas).sort();
  assert.deepEqual(schemaKeys, fixtureKeys, 'fixtures and schemas must cover the same contract surface');

  const failures = [];
  for (const [key, value] of Object.entries(FIXTURES)) {
    const result = entitySchemas[key].safeParse(value);
    if (!result.success) failures.push(`${key}: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  assert.deepEqual(failures, [], 'synthetic fixtures must satisfy their own schemas');
  assert.ok(fixtureKeys.length >= 60, `expected the full v6.1 entity surface, got ${fixtureKeys.length} fixtures`);
});

test('V6-03-A01: a valid snapshot and command survive a serialization round trip', () => {
  const ref = FIXTURES.snapshot;
  const parsedRef = snapshotRefSchema.parse(ref);
  assert.deepEqual(parsedRef, ref);
  assert.deepEqual(JSON.parse(JSON.stringify(parsedRef)), ref);

  const command = commandSchema(exportRequestSchema).parse(FIXTURES.command);
  assert.deepEqual(JSON.parse(JSON.stringify(command)), FIXTURES.command);
  assert.equal(command.contractVersion, 'v6.1');
  assert.deepEqual(command.payload, FIXTURES.exportRequest);
  assert.deepEqual(command.payload.snapshot, ref);
});

test('V6-03-A01: a valid draft AST round-trips with its claim dependency graph intact', () => {
  const parsed = draftAstSchema.parse(FIXTURES.draftAst);
  assert.deepEqual(parsed, FIXTURES.draftAst);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), FIXTURES.draftAst);
  const [, dependent] = parsed.claims;
  assert.deepEqual(dependent.dependsOn, [parsed.claims[0].id]);
});

test('V6-03-A02: every snapshot field is required and none is defaulted to the current target', () => {
  const ref = FIXTURES.snapshot;
  for (const field of SNAPSHOT_FIELDS) {
    const withoutField = { ...ref };
    delete withoutField[field];
    assert.equal(rejects(snapshotRefSchema, withoutField), true, `snapshot without ${field} must be rejected`);
  }

  // A five-field draft input must still name its target; the parser never fills it in.
  const input = { ...ref };
  delete input.draftRevisionId;
  delete input.targetId;
  const parsed = draftInputRefSchema.safeParse(input);
  assert.equal(parsed.success, false);
  assert.ok(parsed.error.issues.some((issue) => issue.path.includes('targetId')));

  const validInput = draftInputRefSchema.parse(FIXTURES.draftInput);
  assert.deepEqual(Object.keys(validInput).sort(), SNAPSHOT_FIELDS.filter((field) => field !== 'draftRevisionId').sort());
});

test('V6-03-A02: invalid and stale versions are rejected', () => {
  for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null]) {
    assert.equal(rejects(snapshotRefSchema, { ...FIXTURES.snapshot, sourceVersion: invalid }), true, `version ${String(invalid)}`);
  }
  // Persisted version zero is the creation sentinel, not a snapshot version.
  assert.equal(rejects(snapshotRefSchema, { ...FIXTURES.snapshot, targetConfigVersion: 0 }), true);

  assert.equal(commandSchema(exportRequestSchema).safeParse({ contractVersion: 'v6.0', expectedVersion: 0, payload: FIXTURES.exportRequest }).success, false);
  assert.equal(commandSchema(exportRequestSchema).safeParse({ contractVersion: 'v6.1', expectedVersion: -1, payload: FIXTURES.exportRequest }).success, false);
  assert.equal(commandSchema(exportRequestSchema).safeParse({ contractVersion: 'v6.1', payload: FIXTURES.exportRequest }).success, false);
  // Creation commands may carry expectedVersion 0.
  assert.equal(commandSchema(exportRequestSchema).safeParse({ contractVersion: 'v6.1', expectedVersion: 0, payload: FIXTURES.exportRequest }).success, true);
});

test('V6-03-A02: unknown fields are rejected instead of silently carried', () => {
  assert.equal(rejects(snapshotRefSchema, { ...FIXTURES.snapshot, current: true }), true);
  assert.equal(rejects(matterSchema, { ...FIXTURES.matter, paid: true }), true);
  assert.equal(rejects(matterSchema, { ...FIXTURES.matter, tenantId: undefined }), true);
  assert.equal(
    rejects(commandSchema(exportRequestSchema), { ...FIXTURES.command, actorId: FIXTURE_IDS.user }),
    true,
  );
});

test('V6-03-A02: the closed enums reject unknown members', () => {
  const cases = [
    [contracts.routeSchema, 'us_provisional'],
    [contracts.languageSchema, 'ja-JP'],
    [contracts.roleSchema, 'superadmin'],
    [contracts.runtimeSchema, 'server'],
    [contracts.jobStateSchema, 'paused'],
    [contracts.sectionKindSchema, 'drawings'],
    [contracts.gateActionSchema, 'download_all'],
    [contracts.errorCodeSchema, 'SOMETHING_ELSE'],
    [contracts.exportFormatSchema, 'doc'],
    [contracts.inboxKindSchema, 'promo'],
  ];
  for (const [schema, value] of cases) {
    assert.equal(schema.safeParse(value).success, false, `${value} must not be accepted`);
  }
  assert.deepEqual([...GATE_ACTIONS], ['generate', 'confirm', 'prepare', 'approve', 'export', 'download']);
  assert.equal(ERROR_CODES.length, new Set(ERROR_CODES).size, 'error codes must be unique');
});

test('V6-03-A02: references outside the AST are rejected', () => {
  const base = FIXTURES.draftAst;
  const claim = (index) => base.claims[index].id;
  const clone = () => JSON.parse(JSON.stringify(base));

  const forward = clone();
  forward.claims[0].dependsOn = [claim(1)];
  assert.equal(rejects(draftAstSchema, forward), true, 'a claim cannot depend on a later claim');

  const unknown = clone();
  unknown.claims[1].dependsOn = [FIXTURE_IDS.risk];
  assert.equal(rejects(draftAstSchema, unknown), true, 'dependsOn must reference an existing claim');

  const gap = clone();
  gap.claims[1].number = 3;
  assert.equal(rejects(draftAstSchema, gap), true, 'claim numbers must be contiguous');

  const duplicateNode = clone();
  duplicateNode.claims[1].paragraphs[0].id = duplicateNode.claims[0].paragraphs[0].id;
  assert.equal(rejects(draftAstSchema, duplicateNode), true, 'node ids must be unique within a revision');

  const duplicateSection = clone();
  duplicateSection.sections[1].kind = 'technical_field';
  assert.equal(rejects(draftAstSchema, duplicateSection), true, 'each section kind has one position');

  const danglingSupport = clone();
  danglingSupport.claims[0].features[0].supportParagraphIds = [FIXTURE_IDS.risk];
  assert.equal(rejects(draftAstSchema, danglingSupport), true, 'supportParagraphIds must reference AST nodes');
});

test('V6-03-A02: gate, confirmation and payment invariants hold', () => {
  assert.equal(rejects(gateDecisionSchema, { ...FIXTURES.gateDecision, allowed: false, reasons: [] }), true);
  assert.equal(
    gateDecisionSchema.safeParse({
      ...FIXTURES.gateDecision,
      allowed: false,
      reasons: [{ code: 'CHECK_REQUIRED', resourceId: FIXTURE_IDS.target }],
    }).success,
    true,
  );
  assert.equal(rejects(apiErrorSchema, { ...FIXTURES.apiError, error: { ...FIXTURES.apiError.error, code: 'NOT_A_CODE' } }), true);

  assert.equal(rejects(paymentOrderSchema, { ...FIXTURES.paymentOrder, quoteVersionId: FIXTURE_IDS.quote }), true);
  assert.equal(rejects(paymentOrderSchema, { ...FIXTURES.paymentOrder, priceVersionId: null }), true);
  assert.equal(
    paymentOrderSchema.safeParse({ ...FIXTURES.paymentOrder, purpose: 'service', matterId: null, serviceOrderId: FIXTURE_IDS.serviceOrder }).success,
    false,
  );
  assert.equal(
    paymentOrderSchema.safeParse({ ...FIXTURES.paymentOrder, purpose: 'single_matter', priceVersionId: null, quoteVersionId: FIXTURE_IDS.quote }).success,
    false,
  );
  assert.equal(
    contracts.exportRequestSchema.safeParse({ ...FIXTURES.exportRequest, approvalId: FIXTURE_IDS.approval }).success,
    false,
  );

  const pointsAtNothing = {
    ...FIXTURES.confirmation,
    kind: 'ai_paragraph',
    paragraphId: null,
  };
  assert.equal(rejects(confirmationSchema, pointsAtNothing), true);

  const riskWithoutRun = { ...FIXTURES.confirmation, kind: 'risk_ack', riskId: FIXTURE_IDS.risk, checkRunId: null };
  assert.equal(rejects(confirmationSchema, riskWithoutRun), true);

  const fullRead = { ...FIXTURES.confirmation, kind: 'full_read', paragraphId: FIXTURE_IDS.paragraph1 };
  assert.equal(rejects(confirmationSchema, fullRead), true);
});

test('V6-03-A03: repeated parsing is identical and never mutates the input', () => {
  for (const [key, value] of Object.entries(FIXTURES)) {
    const first = entitySchemas[key].parse(value);
    const second = entitySchemas[key].parse(value);
    assert.deepEqual(first, second, `${key} must parse deterministically`);
    assert.deepEqual(value, FIXTURES[key], `${key} fixture must be unchanged after parsing`);
    assert.equal(JSON.stringify(first), JSON.stringify(second), `${key} must serialize identically`);
  }
});

test('V6-03-A03: parsing adds no defaults and removes no supplied field', () => {
  for (const key of ['matter', 'snapshot', 'command', 'gateContext', 'job', 'receipt']) {
    const value = FIXTURES[key];
    const parsed = entitySchemas[key].parse(value);
    assert.deepEqual(Object.keys(parsed).sort(), Object.keys(value).sort(), `${key} keys must be preserved`);
    assert.equal(JSON.stringify(parsed), JSON.stringify(value), `${key} must serialize in the same shape`);
  }
});

test('V6-03-A03: contract sources import no storage, network or runtime side effect', () => {
  const offenders = [];
  for (const file of readdirSync(CONTRACT_DIR).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(path.join(CONTRACT_DIR, file), 'utf8');
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const specifier = match[1];
      const allowed = specifier === 'zod' || specifier.startsWith('./');
      if (!allowed) offenders.push(`${file}: ${specifier}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('V6-03-A02: activity actions and metadata keys follow the S06 allowlists', () => {
  assert.equal(activitySchema.safeParse(FIXTURES.activity).success, true);
  assert.equal(activitySchema.safeParse({ ...FIXTURES.activity, action: 'job.secret_dump' }).success, false);
  assert.equal(
    activitySchema.safeParse({ ...FIXTURES.activity, metadata: { ...FIXTURES.activity.metadata, requestBody: 'text' } }).success,
    false,
  );
  assert.equal(
    activitySchema.safeParse({ ...FIXTURES.activity, action: 'job.succeeded', metadata: { reason: 'completed' } }).success,
    false,
    'job.succeeded must reject keys not listed for that action',
  );
  assert.equal(
    activitySchema.safeParse({ ...FIXTURES.activity, action: 'privacy.export', metadata: { count: 1 } }).success,
    false,
    'privacy events carry no metadata',
  );
  assert.equal(
    activitySchema.safeParse({ ...FIXTURES.activity, action: 'job.succeeded', metadata: { provider: 'local', model: 'fixture' } }).success,
    true,
    'job.succeeded may record its processor and model identifiers',
  );
  assert.equal(
    activitySchema.safeParse({ ...FIXTURES.activity, action: 'job.succeeded', metadata: { stage: 'complete' } }).success,
    false,
    'job.succeeded requires processor and model identifiers',
  );
  assert.equal(
    activitySchema.safeParse({ ...FIXTURES.activity, action: 'job.adopted', metadata: { version: 1 } }).success,
    false,
    'job.adopted requires processor and model identifiers',
  );
  assert.equal(
    activitySchema.safeParse({ ...FIXTURES.activity, metadata: { ...FIXTURES.activity.metadata, model: 'private prompt text' } }).success,
    false,
    'model identifiers must not accept free-form content',
  );
  assert.equal(
    activitySchema.safeParse({ ...FIXTURES.activity, metadata: { ...FIXTURES.activity.metadata, provider: 'secret token value' } }).success,
    false,
    'provider identifiers must not accept free-form content',
  );
  assert.equal(
    activitySchema.safeParse({ ...FIXTURES.activity, metadata: { ...FIXTURES.activity.metadata, stage: 'private prompt text' } }).success,
    false,
    'stage must not accept free-form content',
  );
});

test('V6-03-A03: contract version and error-code mapping are complete and stable', () => {
  assert.equal(contractVersionSchema.parse('v6.1'), 'v6.1');
  const mapped = Object.keys(HTTP_STATUS_BY_ERROR_CODE).sort();
  assert.deepEqual(mapped, [...ERROR_CODES].sort(), 'every error code has exactly one HTTP status');
  assert.equal(httpStatusForErrorCode('RESOURCE_NOT_FOUND'), 404);
  assert.equal(httpStatusForErrorCode('VERSION_CONFLICT'), 409);
  assert.equal(httpStatusForErrorCode('PROVIDER_TIMEOUT'), 504);
  assert.equal(httpStatusForErrorCode('PROVIDER_AUTH'), 502);
  assert.equal(httpStatusForErrorCode('RELEASE_GATE_CLOSED'), 503);

  for (const id of Object.values(FIXTURE_IDS)) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'fixture ids must be UUIDs');
  }
});
