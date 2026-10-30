import test from 'node:test';
import assert from 'node:assert/strict';

// The suite imports with explicit `.ts` specifiers; Node runs them with type
// stripping. (The domain modules themselves only import types from each other,
// so no `.js`/`.ts` runtime specifier has to resolve here.)
import {
  confirm,
  revokeConfirmation,
  confirmationStatus,
  currentConfirmations,
  isConfirmationCurrent,
} from '../../../../packages/domain/src/v6/confirmation.ts';
import { evaluateGate, ENGINEERING_RULE_CODES } from '../../../../packages/domain/src/v6/gate.ts';
import { isCurrent } from '../../../../packages/domain/src/v6/revision.ts';
import {
  confirmationSchema,
  revocationSchema,
  gateContextSchema,
  gateDecisionSchema,
  checkRunSchema,
  approvalSchema,
  findingSchema,
  errorCodeSchema,
} from '../../../../packages/contracts/src/index.ts';
import { createDeterministicClock, createDeterministicIds, FIXED_NOW } from '../../fixtures/deterministic.mjs';

const RULE_PACK = '2026.10.1';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

function makeIds(namespace = 'v6-05-fixture') {
  return createDeterministicIds(namespace);
}

function makeClock() {
  return createDeterministicClock();
}

/** One matter with a target and the six-field snapshot every command binds to. */
function makeFixture(namespace = 'v6-05-fixture') {
  const ids = makeIds(namespace);
  const matterId = ids('matter');
  const targetId = ids('target');
  const paragraphA = ids('paragraph-a');
  const paragraphB = ids('paragraph-b');
  const snapshot = (overrides = {}) => ({
    matterId,
    targetId,
    sourceVersion: 3,
    targetConfigVersion: 1,
    draftRevisionId: ids('revision'),
    figureRevisionId: ids('figure-set'),
    ...overrides,
  });
  return { ids, matterId, targetId, paragraphA, paragraphB, snapshot, base: snapshot() };
}

function emptyLedger(matterId) {
  return { matterId, confirmations: [], revocations: [] };
}

function makeCommandContext(namespace) {
  const clock = makeClock();
  return { newId: makeIds(namespace), now: clock.now };
}

function confirmAll(fixture, ledger, snapshot, paragraphs, namespace) {
  const context = makeCommandContext(namespace);
  let state = ledger;
  const created = [];
  for (const paragraphId of paragraphs) {
    const result = confirm(
      state,
      { kind: 'ai_paragraph', snapshot, actorId: fixture.ids('actor'), identity: 'authenticated', paragraphId, aiParagraphIds: paragraphs },
      context,
    );
    assert.equal(result.ok, true, `confirming ${paragraphId} must succeed`);
    state = result.state;
    created.push(result.confirmation);
  }
  return { ledger: state, confirmations: created };
}

function finding(overrides = {}) {
  return {
    id: overrides.id ?? makeIds('v6-05-finding')('finding'),
    category: 'blocker',
    title: 'Synthetic finding',
    explanation: 'Synthetic explanation',
    ruleId: 'figure.duplicate_number',
    requiresAcknowledgement: false,
    anchor: { nodeId: null, section: null, locked: false },
    status: 'open',
    evidenceNodeIds: [],
    ...overrides,
  };
}

