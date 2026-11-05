#!/usr/bin/env node
// Rejected-input probes for V6-03. Each probe names one contract rule from
// 05-contracts and asserts that the schema closes the hole. Synthetic data only;
// nothing is written to disk and no network or storage is touched.
import {
  apiErrorSchema,
  activitySchema,
  commandSchema,
  draftAstSchema,
  draftInputRefSchema,
  exportRequestSchema,
  gateDecisionSchema,
  matterSchema,
  paymentOrderSchema,
  routeSchema,
  snapshotRefSchema,
  FIXTURES,
  FIXTURE_IDS,
} from '../../../../packages/contracts/src/index.ts';

function issuePaths(result) {
  return result.success ? [] : result.error.issues.map((issue) => (issue.path.length ? issue.path.join('.') : '(root)'));
}

function probe(name, schema, value) {
  const result = schema.safeParse(value);
  const rejected = !result.success;
  console.log(`--- ${name} ---`);
  console.log(rejected ? 'rejected' : 'ACCEPTED (defect)');
  if (rejected) console.log(`issues: ${issuePaths(result).join(', ')}`);
  console.log('');
  return rejected;
}

const ref = FIXTURES.snapshot;
const clone = (value) => JSON.parse(JSON.stringify(value));
const claim = (ast, index) => ast.claims[index].id;

let failed = 0;
const check = (ok) => {
  if (!ok) failed += 1;
};

const withoutTarget = { ...ref };
delete withoutTarget.targetId;
check(probe('snapshot without targetId (no current-target default)', snapshotRefSchema, withoutTarget));

const inputWithoutTarget = { ...FIXTURES.draftInput };
delete inputWithoutTarget.targetId;
check(probe('draft input without targetId', draftInputRefSchema, inputWithoutTarget));

check(probe('snapshot with an unknown field', snapshotRefSchema, { ...ref, current: true }));
check(probe('snapshot with persisted version 0', snapshotRefSchema, { ...ref, sourceVersion: 0 }));
check(probe('command with an old contract version', commandSchema(exportRequestSchema), { ...FIXTURES.command, contractVersion: 'v6.0' }));
check(probe('command carrying a trusted actorId', commandSchema(exportRequestSchema), { ...FIXTURES.command, actorId: FIXTURE_IDS.user }));
check(probe('matter carrying a trusted paid flag', matterSchema, { ...FIXTURES.matter, paid: true }));
check(probe('route outside the closed enum', routeSchema, 'us_provisional'));

const forward = clone(FIXTURES.draftAst);
forward.claims[0].dependsOn = [claim(forward, 1)];
check(probe('claim depending on a later claim', draftAstSchema, forward));

const dangling = clone(FIXTURES.draftAst);
dangling.claims[0].features[0].supportParagraphIds = [FIXTURE_IDS.risk];
check(probe('support paragraph outside the AST', draftAstSchema, dangling));

check(probe('closed gate without a reason', gateDecisionSchema, { ...FIXTURES.gateDecision, allowed: false, reasons: [] }));
check(probe('payment order with price and quote', paymentOrderSchema, { ...FIXTURES.paymentOrder, quoteVersionId: FIXTURE_IDS.quote }));
check(
  probe('api error reason outside ErrorCode', apiErrorSchema, {
    ...FIXTURES.apiError,
    error: { ...FIXTURES.apiError.error, reasons: [{ code: 'RULE_BLOCKED' }] },
  }),
);
check(probe('activity action outside S06 whitelist', activitySchema, { ...FIXTURES.activity, action: 'job.secret_dump' }));
check(
  probe('activity metadata key outside allowlist', activitySchema, {
    ...FIXTURES.activity,
    metadata: { ...FIXTURES.activity.metadata, requestBody: 'sensitive text' },
  }),
);
check(
  probe('activity metadata key not allowed for job.succeeded', activitySchema, {
    ...FIXTURES.activity,
    action: 'job.succeeded',
    metadata: { reason: 'completed' },
  }),
);
check(
  probe('privacy activity with non-empty metadata', activitySchema, {
    ...FIXTURES.activity,
    action: 'privacy.export',
    metadata: { count: 1 },
  }),
);
check(
  probe('job.succeeded missing processor/model identifiers', activitySchema, {
    ...FIXTURES.activity,
    action: 'job.succeeded',
    metadata: { stage: 'complete', count: 1 },
  }),
);
check(
  probe('job.adopted missing processor/model identifiers', activitySchema, {
    ...FIXTURES.activity,
    action: 'job.adopted',
    metadata: { version: 1 },
  }),
);
check(
  probe('activity model field containing free-form content', activitySchema, {
    ...FIXTURES.activity,
    metadata: { ...FIXTURES.activity.metadata, model: 'private prompt text' },
  }),
);
check(
  probe('activity provider field containing free-form content', activitySchema, {
    ...FIXTURES.activity,
    metadata: { ...FIXTURES.activity.metadata, provider: 'secret token value' },
  }),
);
check(
  probe('activity stage field containing free-form content', activitySchema, {
    ...FIXTURES.activity,
    metadata: { ...FIXTURES.activity.metadata, stage: 'private prompt text' },
  }),
);

console.log(failed === 0 ? 'all probes rejected invalid input' : `${failed} probe(s) accepted invalid input`);
process.exitCode = failed === 0 ? 0 : 1;
