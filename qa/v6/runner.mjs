#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readdirSync, existsSync, readFileSync, realpathSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = fileURLToPath(import.meta.url);

// Ticket selectors use a V6- prefix, two or more digits, and an optional
// subticket letter. A well-formed selector that is not registered must fail as
// an unknown ticket, not as a malformed selector.
const TICKET_SELECTOR = /^V6-\d{2,}[a-z]?$/;

export const REGRESSION_COMMANDS = Object.freeze([
  Object.freeze({ name: 'worker', command: ['npm', 'run', 'test', '-w', 'apps/worker'] }),
  Object.freeze({ name: 'export', command: ['npm', 'run', 'test', '-w', 'packages/export'] }),
  Object.freeze({ name: 'vibescanner-core', command: ['npm', 'run', 'test', '-w', 'packages/vibescanner-core'] }),
  Object.freeze({ name: 'vibescanner-web', command: ['npm', 'run', 'test', '-w', 'apps/vibescanner-web'] }),
  Object.freeze({ name: 'vibescanner-worker', command: ['npm', 'run', 'test', '-w', 'apps/vibescanner-worker'] }),
]);

export function parseArgs(args) {
  const flags = args.filter((arg) => arg.startsWith('-'));
  const unknown = flags.filter((flag) => flag !== '--all');
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
  const positionals = args.filter((arg) => !arg.startsWith('-'));
  if (flags.includes('--all')) {
    if (positionals.length > 0) throw new Error('Usage: npm run test:v6 -- [V6-xx | --all]');
    return { all: true };
  }
  const ticket = positionals.at(-1);
  if (!ticket) throw new Error('Usage: npm run test:v6 -- V6-xx');
  if (!TICKET_SELECTOR.test(ticket)) throw new Error(`Invalid ticket selector: ${ticket}`);
  return { ticket };
}

export function selectTicketTests(ticket, registeredTickets) {
  if (registeredTickets.length === 0) throw new Error('No tests registered');
  if (!registeredTickets.includes(ticket)) throw new Error(`Unknown ticket: ${ticket}`);
  return [ticket];
}

export function validateV601Dependency({ manifest, receipt }) {
  if (!manifest || !receipt || manifest.ticket !== 'V6-01' || receipt.ticket !== 'V6-01') {
    throw new Error('DEPENDENCY_MISSING: V6-01 baseline manifest or receipt is missing');
  }
  const acceptance = receipt.acceptance ?? [];
  if (!['V6-01-A01', 'V6-01-A02', 'V6-01-A03'].every((id) =>
    acceptance.some((item) => item.id === id && typeof item.exitCode === 'number' && item.exitCode === 0))) {
    throw new Error('DEPENDENCY_MISSING: V6-01 acceptance receipt is incomplete');
  }
}

/**
 * Parse a Node test-runner summary from TAP or spec-reporter output.
 * The summary lines may appear in any order and may use either the TAP "#"
 * prefix or the spec reporter "ℹ" prefix. Returns null when the summary is
 * absent or incomplete.
 */