function makeCheck(fixture, overrides = {}) {
  return {
    id: fixture.ids('check-run'),
    snapshot: fixture.base,
    rulePackVersion: RULE_PACK,
    state: 'succeeded',
    findings: [],
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

function makeApproval(fixture, overrides = {}) {
  return {
    id: fixture.ids('approval'),
    snapshot: fixture.base,
    checkRunId: fixture.ids('check-run'),
    confirmationIds: [],
    actorId: fixture.ids('approver'),
    purpose: 'internal_release',
    note: 'Synthetic internal release',
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

function makeGateContext(fixture, overrides = {}) {
  return {
    action: 'export',
    snapshot: fixture.base,
    snapshotCurrent: true,
    filesAvailable: true,
    rulePackVersion: RULE_PACK,
    activeRulePackVersion: RULE_PACK,
    checkRun: null,
    approval: null,
    confirmations: [],
    risks: [],
    now: FIXED_NOW,
    ...overrides,
  };
}

function facts(overrides = {}) {
  return {
    packageKind: 'preparation',
    confirmationMode: 'professional_paragraphs',
    inputStale: false,
    aiParagraphIds: [],
    blockingPolicyRuleIds: [],
    ...overrides,
  };
}

/** A professional export that is allowed: current check, both AI paragraphs confirmed. */
function readyProfessionalExport(namespace = 'v6-05-ready') {
  const fixture = makeFixture(namespace);
  const paragraphs = [fixture.paragraphA, fixture.paragraphB];
  const seeded = confirmAll(fixture, emptyLedger(fixture.matterId), fixture.base, paragraphs, `${namespace}-confirm`);
  const checkRun = makeCheck(fixture);
  const context = makeGateContext(fixture, { checkRun, confirmations: seeded.ledger.confirmations });
  return { fixture, ledger: seeded.ledger, checkRun, context, paragraphs };
}

test('V6-05-A01: a current check with every AI paragraph confirmed allows a preparation export', () => {
  const { context, paragraphs } = readyProfessionalExport();
  const decision = evaluateGate(context, facts({ aiParagraphIds: paragraphs }));
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.action, 'export');
  assert.equal(decision.evaluatedAt, FIXED_NOW);
  assert.equal(gateDecisionSchema.safeParse(decision).success, true);
});

test('V6-05-A01: the self-service mode is satisfied by a current full read', () => {
  const fixture = makeFixture('v6-05-full-read');
  const commandContext = makeCommandContext('v6-05-full-read');
  const ledger = emptyLedger(fixture.matterId);
  const read = confirm(
    ledger,
    { kind: 'full_read', snapshot: fixture.base, actorId: fixture.ids('actor'), identity: 'local_self_reported', contentAccess: 'local_unmetered' },
    commandContext,
  );
  assert.equal(read.ok, true);

  const checkRun = makeCheck(fixture);
  const context = makeGateContext(fixture, { checkRun, confirmations: read.state.confirmations });
  const decision = evaluateGate(context, facts({ confirmationMode: 'self_read', aiParagraphIds: [fixture.paragraphA] }));
  assert.equal(decision.allowed, true, JSON.stringify(decision.reasons));

  // Without the read the same export is refused, naming what is missing.
  const withoutRead = evaluateGate(makeGateContext(fixture, { checkRun }), facts({ confirmationMode: 'self_read', aiParagraphIds: [fixture.paragraphA] }));
  assert.equal(withoutRead.allowed, false);
  assert.deepEqual(withoutRead.reasons, [{ code: 'CONFIRMATION_REQUIRED', resourceId: 'full_read' }]);
});

test('V6-05-A01: an internal release requires an approval whose confirmations are still current', () => {
  const { fixture, context, checkRun, ledger } = readyProfessionalExport('v6-05-approval');
  const approval = approvalSchema.parse(
    makeApproval(fixture, { snapshot: fixture.base, checkRunId: checkRun.id, confirmationIds: ledger.confirmations.map((item) => item.id) }),
  );
  const approved = evaluateGate(
    { ...context, approval },
    facts({ packageKind: 'internally_approved', aiParagraphIds: [fixture.paragraphA, fixture.paragraphB] }),
  );
  assert.equal(approved.allowed, true, JSON.stringify(approved.reasons));

  const preparation = evaluateGate(
    { ...context, approval: null },
    facts({ packageKind: 'preparation', aiParagraphIds: [fixture.paragraphA, fixture.paragraphB] }),
  );
  assert.equal(preparation.allowed, true, 'a preparation package does not need an approval');
});

test('V6-05-A01: every produced record and decision is contract-shaped', () => {
  const { fixture, context, checkRun, ledger } = readyProfessionalExport('v6-05-contract');
  for (const item of ledger.confirmations) {
    assert.equal(confirmationSchema.safeParse(item).success, true);
  }
  const approved = { ...context, approval: makeApproval(fixture, { checkRunId: checkRun.id, confirmationIds: ledger.confirmations.map((item) => item.id) }) };
  assert.equal(checkRunSchema.safeParse(checkRun).success, true);
  assert.equal(approvalSchema.safeParse(approved.approval).success, true);
  assert.equal(gateContextSchema.safeParse(approved).success, true);

  const blocked = evaluateGate(
    { ...context, checkRun: makeCheck(fixture, { findings: [finding()] }) },
    facts({ aiParagraphIds: [fixture.paragraphA, fixture.paragraphB] }),
  );
  assert.equal(blocked.allowed, false);
  assert.equal(gateDecisionSchema.safeParse(blocked).success, true);
  for (const reason of blocked.reasons) {
    assert.equal(errorCodeSchema.safeParse(reason.code).success, true, `${reason.code} must be a §10 error code`);
  }
});

test('V6-05-A02: revoking one AI paragraph confirmation closes the gate', () => {
  const { fixture, ledger, context, paragraphs } = readyProfessionalExport('v6-05-revoke');
  const target = ledger.confirmations.find((item) => item.paragraphId === paragraphs[0]);
  const revoked = revokeConfirmation(
    ledger,
    { confirmationId: target.id, actorId: fixture.ids('actor'), reason: '段落内容有误' },
    makeCommandContext('v6-05-revoke'),
  );
  assert.equal(revoked.ok, true);
  assert.equal(revocationSchema.safeParse(revoked.revocation).success, true);

  const live = currentConfirmations(revoked.state, fixture.base);
  assert.equal(live.length, 1, 'the revoked confirmation is no longer live');
  assert.equal(isConfirmationCurrent(revoked.state, target, fixture.base), false);

  const decision = evaluateGate({ ...context, confirmations: live }, facts({ aiParagraphIds: paragraphs }));
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, [{ code: 'CONFIRMATION_REQUIRED', resourceId: paragraphs[0] }]);

  const status = confirmationStatus(revoked.state, fixture.base, paragraphs);
  assert.deepEqual(status.pendingAiParagraphIds, [paragraphs[0]]);
  assert.deepEqual(status.confirmedAiParagraphIds, [paragraphs[1]]);
});

test('V6-05-A02: a new draft revision invalidates every confirmation and the check', () => {
  const { fixture, ledger, paragraphs } = readyProfessionalExport('v6-05-new-revision');
  const nextSnapshot = fixture.snapshot({ sourceVersion: fixture.base.sourceVersion, draftRevisionId: fixture.ids('revision') });

  const status = confirmationStatus(ledger, nextSnapshot, paragraphs);
  assert.equal(status.fullRead, false);
  assert.deepEqual(status.pendingAiParagraphIds, paragraphs, 'no confirmation follows the user to a new revision');

  const stale = evaluateGate(
    makeGateContext(fixture, {
      snapshot: nextSnapshot,
      checkRun: makeCheck(fixture, { snapshot: fixture.base }),
      confirmations: currentConfirmations(ledger, nextSnapshot),
    }),
    facts({ aiParagraphIds: paragraphs }),
  );
  assert.equal(stale.allowed, false);
  assert.equal(stale.reasons.some((item) => item.code === 'CHECK_REQUIRED'), true, 'the old check no longer speaks for this snapshot');
});

test('V6-05-A02: rebinding a figure expires the check, so export is refused with CHECK_REQUIRED', () => {
  const { fixture, context, checkRun, paragraphs } = readyProfessionalExport('v6-05-figure-rebind');
  const rebound = { ...fixture.base, figureRevisionId: fixture.ids('other-figure-set') };
  assert.equal(isCurrent(fixture.base, rebound), false);

  const decision = evaluateGate(
    { ...context, snapshot: rebound, checkRun, confirmations: currentConfirmations({ matterId: fixture.matterId, confirmations: context.confirmations, revocations: [] }, rebound) },
    facts({ aiParagraphIds: paragraphs }),
  );
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, [{ code: 'CHECK_REQUIRED', resourceId: checkRun.id }], 'the check that speaks for the old figure set is named');
});

test('V6-05-A02: a check that was never run is refused with CHECK_REQUIRED', () => {
  const fixture = makeFixture('v6-05-no-check');
  const decision = evaluateGate(makeGateContext(fixture), facts());
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, [{ code: 'CHECK_REQUIRED' }]);
});

