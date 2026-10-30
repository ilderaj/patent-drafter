#!/usr/bin/env node
// Reproducible negative probes for V6-02. All temporary fixtures live under the
// OS temp directory and are removed in a finally block, so the repository is
// never mutated by this harness.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluateTestRun, main, runNodeTests } from '../../runner.mjs';

const RUNNER_SOURCE = fileURLToPath(new URL('../../runner.mjs', import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(RUNNER_SOURCE), '../..');

function capture() {
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

function report(name, code, stdout, stderr) {
  console.log(`--- ${name} ---`);
  console.log(`exit ${code}`);
  if (stdout) console.log(`stdout:\n${stdout.trimEnd()}`);
  if (stderr) console.log(`stderr:\n${stderr.trimEnd()}`);
  console.log('');
}

function withTempDir(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'v6-02-probe-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeValidBaseline(root) {
  const baseline = path.join(root, 'qa/v6/baseline');
  mkdirSync(baseline, { recursive: true });
  writeFileSync(path.join(baseline, 'manifest.json'), JSON.stringify({ ticket: 'V6-01' }));
  writeFileSync(path.join(baseline, 'receipt.json'), JSON.stringify({
    ticket: 'V6-01',
    acceptance: [
      { id: 'V6-01-A01', exitCode: 0 },
      { id: 'V6-01-A02', exitCode: 0 },
      { id: 'V6-01-A03', exitCode: 0 },
    ],
  }));
}

// Malformed selector: rejected before ticket lookup.
{
  const stdout = capture();
  const stderr = capture();
  report('malformed selector V6-9', main(['V6-9'], { stdout, stderr }), stdout.text, stderr.text);
}

// Unknown two-digit selector: well-formed but not registered.
{
  const stdout = capture();
  const stderr = capture();
  report('unknown selector V6-99', main(['V6-99'], { stdout, stderr }), stdout.text, stderr.text);
}

// Unknown three-digit selector: passes the selector grammar, so it must be
// reported as unknown rather than malformed.
{
  const stdout = capture();
  const stderr = capture();
  report('unknown selector V6-999', main(['V6-999'], { stdout, stderr }), stdout.text, stderr.text);
}

// Missing V6-01 dependency in an otherwise empty temporary root.
withTempDir((root) => {
  const stdout = capture();
  const stderr = capture();
  report('missing V6-01 baseline', main(['V6-02'], { rootDir: root, stdout, stderr }), stdout.text, stderr.text);
});

// Present but incomplete V6-01 acceptance receipt.
withTempDir((root) => {
  const baseline = path.join(root, 'qa/v6/baseline');
  mkdirSync(baseline, { recursive: true });
  writeFileSync(path.join(baseline, 'manifest.json'), JSON.stringify({ ticket: 'V6-01' }));
  writeFileSync(path.join(baseline, 'receipt.json'), JSON.stringify({ ticket: 'V6-01', acceptance: [] }));
  const stdout = capture();
  const stderr = capture();
  report('incomplete V6-01 receipt', main(['V6-02'], { rootDir: root, stdout, stderr }), stdout.text, stderr.text);
});

// Registered ticket whose suite skips every test. Node exits 0 for this case;
// the runner must still fail closed.
withTempDir((root) => {
  writeValidBaseline(root);
  const scenario = path.join(root, 'qa/v6/scenarios/V6-98');
  mkdirSync(scenario, { recursive: true });
  writeFileSync(path.join(scenario, 'all-skip.test.mjs'), [
    "import test from 'node:test';",
    "test('skipped one', { skip: true }, () => {});",
    "test('skipped two', { skip: 'reason' }, () => {});",
    '',
  ].join('\n'));
  const stdout = capture();
  const stderr = capture();
  report('all-skipped registered suite', main(['V6-98'], { rootDir: root, stdout, stderr }), stdout.text, stderr.text);
});

// End-to-end CLI probes reached through a symlinked path. On macOS the OS temp
// directory itself is a symlink (/var -> /private/var), and the checkout may be
// reached through one too. A `path.resolve`-only entry guard silently skips
// main() on such a path and exits 0, so these probes assert the real child
// process exit code as the shell would observe it.
function cliProbe(name, { useLink = true, withBaseline = true, ticket = 'V6-98' } = {}) {
  withTempDir((root) => {
    const link = path.join(root, 'linked');
    symlinkSync(root, link);
    if (withBaseline) writeValidBaseline(root);
    const scenario = path.join(root, 'qa/v6/scenarios/V6-98');
    mkdirSync(scenario, { recursive: true });
    writeFileSync(path.join(scenario, 'all-skip.test.mjs'), [
      "import test from 'node:test';",
      "test('skipped one', { skip: true }, () => {});",
      '',
    ].join('\n'));
    const runnerCopy = path.join(root, 'qa/v6/runner.mjs');
    copyFileSync(RUNNER_SOURCE, runnerCopy);
    const invoked = path.join(useLink ? link : root, 'qa/v6/runner.mjs');
    const result = spawnSync(process.execPath, [invoked, ticket], {
      encoding: 'utf8',
      cwd: path.dirname(runnerCopy),
    });
    report(name, result.status, result.stdout, result.stderr);
  });
}

// All-skipped suite: the control run through the real path, then the same tree
// through a symlinked path. Both must exit 1.
cliProbe('all-skipped registered suite, real path', { useLink: false });
cliProbe('all-skipped registered suite, symlinked path');

// Missing dependency through a symlinked path: must exit 2 instead of doing nothing.
cliProbe('missing V6-01 dependency, symlinked path', { withBaseline: false, ticket: 'V6-02' });

// The real checkout reached through a symlinked path. This is the defect as it
// would appear on a developer machine whose checkout lives behind a symlink:
// the suite must actually run, not silently exit 0.
withTempDir((root) => {
  const link = path.join(root, 'repo');
  symlinkSync(REPO_ROOT, link);
  const result = spawnSync(process.execPath, [path.join(link, 'qa/v6/runner.mjs'), 'V6-02'], {
    encoding: 'utf8',
    cwd: root,
  });
  report('real checkout through symlinked path (V6-02)', result.status, result.stdout, result.stderr);
});

// Missing test command (injected spawn result, no process is started).
{
  const outcome = runNodeTests(['/nonexistent.test.mjs'], {
    spawn: () => ({
      error: Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }),
      status: null,
      stdout: '',
      stderr: '',
    }),
    stdout: capture(),
    stderr: capture(),
  });
  report('missing test command', outcome.exitCode, '', outcome.reason);
}

// Explicit verdict boundaries independent of the Node process.
for (const [name, stdout] of [
  ['total=0', '# tests 0\n# pass 0\n# fail 0\n# skipped 0\n'],
  ['pass=0', '# tests 1\n# pass 0\n# fail 0\n# skipped 0\n'],
  ['skipped>0', '# tests 2\n# pass 0\n# fail 0\n# skipped 2\n'],
  ['missing summary', 'TAP version 13\n'],
]) {
  const outcome = evaluateTestRun({ status: 0, stdout });
  report(`verdict ${name}`, outcome.exitCode, '', outcome.reason);
}
