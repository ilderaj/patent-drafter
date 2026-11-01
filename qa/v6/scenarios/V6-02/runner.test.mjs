import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDeterministicClock, createDeterministicIds, createDualTenantFixture } from '../../fixtures/deterministic.mjs';

function createSink() {
  let text = '';
  return {
    write(chunk) {
      text += String(chunk);
      return true;
    },
    get text() {
      return text;
    },
  };
}

async function withTempDir(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'v6-02-'));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('V6-02-A01: selectors resolve one ticket without running neighboring tickets', async () => {
  const { parseArgs, selectTicketTests } = await import('../../runner.mjs');
  const args = parseArgs(['V6-02']);
  const selection = selectTicketTests(args.ticket, ['V6-01', 'V6-02', 'V6-03']);
  assert.equal(args.ticket, 'V6-02');
  assert.deepEqual(selection, ['V6-02']);
});

test('V6-02-A01: TAP summary parsing is order-independent and reporter-agnostic', async () => {
  const { parseTapSummary } = await import('../../runner.mjs');
  const reorderedTap = '# skipped 0\n# fail 0\n# pass 3\n# tests 3\n# cancelled 0\n# todo 0\n';
  assert.deepEqual(parseTapSummary(reorderedTap), {
    total: 3,
    pass: 3,
    fail: 0,
    skipped: 0,
    cancelled: 0,
    todo: 0,
  });
  const specSummary = 'ℹ tests 4\nℹ pass 4\nℹ fail 0\nℹ skipped 0\n';
  assert.equal(parseTapSummary(specSummary).total, 4);
  assert.equal(parseTapSummary('TAP version 13\nno summary here\n'), null);
});

test('V6-02-A02: malformed selectors are invalid while unregistered selectors are unknown', async () => {
  const { main, parseArgs, selectTicketTests } = await import('../../runner.mjs');

  // V6-999 is syntactically valid under the selector grammar; it is unknown,
  // not malformed, because no such ticket is registered.
  assert.deepEqual(parseArgs(['V6-999']), { ticket: 'V6-999' });
  assert.throws(() => selectTicketTests('V6-999', ['V6-01', 'V6-02']), /Unknown ticket: V6-999/);

  for (const malformed of ['V6-9', 'V6-02B', 'V6-02x2', 'v6-02', 'not-a-ticket']) {
    assert.throws(() => parseArgs([malformed]), /Invalid ticket selector/);
  }
  assert.throws(() => parseArgs([]), /Usage/);

  const unknownStderr = createSink();
  assert.equal(main(['V6-999'], { stdout: createSink(), stderr: unknownStderr }), 2);
  assert.match(unknownStderr.text, /Unknown ticket: V6-999/);

  const malformedStderr = createSink();
  assert.equal(main(['V6-9'], { stdout: createSink(), stderr: malformedStderr }), 2);
  assert.match(malformedStderr.text, /Invalid ticket selector: V6-9/);
});

test('V6-02-A02: verdict rejects empty, zero-pass, and skipped summaries', async () => {
  const { evaluateTestRun } = await import('../../runner.mjs');
  const summary = (tests, pass, skipped = 0, fail = 0) =>
    `# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skipped}\n`;

  assert.match(evaluateTestRun({ status: 0, stdout: summary(0, 0) }).reason, /total=0/);
  assert.match(evaluateTestRun({ status: 0, stdout: summary(1, 0) }).reason, /pass=0/);
  assert.match(evaluateTestRun({ status: 0, stdout: summary(2, 0, 2) }).reason, /skipped/);
  assert.match(evaluateTestRun({ status: 0, stdout: summary(1, 0, 0, 1) }).reason, /failed/);
  assert.match(evaluateTestRun({ status: 0, stdout: 'TAP version 13\n' }).reason, /summary not found/);
  const nonZeroStatus = evaluateTestRun({ status: 7, stdout: summary(1, 1) });
  assert.equal(nonZeroStatus.exitCode, 7);
  assert.match(nonZeroStatus.reason, /exited with code 7/);
  assert.equal(evaluateTestRun({ status: 0, stdout: summary(1, 1) }).ok, true);
  assert.equal(evaluateTestRun({ error: new Error('spawn node ENOENT') }).exitCode, 1);
});

test('V6-02-A02: all-skipped temporary suite fails closed despite exit status 0', async () => {
  const { runNodeTests } = await import('../../runner.mjs');
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'all-skip.test.mjs');
    writeFileSync(file, [
      "import test from 'node:test';",
      "test('skipped one', { skip: true }, () => {});",
      "test('skipped two', { skip: 'reason' }, () => {});",
      '',
    ].join('\n'));
    const outcome = runNodeTests([file], { stdout: createSink(), stderr: createSink(), cwd: dir });
    assert.equal(outcome.ok, false);
    assert.notEqual(outcome.exitCode, 0);
    assert.equal(outcome.summary.total, 2);
    assert.equal(outcome.summary.pass, 0);
    assert.equal(outcome.summary.skipped, 2);
    assert.match(outcome.reason, /skipped/);
  });
});