test('V6-05-A02: a failed check is never read as "no risk"', () => {
  const fixture = makeFixture('v6-05-failed-check');
  const decision = evaluateGate(
    makeGateContext(fixture, { checkRun: makeCheck(fixture, { state: 'failed' }) }),
    facts(),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasons[0].code, 'CHECK_REQUIRED');
});

test('V6-05-A02: a rule pack upgrade expires the existing check', () => {
  const { fixture, context, checkRun } = readyProfessionalExport('v6-05-pack-upgrade');
  const decision = evaluateGate(
    { ...context, checkRun, activeRulePackVersion: '2026.11.1' },
    facts({ aiParagraphIds: [fixture.paragraphA, fixture.paragraphB] }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasons.some((item) => item.code === 'CHECK_REQUIRED'), true);
});

test('V6-05-A02: a duplicate figure number blocks export with its own reason code', () => {
  const { fixture, context, paragraphs } = readyProfessionalExport('v6-05-blocker');
  const duplicate = finding({ ruleId: 'figure.duplicate_number' });
  const decision = evaluateGate(
    { ...context, checkRun: makeCheck(fixture, { findings: [duplicate] }) },
    facts({ aiParagraphIds: paragraphs }),
  );
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, [{ code: 'DUPLICATE_FIGURE_NUMBER', resourceId: duplicate.id }]);
  assert.equal(findingSchema.safeParse(duplicate).success, true);

  // A blocker from a rule without its own code is still refused, never allowed.
  const unknown = finding({ ruleId: 'section.required_empty' });
  const unknownDecision = evaluateGate(
    { ...context, checkRun: makeCheck(fixture, { findings: [unknown] }) },
    facts({ aiParagraphIds: paragraphs }),
  );
  assert.deepEqual(unknownDecision.reasons, [{ code: 'GATE_BLOCKED', resourceId: unknown.id }]);
});