export function parseTapSummary(stdout) {
  if (typeof stdout !== 'string') return null;
  const clean = stdout.replace(/\u001b\[[0-9;]*m/g, '');
  const counts = {};
  const summaryLine = /^\s*(?:#|ℹ)\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/;
  for (const line of clean.split(/\r?\n/)) {
    const match = summaryLine.exec(line);
    if (match) counts[match[1]] = Number(match[2]);
  }
  if (!['tests', 'pass', 'fail', 'skipped'].every((key) => Number.isInteger(counts[key]))) {
    return null;
  }
  return {
    total: counts.tests,
    pass: counts.pass,
    fail: counts.fail,
    skipped: counts.skipped,
    cancelled: counts.cancelled ?? 0,
    todo: counts.todo ?? 0,
  };
}

/**
 * Turn a completed test-runner invocation into an explicit pass/fail verdict.
 * A zero exit status alone is not sufficient: Node exits 0 when every test is
 * skipped, and a stale or misconfigured suite may report pass=0.
 *
 * `--all` passes `allowSkipped` for environment-gated suites (the V6-09
 * headless-Chrome cases when no Chrome is installed). The skip count and its
 * TAP `# SKIP` reasons are still printed; ticket runs keep the strict
 * zero-skip rule.
 */
export function evaluateTestRun({ status = null, stdout = '', error = null, allowSkipped = false } = {}) {
  if (error) {
    return {
      ok: false,
      exitCode: 1,
      reason: `Unable to launch Node test runner: ${error.message}`,
      summary: null,
    };
  }
  const summary = parseTapSummary(stdout);
  if (!summary) {
    return {
      ok: false,
      exitCode: typeof status === 'number' && status !== 0 ? status : 1,
      reason: 'TAP summary not found; test result cannot be verified',
      summary: null,
    };
  }
  if (summary.total === 0) {
    return { ok: false, exitCode: 1, reason: 'no tests discovered (total=0)', summary };
  }
  if (summary.fail > 0) {
    return {
      ok: false,
      exitCode: typeof status === 'number' && status !== 0 ? status : 1,
      reason: `${summary.fail} test(s) failed`,
      summary,
    };
  }
  if (summary.cancelled > 0) {
    return { ok: false, exitCode: 1, reason: `${summary.cancelled} test(s) cancelled`, summary };
  }
  if (summary.skipped > 0 && !allowSkipped) {
    return {
      ok: false,
      exitCode: 1,
      reason: `${summary.skipped} test(s) skipped; zero skips required for ticket acceptance`,
      summary,
    };
  }
  if (summary.pass === 0) {
    return { ok: false, exitCode: 1, reason: 'no passing tests (pass=0)', summary };
  }
  if (status !== 0) {
    return {
      ok: false,
      exitCode: typeof status === 'number' && status !== 0 ? status : 1,
      reason: `test runner exited with code ${status}`,
      summary,
    };
  }
  return { ok: true, exitCode: 0, reason: null, summary };
}

function discoverTickets(rootDir = ROOT) {
  const scenarios = path.join(rootDir, 'qa/v6/scenarios');
  if (!existsSync(scenarios)) return [];
  return readdirSync(scenarios, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && TICKET_SELECTOR.test(entry.name))
    .filter((entry) => readdirSync(path.join(scenarios, entry.name)).some((file) => file.endsWith('.test.mjs')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * `--all` covers every scenario directory with tests, not only `V6-*` tickets:
 * the `alignment-*` suites are part of the product acceptance too.
 */
export function discoverScenarios(rootDir = ROOT) {
  const scenarios = path.join(rootDir, 'qa/v6/scenarios');
  if (!existsSync(scenarios)) return [];
  return readdirSync(scenarios, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => readdirSync(path.join(scenarios, entry.name)).some((file) => file.endsWith('.test.mjs')))
    .map((entry) => entry.name)
    .sort();
}

function availableTests(rootDir, ticket) {
  const scenario = path.join(rootDir, 'qa/v6/scenarios', ticket);
  return readdirSync(scenario)
    .filter((file) => file.endsWith('.test.mjs'))
    .map((file) => path.join(scenario, file));
}

/**
 * Run Node tests and return a verdict instead of mutating process.exitCode.
 * The spawn function, runtime, working directory and output sinks are
 * injectable so negative scenarios can be exercised without touching the repo.
 */
export function runNodeTests(files, options = {}) {
  const {
    spawn = spawnSync,
    execPath = process.execPath,
    cwd = ROOT,
    stdout = process.stdout,
    stderr = process.stderr,
    env,
    allowSkipped = false,
  } = options;
  // When the runner itself is launched from inside a Node test file, the
  // inherited NODE_TEST_CONTEXT makes the child skip all files. Start the
  // child as an independent top-level test run unless the caller supplies an
  // explicit environment.
  const childEnv = env ? { ...env } : { ...process.env };
  if (!env) delete childEnv.NODE_TEST_CONTEXT;
  // Node 22 needs the explicit flag to import the suite's `.ts` sources; from
  // Node 23 on type stripping is on by default.
  const typeArgs = typeStrippingArgs();
  let result;
  try {
    result = spawn(execPath, [...typeArgs, '--test', '--test-reporter=tap', ...files], {
      cwd,
      encoding: 'utf8',
      env: childEnv,
    });
  } catch (error) {
    return evaluateTestRun({ error });
  }
  if (result.stdout && typeof stdout?.write === 'function') stdout.write(result.stdout);
  if (result.stderr && typeof stderr?.write === 'function') stderr.write(result.stderr);
  if (result.error) return evaluateTestRun({ error: result.error });
  return evaluateTestRun({
    status: result.status,
    stdout: result.stdout ?? '',
    allowSkipped,
  });
}

/** Node 22 is the oldest supported runtime and needs `--experimental-strip-types`. */
export function typeStrippingArgs(version = process.versions.node) {
  const major = Number.parseInt(version, 10);
  return Number.isFinite(major) && major === 22 ? ['--experimental-strip-types'] : [];
}

export function main(args = process.argv.slice(2), options = {}) {
  const {
    rootDir = ROOT,
    spawn = spawnSync,
    execPath = process.execPath,
    stdout = process.stdout,
    stderr = process.stderr,
  } = options;
  let parsed;
  let selection;
  try {
    parsed = parseArgs(args);
    const baselineDir = path.join(rootDir, 'qa/v6/baseline');
    const manifestFile = path.join(baselineDir, 'manifest.json');
    const receiptFile = path.join(baselineDir, 'receipt.json');
    if (!existsSync(manifestFile) || !existsSync(receiptFile)) {
      throw new Error('DEPENDENCY_MISSING: V6-01 baseline manifest or receipt is missing');
    }
    validateV601Dependency({
      manifest: JSON.parse(readFileSync(manifestFile, 'utf8')),
      receipt: JSON.parse(readFileSync(receiptFile, 'utf8')),
    });
    selection = parsed.all
      ? discoverScenarios(rootDir)
      : selectTicketTests(parsed.ticket, discoverTickets(rootDir));
  } catch (error) {
    stderr.write(`V6 runner error: ${error.message}\n`);
    return 2;
  }

  if (parsed.all) return runAllScenarios(selection, rootDir, { spawn, execPath, stdout, stderr });

  const files = selection.flatMap((ticket) => availableTests(rootDir, ticket));
  if (files.length === 0) {
    stderr.write('V6 runner error: selected ticket has no registered tests\n');
    return 2;
  }
  const outcome = runNodeTests(files, { spawn, execPath, cwd: rootDir, stdout, stderr });
  if (!outcome.ok) stderr.write(`V6 runner error: ${outcome.reason}\n`);
  return outcome.exitCode;
}

/**
 * Run every scenario directory one after another and aggregate the verdicts.
 * Each directory's raw TAP goes to stdout, then a compact row with its real
 * counts. An explicit `skip` is tolerated only here (environment-gated browser
 * cases); its count is always printed, and the reason stays in the TAP `# SKIP`
 * line and in the suite's own message, so nothing disappears silently.
 */
function runAllScenarios(selection, rootDir, { spawn, execPath, stdout, stderr }) {
  const rows = [];
  let failed = false;
  for (const name of selection) {
    const files = availableTests(rootDir, name);
    if (files.length === 0) {
      rows.push({ name, ok: false, error: 'no test files' });
      failed = true;
      stdout.write(`\n[${name}] FAILED: no test files\n`);
      continue;
    }
    const outcome = runNodeTests(files, { spawn, execPath, cwd: rootDir, stdout, stderr, allowSkipped: true });
    const summary = outcome.summary;
    rows.push({ name, ok: outcome.ok, summary });
    if (!outcome.ok) failed = true;
    if (summary) {
      stdout.write(
        `[${name}] tests=${summary.total} pass=${summary.pass} fail=${summary.fail} cancelled=${summary.cancelled} skipped=${summary.skipped}` +
          `${outcome.ok ? '' : ` FAILED: ${outcome.reason}`}\n`,
      );
    } else {
      stdout.write(`[${name}] FAILED: ${outcome.reason}\n`);
    }
  }

  const sum = (key) => rows.reduce((total, row) => total + (row.summary?.[key] ?? 0), 0);
  const skippedRows = rows.filter((row) => (row.summary?.skipped ?? 0) > 0);
  stdout.write(
    `\nV6 runner --all: ${rows.length} 个场景目录 · tests=${sum('total')} pass=${sum('pass')} fail=${sum('fail')}` +
      ` cancelled=${sum('cancelled')} skipped=${sum('skipped')}\n`,
  );
  for (const row of rows) {
    stdout.write(`  ${row.ok ? 'PASS' : 'FAIL'} ${row.name}\n`);
  }
  if (skippedRows.length > 0) {
    stdout.write(
      `显式 skip：${skippedRows.map((row) => `${row.name}=${row.summary.skipped}`).join(', ')}（原因见各目录 TAP 的 # SKIP 行与套件消息）\n`,
    );
  }
  if (failed) stderr.write('V6 runner error: one or more scenario directories failed\n');
  return failed ? 1 : 0;
}

/**
 * Detect the direct-entry invocation. Both sides are resolved through
 * realpath so a symlinked checkout (for example `/tmp` -> `/private/tmp`) or a
 * symlinked script path still runs `main()`. Without this, the module loads
 * silently and exits 0, which would let a failing suite pass.
 */
export function isEntryPoint(argv1 = process.argv[1]) {
  if (!argv1) return false;
  const real = (value) => {
    try {
      return realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  return real(argv1) === real(RUNNER);
}

if (isEntryPoint()) process.exitCode = main();