test('V6-02-A02: missing test command fails closed', async () => {
  const { runNodeTests } = await import('../../runner.mjs');
  const missingSpawn = () => ({
    error: Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }),
    status: null,
    stdout: '',
    stderr: '',
  });
  const outcome = runNodeTests(['/nonexistent.test.mjs'], {
    spawn: missingSpawn,
    stdout: createSink(),
    stderr: createSink(),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.reason, /Unable to launch Node test runner/);

  const throwing = runNodeTests(['/nonexistent.test.mjs'], {
    spawn: () => {
      throw new Error('spawn blew up');
    },
    stdout: createSink(),
    stderr: createSink(),
  });
  assert.equal(throwing.ok, false);
  assert.match(throwing.reason, /spawn blew up/);
});

test('V6-02-A02: missing or incomplete V6-01 dependency fails closed without repo writes', async () => {
  const { main } = await import('../../runner.mjs');

  await withTempDir(async (dir) => {
    const missingStderr = createSink();
    assert.equal(main(['V6-02'], { rootDir: dir, stdout: createSink(), stderr: missingStderr }), 2);
    assert.match(missingStderr.text, /DEPENDENCY_MISSING: V6-01 baseline manifest or receipt is missing/);
    assert.equal(existsSync(path.join(dir, 'qa')), false, 'missing dependency must not create repo paths');
  });

  await withTempDir(async (dir) => {
    const baseline = path.join(dir, 'qa/v6/baseline');
    mkdirSync(baseline, { recursive: true });
    writeFileSync(path.join(baseline, 'manifest.json'), JSON.stringify({ ticket: 'V6-01' }));
    writeFileSync(path.join(baseline, 'receipt.json'), JSON.stringify({ ticket: 'V6-01', acceptance: [] }));
    const incompleteStderr = createSink();
    assert.equal(main(['V6-02'], { rootDir: dir, stdout: createSink(), stderr: incompleteStderr }), 2);
    assert.match(incompleteStderr.text, /DEPENDENCY_MISSING: V6-01 acceptance receipt is incomplete/);
  });
});

test('V6-02-A03: clock, IDs, and tenant ownership are deterministic', () => {
  const clock = createDeterministicClock();
  const before = clock.now();
  assert.equal(before, '2026-10-30T12:00:00.000Z');
  assert.equal(clock.advance(1000), '2026-10-30T12:00:01.000Z');
  assert.equal(createDeterministicIds('repeat')('matter'), createDeterministicIds('repeat')('matter'));

  const fixture = createDualTenantFixture();
  const [sessionA, sessionB] = fixture.sessions;
  const [tenantA, tenantB] = fixture.tenants;
  assert.equal(fixture.resourceFor(sessionA, tenantA.matterId).tenantId, sessionA.tenantId);
  assert.equal(fixture.resourceFor(sessionA, tenantB.matterId), null);
  assert.equal(fixture.resourceFor(sessionB, tenantA.matterId), null);
  assert.equal(fixture.resourceFor(sessionB, tenantB.matterId).tenantId, sessionB.tenantId);
});

test('V6-02-A03: entry-point detection resolves symlinked script paths', async () => {
  const runnerPath = new URL('../../runner.mjs', import.meta.url);
  const { isEntryPoint } = await import('../../runner.mjs');
  const { symlinkSync, realpathSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const real = realpathSync(fileURLToPath(runnerPath));
  assert.equal(isEntryPoint(real), true);
  assert.equal(isEntryPoint(process.execPath), false);
  assert.equal(isEntryPoint(undefined), false);

  await withTempDir((dir) => {
    const link = path.join(dir, 'runner-link.mjs');
    symlinkSync(real, link);
    assert.equal(isEntryPoint(link), true, 'symlinked path must still be treated as the entry point');
  });
});

test('V6-02-A03: passing temporary suite yields a stable zero exit', async () => {
  const { runNodeTests } = await import('../../runner.mjs');
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'pass.test.mjs');
    writeFileSync(file, [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('passes', () => assert.equal(1, 1));",
      '',
    ].join('\n'));
    const outcome = runNodeTests([file], { stdout: createSink(), stderr: createSink(), cwd: dir });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.exitCode, 0);
    assert.deepEqual(outcome.summary, { total: 1, pass: 1, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
  });
});