test('V6-05-A02: an unverified legal finding never blocks', () => {
  const { fixture, context, paragraphs } = readyProfessionalExport('v6-05-unverified');
  const unverified = finding({ category: 'unverified', ruleId: 'rule.legal.cn.priority' });
  const decision = evaluateGate(
    { ...context, checkRun: makeCheck(fixture, { findings: [unverified] }) },
    facts({ aiParagraphIds: paragraphs }),
  );
  assert.equal(decision.allowed, true, JSON.stringify(decision.reasons));
});

test('V6-05-A02: acknowledging a blocker does not resolve it', () => {
  const { fixture, context, paragraphs } = readyProfessionalExport('v6-05-blocker-ack');
  const acknowledged = finding({ status: 'acknowledged', ruleId: 'figure.duplicate_number' });
  const decision = evaluateGate(
    { ...context, checkRun: makeCheck(fixture, { findings: [acknowledged] }) },
    facts({ aiParagraphIds: paragraphs }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasons[0].code, 'DUPLICATE_FIGURE_NUMBER');

  // Only a finding absent from a new successful check lets the export through.
  const rerun = evaluateGate(
    { ...context, checkRun: makeCheck(fixture, { findings: [] }) },
    facts({ aiParagraphIds: paragraphs }),
  );
  assert.equal(rerun.allowed, true);
});

test('V6-05-A02: a blocker still blocks when its finding claims to be resolved', () => {
  const { fixture, context, paragraphs } = readyProfessionalExport('v6-05-blocker-resolved');
  const resolved = finding({ status: 'resolved', ruleId: 'figure.duplicate_number' });
  const decision = evaluateGate(
    { ...context, checkRun: makeCheck(fixture, { findings: [resolved] }) },
    facts({ aiParagraphIds: paragraphs }),
  );
  assert.equal(decision.allowed, false, 'a status value cannot clear a blocker; only a rerun can');
  assert.deepEqual(decision.reasons, [{ code: 'DUPLICATE_FIGURE_NUMBER', resourceId: resolved.id }]);
});

test('V6-05-A02: a policy finding blocks only the action its rule declares', () => {
  const { fixture, context, paragraphs } = readyProfessionalExport('v6-05-policy');
  const policy = finding({ category: 'policy', ruleId: 'policy.local_only_storage', requiresAcknowledgement: true });
  const blocked = { ...context, checkRun: makeCheck(fixture, { findings: [policy] }) };

  const undeclared = evaluateGate(blocked, facts({ aiParagraphIds: paragraphs }));
  assert.equal(undeclared.allowed, true, 'a product policy that declares no action does not block');

  const declared = evaluateGate(blocked, facts({ aiParagraphIds: paragraphs, blockingPolicyRuleIds: [policy.ruleId] }));
  assert.deepEqual(declared.reasons, [{ code: 'GATE_BLOCKED', resourceId: policy.id }]);

  const otherRule = evaluateGate(blocked, facts({ aiParagraphIds: paragraphs, blockingPolicyRuleIds: ['policy.other'] }));
  assert.equal(otherRule.allowed, true, 'only the declared rule blocks, not every policy');
});

test('V6-05-A02: a risk that needs acknowledgement is not cleared by a resolved status', () => {
  const fixture = makeFixture('v6-05-resolved-risk');
  const risk = finding({ category: 'risk', ruleId: 'risk.disclosure', requiresAcknowledgement: true, status: 'resolved' });
  const checkRun = makeCheck(fixture, { findings: [risk] });
  const base = makeGateContext(fixture, { checkRun });
  assert.deepEqual(evaluateGate(base, facts()).reasons, [{ code: 'CONFIRMATION_REQUIRED', resourceId: risk.id }], 'a present risk still needs its acknowledgement');

  const acked = confirm(
    emptyLedger(fixture.matterId),
    { kind: 'risk_ack', snapshot: fixture.base, actorId: fixture.ids('actor'), identity: 'authenticated', riskId: risk.id, checkRunId: checkRun.id },
    makeCommandContext('v6-05-resolved-risk'),
  );
  assert.equal(acked.ok, true);
  assert.deepEqual(evaluateGate({ ...base, confirmations: acked.state.confirmations }, facts()).reasons, []);
});

test('V6-05-A02: a risk the context carries but the check does not repeat still applies', () => {
  const fixture = makeFixture('v6-05-context-risk');
  const risk = finding({ category: 'risk', ruleId: 'risk.disclosure', requiresAcknowledgement: true });
  const { status, evidenceNodeIds, ...riskDto } = risk;
  assert.equal(status, 'open');
  assert.deepEqual(evidenceNodeIds, []);
  const decision = evaluateGate(makeGateContext(fixture, { checkRun: makeCheck(fixture), risks: [riskDto] }), facts());
  assert.deepEqual(decision.reasons, [{ code: 'CONFIRMATION_REQUIRED', resourceId: risk.id }]);
});

test('V6-05-A02: a risk needs a current acknowledgement and an older check run does not count', () => {
  const fixture = makeFixture('v6-05-risk');
  const risk = finding({ category: 'risk', ruleId: 'risk.disclosure', requiresAcknowledgement: true });
  const checkRun = makeCheck(fixture, { findings: [risk] });
  const commandContext = makeCommandContext('v6-05-risk');
  const base = makeGateContext(fixture, { checkRun });

  const pending = evaluateGate(base, facts());
  assert.deepEqual(pending.reasons, [{ code: 'CONFIRMATION_REQUIRED', resourceId: risk.id }]);

  const acked = confirm(
    emptyLedger(fixture.matterId),
    { kind: 'risk_ack', snapshot: fixture.base, actorId: fixture.ids('actor'), identity: 'authenticated', riskId: risk.id, checkRunId: checkRun.id },
    commandContext,
  );
  assert.equal(acked.ok, true);
  assert.equal(confirmationSchema.safeParse(acked.confirmation).success, true);
  assert.deepEqual(evaluateGate({ ...base, confirmations: acked.state.confirmations }, facts()).reasons, []);

  // The same risk, raised again by a new check run: the old acknowledgement is not inherited.
  const rerun = makeCheck(fixture, { findings: [risk] });
  const afterRerun = evaluateGate({ ...base, checkRun: rerun, confirmations: acked.state.confirmations }, facts());
  assert.deepEqual(afterRerun.reasons, [{ code: 'CONFIRMATION_REQUIRED', resourceId: risk.id }]);
});

test('V6-05-A02: an approval stops authorising export once a confirmation it cites is revoked', () => {
  const { fixture, ledger, checkRun, context, paragraphs } = readyProfessionalExport('v6-05-approval-revoke');
  const approval = makeApproval(fixture, {
    snapshot: fixture.base,
    checkRunId: checkRun.id,
    confirmationIds: ledger.confirmations.map((item) => item.id),
  });
  const approved = { ...context, approval };
  const packageFacts = facts({ packageKind: 'internally_approved', aiParagraphIds: paragraphs });
  assert.equal(evaluateGate(approved, packageFacts).allowed, true);

  const revoked = revokeConfirmation(
    ledger,
    { confirmationId: approval.confirmationIds[0], actorId: fixture.ids('actor'), reason: '撤销确认' },
    makeCommandContext('v6-05-approval-revoke'),
  );
  const live = currentConfirmations(revoked.state, fixture.base);
  const decision = evaluateGate({ ...approved, confirmations: live }, packageFacts);
  assert.equal(decision.allowed, false);
  // Two dependencies of the same revocation: the paragraph is unconfirmed again,
  // and the approval that cited that confirmation no longer covers the export.
  const revokedParagraph = ledger.confirmations.find((item) => item.id === approval.confirmationIds[0]).paragraphId;
  assert.deepEqual(decision.reasons, [
    { code: 'CONFIRMATION_REQUIRED', resourceId: revokedParagraph },
    { code: 'APPROVAL_REQUIRED', resourceId: approval.confirmationIds[0] },
  ]);
});

test('V6-05-A02: input staleness and a missing approval both close the gate with their own codes', () => {
  const { context, paragraphs } = readyProfessionalExport('v6-05-inputs');
  const stale = evaluateGate(context, facts({ inputStale: true, aiParagraphIds: paragraphs }));
  assert.deepEqual(stale.reasons, [{ code: 'INPUT_STALE' }]);

  const noApproval = evaluateGate(context, facts({ packageKind: 'internally_approved', aiParagraphIds: paragraphs }));
  assert.deepEqual(noApproval.reasons, [{ code: 'APPROVAL_REQUIRED' }]);
});

test('V6-05-A02: a confirmation that does not describe a real claim is refused', () => {
  const fixture = makeFixture('v6-05-invalid');
  const commandContext = makeCommandContext('v6-05-invalid');
  const ledger = emptyLedger(fixture.matterId);

  const previewRead = confirm(
    ledger,
    { kind: 'full_read', snapshot: fixture.base, actorId: fixture.ids('actor'), identity: 'authenticated', contentAccess: 'preview' },
    commandContext,
  );
  assert.equal(previewRead.ok, false);
  assert.equal(previewRead.error.code, 'ACTION_FORBIDDEN');
  assert.equal(previewRead.state, ledger, 'a refusal writes nothing');

  const wrongParagraph = confirm(
    ledger,
    { kind: 'ai_paragraph', snapshot: fixture.base, actorId: fixture.ids('actor'), identity: 'authenticated', paragraphId: fixture.ids('unknown'), aiParagraphIds: [fixture.paragraphA] },
    commandContext,
  );
  assert.equal(wrongParagraph.ok, false);
  assert.equal(wrongParagraph.error.code, 'INVALID_INPUT');

  const otherMatter = confirm(
    ledger,
    { kind: 'full_read', snapshot: { ...fixture.base, matterId: fixture.ids('other-matter') }, actorId: fixture.ids('actor'), identity: 'authenticated', contentAccess: 'full' },
    commandContext,
  );
  assert.equal(otherMatter.ok, false);
  assert.equal(otherMatter.error.code, 'RESOURCE_NOT_FOUND');

  const unknown = revokeConfirmation(ledger, { confirmationId: fixture.ids('missing'), actorId: fixture.ids('actor'), reason: 'x' }, commandContext);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'RESOURCE_NOT_FOUND');
});

test('V6-05-A03: the same inputs produce the same decision and mutate nothing', () => {
  const fixture = makeFixture('v6-05-pure');
  const paragraphs = [fixture.paragraphA, fixture.paragraphB];
  const seeded = confirmAll(fixture, emptyLedger(fixture.matterId), fixture.base, paragraphs, 'v6-05-pure-confirm');
  const context = deepFreeze(makeGateContext(fixture, { checkRun: makeCheck(fixture), confirmations: seeded.ledger.confirmations }));
  const gateFacts = deepFreeze(facts({ aiParagraphIds: paragraphs }));
  const ledgerBefore = deepFreeze(seeded.ledger);

  const first = evaluateGate(context, gateFacts);
  const second = evaluateGate(context, gateFacts);
  assert.deepEqual(second, first, 'a pure gate answers the same question the same way');
  assert.deepEqual(seeded.ledger, ledgerBefore, 'the ledger is not read-modified');

  // Running the same confirmation twice records one row and reports the repeat.
  const commandContext = makeCommandContext('v6-05-pure-confirm');
  const again = confirm(
    ledgerBefore,
    { kind: 'ai_paragraph', snapshot: fixture.base, actorId: seeded.confirmations[0].actorId, identity: 'authenticated', paragraphId: paragraphs[0], aiParagraphIds: paragraphs },
    commandContext,
  );
  assert.equal(again.ok, true);
  assert.equal(again.created, false);
  assert.equal(again.state, ledgerBefore, 'a repeat adds nothing');
  assert.equal(again.confirmation.id, seeded.confirmations[0].id);
});

test('V6-05-A03: revoking is append-only and a repeat revocation is a refused transition', () => {
  const fixture = makeFixture('v6-05-append');
  const seeded = confirmAll(fixture, emptyLedger(fixture.matterId), fixture.base, [fixture.paragraphA], 'v6-05-append-confirm');
  const commandContext = makeCommandContext('v6-05-append');
  const target = seeded.confirmations[0];

  const first = revokeConfirmation(seeded.ledger, { confirmationId: target.id, actorId: fixture.ids('actor'), reason: '撤销' }, commandContext);
  assert.equal(first.ok, true);
  assert.deepEqual(first.state.confirmations, seeded.ledger.confirmations, 'the confirmation row is kept, not edited');
  assert.equal(first.state.revocations.length, 1);

  const second = revokeConfirmation(first.state, { confirmationId: target.id, actorId: fixture.ids('actor'), reason: '撤销' }, commandContext);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'INVALID_TRANSITION');
  assert.equal(second.state, first.state);
});

test('V6-05-A03: only prepare, approve and export consult the rule pack', () => {
  const { fixture, context, paragraphs } = readyProfessionalExport('v6-05-actions');
  const withoutCheck = { ...context, checkRun: null };

  for (const action of ['generate', 'confirm', 'download']) {
    const decision = evaluateGate({ ...withoutCheck, action, snapshotCurrent: action !== 'generate' }, facts({ aiParagraphIds: paragraphs }));
    assert.equal(decision.reasons.some((item) => item.code === 'CHECK_REQUIRED'), false, `${action} does not require a check`);
  }
  const staleGenerate = evaluateGate({ ...context, action: 'generate', snapshotCurrent: false }, facts({ aiParagraphIds: paragraphs }));
  assert.equal(staleGenerate.allowed, true, 'generation creates the snapshot it works on');
  const staleConfirm = evaluateGate({ ...context, action: 'confirm', snapshotCurrent: false }, facts({ aiParagraphIds: paragraphs }));
  assert.deepEqual(staleConfirm.reasons, [{ code: 'STALE_BINDING' }]);
});

test('V6-05-A03: every code the gate can emit is a contract error code', () => {
  const { fixture, context, paragraphs } = readyProfessionalExport('v6-05-codes');
  const blockedFor = (ruleId) =>
    evaluateGate(
      { ...context, checkRun: makeCheck(fixture, { findings: [finding({ ruleId })] }) },
      facts({ aiParagraphIds: paragraphs }),
    );
  const decisions = [
    evaluateGate({ ...context, action: 'download', snapshotCurrent: false }, facts()),
    evaluateGate({ ...context, action: 'generate', filesAvailable: false }, facts()),
    evaluateGate({ ...context, checkRun: null }, facts({ aiParagraphIds: paragraphs })),
    blockedFor('ast.invalid'),
    blockedFor('asset.bad_drawing'),
    blockedFor('asset.missing_bytes'),
    blockedFor('figure.duplicate_number'),
    blockedFor('section.required_empty'),
    evaluateGate(context, facts({ aiParagraphIds: [fixture.ids('unconfirmed')] })),
    evaluateGate(context, facts({ aiParagraphIds: paragraphs, inputStale: true })),
    evaluateGate(context, facts({ aiParagraphIds: paragraphs, packageKind: 'internally_approved' })),
  ];
  const codes = new Set(decisions.flatMap((decision) => decision.reasons.map((reason) => reason.code)));
  assert.deepEqual([...codes].toSorted(), [
    'APPROVAL_REQUIRED',
    'BAD_DRAWING',
    'CHECK_REQUIRED',
    'CONFIRMATION_REQUIRED',
    'DUPLICATE_FIGURE_NUMBER',
    'GATE_BLOCKED',
    'INPUT_STALE',
    'INVALID_AST',
    'MISSING_BYTES',
    'STALE_BINDING',
  ]);
  for (const decision of decisions) {
    for (const reason of decision.reasons) {
      assert.equal(errorCodeSchema.safeParse(reason.code).success, true, `${reason.code} must be a §10 error code`);
    }
  }
  for (const code of Object.values(ENGINEERING_RULE_CODES)) {
    assert.equal(codes.has(code), true, `${code} must be exercised above`);
  }
  assert.equal(Object.isFrozen(ENGINEERING_RULE_CODES), true);
});

/**
 * confirmation.ts and gate.ts each carry a private copy of snapshot equality
 * (see the comment on either copy); this is the proof those copies match
 * `revision.isCurrent`, field for field, rather than merely "usually".
 */
test('V6-05-A03: both snapshot-equality copies agree with revision.isCurrent on every field', () => {
  const fixture = makeFixture('v6-05-parity');
  const paragraphs = [fixture.paragraphA];
  const seeded = confirmAll(fixture, emptyLedger(fixture.matterId), fixture.base, paragraphs, 'v6-05-parity-confirm');
  const checkRun = makeCheck(fixture);
  const probes = {
    matterId: fixture.ids('other-matter'),
    targetId: fixture.ids('other-target'),
    sourceVersion: fixture.base.sourceVersion + 1,
    targetConfigVersion: fixture.base.targetConfigVersion + 1,
    draftRevisionId: fixture.ids('other-revision'),
    figureRevisionId: fixture.ids('other-figure-set'),
  };
  assert.deepEqual(Object.keys(probes).toSorted(), Object.keys(fixture.base).toSorted(), 'one probe per SnapshotRef field');

  // The same content under a fresh object is still the same snapshot.
  assert.equal(isCurrent(fixture.base, { ...fixture.base }), true);
  assert.deepEqual(confirmationStatus(seeded.ledger, { ...fixture.base }, paragraphs).pendingAiParagraphIds, []);
  assert.equal(
    evaluateGate(makeGateContext(fixture, { checkRun, confirmations: seeded.ledger.confirmations }), facts({ aiParagraphIds: paragraphs })).allowed,
    true,
  );

  for (const [field, value] of Object.entries(probes)) {
    const changed = { ...fixture.base, [field]: value };
    assert.equal(isCurrent(fixture.base, changed), false, `isCurrent must notice ${field}`);

    // The confirmation.ts copy: the paragraph confirmation no longer counts.
    assert.deepEqual(
      confirmationStatus(seeded.ledger, changed, paragraphs).pendingAiParagraphIds,
      paragraphs,
      `confirmation.ts must notice ${field}`,
    );

    // The gate.ts copy: it must read that same confirmation as absent.
    const decision = evaluateGate(
      makeGateContext(fixture, { snapshot: changed, checkRun: { ...checkRun, snapshot: changed }, confirmations: seeded.ledger.confirmations }),
      facts({ aiParagraphIds: paragraphs }),
    );
    assert.ok(
      decision.reasons.some((item) => item.code === 'CONFIRMATION_REQUIRED' && item.resourceId === fixture.paragraphA),
      `gate.ts must notice ${field}`,
    );
  }
});
