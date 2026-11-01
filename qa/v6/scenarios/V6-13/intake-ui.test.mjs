/**
 * V6-13 — intake surface markup (S03 UI four states).
 *
 * `Intake.tsx` is bundled with esbuild and rendered with `react-dom/server`,
 * like the V6-10/V6-11 suites. Every loaded view comes from real persisted
 * state; the panels themselves are pure props, so the four states S03 names
 * (empty, loading, error, stale) and the version-merge view can be inspected
 * without a browser. Clicking in a real browser is separate browser evidence.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import { bindDraftInput, readIntake, saveIntake } from "../../../../apps/web/src/v6/features/intake/intake.ts";
import { chunkSetKey, PARSER_VERSION } from "../../../../apps/web/src/v6/features/sources/parse.ts";
import {
  ACTOR_A,
  MATTER_ID,
  STORES,
  T0,
  directSources,
  fiveAnswers,
  freshRepository,
  personParty,
  refFor,
  seedParsedMatter,
  targetRecord,
  uuidSource,
} from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/intake/Intake.tsx");

const T1 = "2026-11-01T01:00:00.000Z";
const T2 = "2026-11-01T02:00:00.000Z";

let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-13-bundle-"));
  const outfile = join(outdir, "intake.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import {
      Intake, IntakePanel, emptyIntakeForm, formFromView, intakeFormReducer, draftToSaveInput,
      encodeSourceValue, decodeSourceValue, SOURCE_DIRECT, SOURCE_NOT_FOUND, SOURCE_STORED,
    } from ${JSON.stringify(SOURCE)};
    export function renderIntake(props) { return renderToStaticMarkup(<Intake {...props} />); }
    export function renderPanel(props) { return renderToStaticMarkup(<IntakePanel {...props} />); }
    export {
      emptyIntakeForm, formFromView, intakeFormReducer, draftToSaveInput,
      encodeSourceValue, decodeSourceValue, SOURCE_DIRECT, SOURCE_NOT_FOUND, SOURCE_STORED,
    };
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "v6-13-intake-harness.tsx", loader: "tsx" },
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  ui = createRequire(outfile)(outfile);
});

after(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

function panelProps(overrides = {}) {
  return {
    load: { phase: "ready" },
    view: null,
    form: ui.emptyIntakeForm(),
    busy: false,
    status: { phase: "idle" },
    onForm: () => {},
    onSave: () => {},
    onRetryLoad: () => {},
    onReloadLatest: () => {},
    onKeepMine: () => {},
    onAddParty: () => {},
    onAddFact: () => {},
    onAddConflict: () => {},
    ...overrides,
  };
}

async function viewOf(repository) {
  const outcome = await readIntake(await repository, ACTOR_A, MATTER_ID);
  assert.equal(outcome.ok, true, outcome.ok ? "" : JSON.stringify(outcome));
  return outcome.view;
}

function selectMarkup(html, testid) {
  const pattern = new RegExp(`<select[^>]*data-testid="${testid}"[^>]*>([\\s\\S]*?)</select>`);
  const match = pattern.exec(html);
  assert.ok(match, `${testid} rendered`);
  return match[0];
}

function command(overrides = {}) {
  return {
    baseSourceVersion: 1,
    answers: fiveAnswers(),
    questionSources: {},
    facts: [],
    conflicts: [],
    parties: [],
    ...overrides,
  };
}

test("V6-13 UI renders loading and an explicit error state instead of an empty form", () => {
  const loading = ui.renderPanel(panelProps({ load: { phase: "loading" } }));
  assert.match(loading, /data-testid="intake"[^>]*data-state="loading"/);
  assert.match(loading, /data-testid="intake-loading"/);
  assert.doesNotMatch(loading, /data-testid="intake-save"/);

  const failed = ui.renderPanel(
    panelProps({ load: { phase: "failed", message: "本机存储暂时不可用，内容没有保存。" } }),
  );
  assert.match(failed, /data-testid="intake"[^>]*data-state="error"/);
  assert.match(failed, /data-testid="intake-error"/);
  assert.match(failed, /本机存储暂时不可用，内容没有保存。/);
  assert.match(failed, /data-testid="intake-retry-load"/);
  assert.doesNotMatch(failed, /data-testid="intake-question-problem"/);
});

test("V6-13 UI empty state shows five questions, no disclosure or maturity value, and the located source suggestion", async () => {
  const { chunks, repository } = await seedParsedMatter();
  const view = await viewOf(repository);
  assert.equal(view.state, "empty");
  const html = ui.renderPanel(panelProps({ view, form: ui.formFromView(view) }));

  assert.match(html, /data-testid="intake"[^>]*data-state="empty"/);
  assert.match(html, /data-testid="intake-empty"/);
  assert.match(html, /data-testid="intake-completeness"[^>]*>[\s\S]*?已填写 0\/5/);
  for (const key of ["problem", "difference", "inventorIds", "disclosure", "maturity"]) {
    assert.ok(html.includes(`data-testid="intake-question-${key}"`), `${key} is rendered`);
  }

  const disclosure = selectMarkup(html, "intake-answer-disclosure");
  assert.match(disclosure, /请选择（不会自动填写）/);
  for (const value of ["none", "private_showing", "public_event", "publication", "sale", "unsure"]) {
    assert.doesNotMatch(disclosure, new RegExp(`value="${value}"[^>]*selected`), `${value} is not preselected`);
  }
  const maturity = selectMarkup(html, "intake-answer-maturity");
  assert.match(maturity, /请选择（不会自动填写）/);
  for (const value of ["tested_sample", "drawing", "idea"]) {
    assert.doesNotMatch(maturity, new RegExp(`value="${value}"[^>]*selected`), `${value} is not preselected`);
  }

  const source = selectMarkup(html, "intake-source-disclosure");
  assert.match(source, /材料中未找到/);
  assert.match(source, /用户直接回答/);
  assert.match(source, /给客户看过样品|客户/, "the material paragraph is offered next to question 4");
  const suggestionRef = view.questions.find((question) => question.key === "disclosure").suggestions[0];
  assert.ok(suggestionRef, "a suggestion exists");
  assert.ok(
    html.includes(suggestionRef.sourceName) || html.includes("intake-source-disclosure"),
    "the suggestion names its source",
  );
  assert.equal(chunks.length > 0, true);

  // Remembered choice: the reducer selects exactly what the user picked.
  const chosen = ui.intakeFormReducer(ui.formFromView(view), { type: "choice", key: "disclosure", value: "private_showing" });
  const chosenHtml = ui.renderPanel(panelProps({ view, form: chosen }));
  assert.match(selectMarkup(chosenHtml, "intake-answer-disclosure"), /value="private_showing"[^>]*selected/);
  const stillEmpty = selectMarkup(chosenHtml, "intake-answer-maturity");
  for (const value of ["tested_sample", "drawing", "idea"]) {
    assert.doesNotMatch(stillEmpty, new RegExp(`value="${value}"[^>]*selected`), "maturity stays unset");
  }
});

test("V6-13 UI loaded state keeps the saved answer, its source and its provenance after a reload", async () => {
  const { backend, repository, chunks, newIds } = await seedParsedMatter();
  const person = personParty(newIds());
  const ref = refFor(chunks, "问题：现有换热");
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ inventorIds: [person.id], difference: "" }),
      parties: [person],
      questionSources: { problem: { kind: "source", ref }, inventorIds: { kind: "direct" } },
    }),
    { now: () => T1 },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));

  const view = await viewOf(freshRepository(backend));
  const html = ui.renderPanel(panelProps({ view, form: ui.formFromView(view) }));
  assert.match(html, /data-testid="intake"[^>]*data-state="ready"/);
  assert.match(html, /data-testid="intake-snapshot-version"[^>]*>[\s\S]*?第 2 版/);
  assert.match(html, /<textarea[^>]*data-testid="intake-answer-problem"[^>]*>低温环境效率低，运行成本高。<\/textarea>/);
  assert.match(html, /data-testid="intake-source-quote-problem"[\s\S]*?问题：现有换热装置/);
  assert.match(html, /data-testid="intake-provenance-problem"[^>]*>[\s\S]*?第 1 版事实 · 2026-11-01/);
  // The cited paragraph is selected, either as the question's suggestion or as
  // the plain chunk entry (short paragraphs make both the same ref), and the
  // selected value decodes back to exactly the stored ref.
  const selected = /value="((?:suggest|chunk):[^"]+)"[^>]*selected/.exec(selectMarkup(html, "intake-source-problem"));
  assert.ok(selected, "the cited source is selected");
  assert.deepEqual(ui.decodeSourceValue(selected[1], "problem", view, undefined), { kind: "source", ref });
  assert.match(selectMarkup(html, "intake-source-inventorIds"), /value="direct"[^>]*selected/);
  assert.match(selectMarkup(html, "intake-answer-disclosure"), /请选择（不会自动填写）/);
  assert.doesNotMatch(selectMarkup(html, "intake-answer-disclosure"), /value="[a-z_]+"[^>]*selected/);

  // Every reducer path that touches an unrelated field leaves the two choices alone.
  let form = ui.formFromView(view);
  form = ui.intakeFormReducer(form, { type: "party-name", value: "李四" });
  form = ui.intakeFormReducer(form, { type: "add-party", party: personParty(newIds(), "李四") });
  form = ui.intakeFormReducer(form, { type: "fact-statement", value: "一条新事实" });
  form = ui.intakeFormReducer(form, { type: "add-fact", fact: { id: newIds(), statement: "一条新事实", kind: "method", status: "unsupported", refs: [], confirmedBy: null, confirmedAt: null } });
  assert.equal(form.answers.disclosure, null);
  assert.equal(form.answers.maturity, null);
});

test("V6-13-A03 B1 UI after a post-commit snapshot failure and a reload, the form renders at the committed version and its save succeeds", async () => {
  const { backend, repository } = await seedParsedMatter();
  const sources = { problem: { kind: "direct" }, difference: { kind: "direct" } };
  const v2 = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: fiveAnswers({ problem: "第二版的问题。" }), questionSources: sources }),
    { now: () => T1, requestKey: "ui-b1-v2" },
  );
  assert.equal(v2.ok, true, JSON.stringify(v2));
  backend.setPutFault(({ store, key }) =>
    store === STORES.blobs && typeof key === "string" && key.startsWith("intake/snapshot/") ? new Error("disk full") : null,
  );
  const halfSaved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ baseSourceVersion: 2, answers: fiveAnswers({ problem: "快照没写成。" }), questionSources: sources }),
    { now: () => T2, requestKey: "ui-b1-v3" },
  );
  assert.equal(halfSaved.committedVersion, 3);

  // The in-session failure copy: committed, so never "not saved".
  const failedHtml = ui.renderPanel(
    panelProps({ view: await viewOf(repository), form: ui.emptyIntakeForm(), status: { phase: "failed", failure: halfSaved } }),
  );
  assert.match(failedHtml, /data-testid="intake-committed-version"/);
  assert.doesNotMatch(failedHtml, /没有保存/);
  backend.setPutFault(null);

  // Reload: a fresh repository, the same read a fresh mount makes.
  const reloaded = await freshRepository(backend);
  const view = await viewOf(reloaded);
  const form = ui.formFromView(view);
  const html = ui.renderPanel(panelProps({ view, form }));
  assert.match(html, /data-testid="intake"[^>]*data-version="3"/);
  assert.doesNotMatch(html, /data-testid="intake-error"/);
  assert.doesNotMatch(html, /没有保存/);
  assert.doesNotMatch(html, /data-testid="intake-empty"/, "a recovered matter is not described as never saved");
  assert.match(html, /data-testid="intake-recovery"[^>]*>[\s\S]*?第 3 版[\s\S]*?第 2 版/);
  assert.match(html, /<button[^>]*data-testid="intake-save"/);
  assert.match(html, /<textarea[^>]*data-testid="intake-answer-problem"[^>]*>第二版的问题。<\/textarea>/);

  const saved = await saveIntake(reloaded, ACTOR_A, MATTER_ID, ui.draftToSaveInput(form, view.sourceVersion), {
    now: () => T2,
    requestKey: "ui-b1-fill",
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.version, 4);
  const after = await viewOf(freshRepository(backend));
  assert.equal(after.recovery, null);
  assert.doesNotMatch(ui.renderPanel(panelProps({ view: after, form: ui.formFromView(after) })), /data-testid="intake-recovery"/);
});

test("V6-13 B2 UI a disclosure evidence ref that no longer locates its paragraph is shown as changed", async () => {
  const { backend, repository, sourceId, chunks } = await seedParsedMatter();
  const ref = refFor(chunks, "客户签署了保密约定");
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({
        disclosure: "private_showing",
        disclosureDetail: { occurredOn: null, audience: "一位客户", confidentiality: "yes", evidenceRefs: [ref] },
      }),
      questionSources: directSources(),
    }),
    { now: () => T1 },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));
  let view = await viewOf(freshRepository(backend));
  let html = ui.renderPanel(panelProps({ view, form: ui.formFromView(view) }));
  assert.match(html, /data-testid="intake-evidence-0"[^>]*data-source-changed="false"[^>]*>[\s\S]*?客户签署了保密约定/);

  backend.store(STORES.blobs).delete(chunkSetKey(sourceId, PARSER_VERSION));
  view = await viewOf(freshRepository(backend));
  html = ui.renderPanel(panelProps({ view, form: ui.formFromView(view) }));
  assert.match(html, /data-testid="intake-evidence-0"[^>]*data-source-changed="true"/);
  assert.match(html, /data-testid="intake-evidence-changed-0"[^>]*>[\s\S]*?来源已变化/);
});

test("V6-13 UI stale state marks changed sources and derived drafts; a conflicts view shows both sides and the retained reason", async () => {
  const ids = uuidSource(8001);
  const target = targetRecord(ids());
  const { backend, repository, sourceId, chunks, newIds } = await seedParsedMatter({ targets: [target] });
  const ref = refFor(chunks, "问题：现有换热");
  const firstId = newIds();
  const secondId = newIds();
  const conflictId = newIds();
  const bound = await bindDraftInput(repository, ACTOR_A, MATTER_ID, {
    matterId: MATTER_ID,
    targetId: target.id,
    sourceVersion: 1,
    targetConfigVersion: 1,
    figureRevisionId: target.figureRevisionId,
  });
  assert.equal(bound.ok, true, JSON.stringify(bound));
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ problem: "引用材料的问题。", difference: "" }),
      questionSources: { problem: { kind: "source", ref } },
      facts: [
        {
          id: firstId,
          statement: "工作温度为 80°C。",
          kind: "parameter",
          status: "source_backed",
          refs: [ref],
          confirmedBy: null,
          confirmedAt: null,
        },
        {
          id: secondId,
          statement: "工作温度为 120°C。",
          kind: "parameter",
          status: "user_confirmed",
          refs: [],
          confirmedBy: null,
          confirmedAt: null,
        },
      ],
      conflicts: [
        {
          id: conflictId,
          factIds: [firstId, secondId],
          state: "retained",
          chosenFactIds: [],
          reason: "两份报告的数值不同。",
        },
      ],
    }),
    { now: () => T1 },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));

  backend.store(STORES.blobs).delete(chunkSetKey(sourceId, PARSER_VERSION));
  const view = await viewOf(freshRepository(backend));
  assert.equal(view.state, "stale");
  const html = ui.renderPanel(panelProps({ view, form: ui.formFromView(view) }));
  assert.match(html, /data-testid="intake"[^>]*data-state="stale"/);
  assert.match(html, /data-testid="intake-stale-notice"/);
  assert.match(html, /data-testid="intake-source-changed-problem"/);
  assert.match(html, /data-testid="intake-fact-[^"]*"[^>]*data-source-changed="true"/);
  const draft = new RegExp(`data-testid="intake-draft-${target.id}"[^>]*data-stale="true"`).exec(html);
  assert.ok(draft, "the derived draft is shown as stale");

  const conflict = new RegExp(`data-testid="intake-conflict-${conflictId}"[^>]*data-state="retained"`).exec(html);
  assert.ok(conflict, "the retained conflict is shown");
  assert.match(html, /data-testid="intake-conflict-statement-[\s\S]*?工作温度为 80°C。/);
  assert.match(html, /data-testid="intake-conflict-statement-[\s\S]*?工作温度为 120°C。/);
  assert.match(html, /<input[^>]*data-testid="intake-conflict-reason-[^"]+"[^>]*value="两份报告的数值不同。"/);
});

test("V6-13 UI shows field errors without discarding what the user typed, and a version conflict side by side", async () => {
  const { repository, newIds } = await seedParsedMatter();
  const person = personParty(newIds());
  const first = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ inventorIds: [person.id] }),
      parties: [person],
      questionSources: directSources(),
    }),
    { now: () => T1 },
  );
  assert.equal(first.ok, true, JSON.stringify(first));

  const organization = { id: newIds(), kind: "organization", name: "某某公司", roles: ["applicant"], country: null };
  const rejected = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: fiveAnswers({ problem: "用户输入没有丢失的问题。", inventorIds: [organization.id] }),
      parties: [person, organization],
      questionSources: directSources(),
    }),
    { now: () => T1 },
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errorCode, "INVALID_INPUT");

  const view = await viewOf(repository);
  const form = ui.intakeFormReducer(ui.formFromView(view), {
    type: "text",
    key: "problem",
    value: "用户输入没有丢失的问题。",
  });
  const html = ui.renderPanel(
    panelProps({
      view,
      form,
      status: { phase: "failed", failure: rejected },
    }),
  );
  assert.match(html, /data-testid="intake-save-error"[^>]*data-code="INVALID_INPUT"/);
  assert.match(html, /data-testid="intake-field-errors"[\s\S]*?发明人必须是自然人/);
  assert.match(html, /<textarea[^>]*data-testid="intake-answer-problem"[^>]*>用户输入没有丢失的问题。<\/textarea>/);

  // A second window saved version 3; this page is still on version 2.
  const other = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: fiveAnswers({ problem: "另一个窗口保存的问题。", inventorIds: [person.id] }),
      parties: [person],
      questionSources: directSources(),
    }),
    { now: () => T2 },
  );
  assert.equal(other.ok, true, JSON.stringify(other));
  const stale = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: fiveAnswers({ problem: "本窗口尚未保存的修改。", inventorIds: [person.id] }),
      parties: [person],
      questionSources: directSources(),
    }),
    { now: () => T2 },
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.errorCode, "VERSION_CONFLICT");
  assert.equal(stale.latestVersion, 3);

  const conflictHtml = ui.renderPanel(panelProps({ view, form, status: { phase: "failed", failure: stale } }));
  assert.match(conflictHtml, /data-testid="intake-version-conflict"/);
  assert.match(conflictHtml, /data-testid="intake-merge-mine"[\s\S]*?用户输入没有丢失的问题。/);
  assert.match(conflictHtml, /data-testid="intake-merge-latest"[\s\S]*?另一个窗口保存的问题。/);
  assert.match(conflictHtml, /data-testid="intake-reload-latest"/);
});

test("V6-13 UI reducer keeps the three source kinds exact and never invents a disclosure or maturity value", async () => {
  const { repository, chunks } = await seedParsedMatter();
  const view = await viewOf(repository);
  let form = ui.emptyIntakeForm();
  const ref = refFor(chunks, "问题：现有换热");
  form = ui.intakeFormReducer(form, { type: "source", key: "problem", source: { kind: "source", ref } });
  const encoded = ui.encodeSourceValue("problem", form.sources.problem, view);
  assert.match(encoded, /^(suggest|chunk):/);
  assert.deepEqual(ui.decodeSourceValue(encoded, "problem", view, undefined), { kind: "source", ref });
  form = ui.intakeFormReducer(form, { type: "source", key: "difference", source: ui.decodeSourceValue(ui.SOURCE_DIRECT, "difference", view, undefined) });
  assert.deepEqual(form.sources.difference, { kind: "direct" });
  form = ui.intakeFormReducer(form, { type: "source", key: "maturity", source: ui.decodeSourceValue(ui.SOURCE_NOT_FOUND, "maturity", view, undefined) });
  assert.deepEqual(form.sources.maturity, { kind: "not_found" });

  const stored = { kind: "source", ref };
  assert.deepEqual(ui.decodeSourceValue(ui.SOURCE_STORED, "problem", view, stored), stored);
  assert.match(ui.encodeSourceValue("problem", stored, view), /^(suggest|chunk):/);
  assert.equal(ui.encodeSourceValue("problem", null, view), "");
  assert.equal(ui.decodeSourceValue("", "problem", view, stored), undefined);

  assert.equal(form.answers.disclosure, null);
  assert.equal(form.answers.maturity, null);

  // Choices are only ever what the reducer is told; clearing is explicit.
  form = ui.intakeFormReducer(form, { type: "choice", key: "maturity", value: "idea" });
  assert.equal(form.answers.maturity, "idea");
  form = ui.intakeFormReducer(form, { type: "choice", key: "maturity", value: "" });
  assert.equal(form.answers.maturity, null);

  const factId = "00000000-0000-4000-8000-000000000001";
  form = ui.intakeFormReducer(form, {
    type: "add-fact",
    fact: { id: factId, statement: "事实", kind: "method", status: "unsupported", refs: [], confirmedBy: null, confirmedAt: null },
  });
  form = ui.intakeFormReducer(form, {
    type: "add-conflict",
    conflict: { id: "00000000-0000-4000-8000-000000000002", factIds: [factId], state: "open", chosenFactIds: [], reason: null },
  });
  assert.equal(form.conflicts.length, 1);
  form = ui.intakeFormReducer(form, { type: "remove-fact", factId });
  assert.equal(form.conflicts.length, 0, "removing a fact removes a conflict that cites it");

  const input = ui.draftToSaveInput(form, 7);
  assert.equal(input.baseSourceVersion, 7);
  assert.deepEqual(input.answers, form.answers);
  assert.deepEqual(input.questionSources, form.sources);
});

/** Holds both commits until both saves have passed their pre-check. */
function raceCommits(repository) {
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return new Proxy(repository, {
    get(target, prop) {
      if (prop === "commit") {
        return async (...args) => {
          if (arrived < 2) {
            arrived += 1;
            if (arrived === 2) release();
            await gate;
          }
          return target.commit(...args);
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("V6-13 B3 UI the loser of a two-tab save race sees both sides with the real latest version", async () => {
  const { repository } = await seedParsedMatter();
  const view = await viewOf(repository);
  const racing = raceCommits(repository);
  const texts = ["甲窗口保存的问题。", "乙窗口保存的问题。"];
  const outcomes = await Promise.all(
    texts.map((problem, index) =>
      saveIntake(
        racing,
        ACTOR_A,
        MATTER_ID,
        command({ answers: fiveAnswers({ problem }), questionSources: directSources() }),
        { now: () => T1, requestKey: `ui-race-${index}` },
      ),
    ),
  );
  const winner = outcomes.find((outcome) => outcome.ok);
  const loserIndex = outcomes.findIndex((outcome) => !outcome.ok);
  assert.ok(winner && loserIndex >= 0, JSON.stringify(outcomes));
  const loser = outcomes[loserIndex];
  assert.equal(loser.errorCode, "VERSION_CONFLICT");

  const form = ui.intakeFormReducer(ui.formFromView(view), { type: "text", key: "problem", value: texts[loserIndex] });
  const html = ui.renderPanel(panelProps({ view, form, status: { phase: "failed", failure: loser } }));
  assert.match(html, /data-testid="intake-version-conflict"/);
  assert.match(html, /最新是第 2 版/);
  assert.match(html, new RegExp(`data-testid="intake-merge-mine"[\\s\\S]*?${texts[loserIndex]}`));
  assert.match(html, new RegExp(`data-testid="intake-merge-latest"[\\s\\S]*?${winner.snapshot.answers.problem}`));
  assert.doesNotMatch(html, /最新版本的答案无法读取/);
  assert.doesNotMatch(html, /data-testid="intake-merge-latest-older"/);
});

test("V6-13 UI a conflict whose latest snapshot was never written shows the newest older one and says so", async () => {
  const { backend, repository } = await seedParsedMatter();
  const v2 = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: fiveAnswers({ problem: "第二版保存的问题。" }), questionSources: directSources() }),
    { now: () => T1 },
  );
  assert.equal(v2.ok, true, JSON.stringify(v2));
  const view = await viewOf(repository);
  backend.setPutFault(({ store, key }) =>
    store === STORES.blobs && typeof key === "string" && key.startsWith("intake/snapshot/") ? new Error("disk full") : null,
  );
  const v3 = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ baseSourceVersion: 2, answers: fiveAnswers({ problem: "第三版的问题。" }), questionSources: directSources() }),
    { now: () => T2 },
  );
  assert.equal(v3.committedVersion, 3, JSON.stringify(v3));
  backend.setPutFault(null);

  const stale = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ baseSourceVersion: 2, answers: fiveAnswers({ problem: "本窗口的修改。" }), questionSources: directSources() }),
    { now: () => T2 },
  );
  assert.equal(stale.errorCode, "VERSION_CONFLICT");
  assert.equal(stale.latestVersion, 3);
  assert.equal(stale.latest?.version, 2);

  const form = ui.intakeFormReducer(ui.formFromView(view), { type: "text", key: "problem", value: "本窗口的修改。" });
  const html = ui.renderPanel(panelProps({ view, form, status: { phase: "failed", failure: stale } }));
  assert.match(html, /data-testid="intake-merge-latest-older"[^>]*>第 3 版的答案快照没有写入本机；下面是第 2 版保存的内容。/);
  assert.match(html, /data-testid="intake-merge-latest"[\s\S]*?第二版保存的问题。/);
});

test("V6-13 UI a version conflict keeps the user's edits and offers both choices", async () => {
  const { repository } = await seedParsedMatter();
  const first = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: fiveAnswers({ problem: "第一版的问题。" }), questionSources: directSources() }),
    { now: () => T1 },
  );
  assert.equal(first.ok, true, JSON.stringify(first));
  const view = await viewOf(repository);
  const form = ui.intakeFormReducer(ui.formFromView(view), { type: "text", key: "problem", value: "我尚未保存的修改。" });
  const conflict = {
    ok: false,
    errorCode: "VERSION_CONFLICT",
    message: "其他窗口已保存了更新的版本。请对照两版内容合并后重试。",
    latestVersion: 2,
    latest: first.snapshot,
  };
  const html = ui.renderPanel(panelProps({ view, form, status: { phase: "failed", failure: conflict } }));
  assert.match(html, /data-testid="intake-version-conflict"/);
  // The edited field is still rendered with its text, not reset to the stored view.
  assert.match(html, /<textarea[^>]*data-testid="intake-answer-problem"[^>]*>我尚未保存的修改。<\/textarea>/);
  assert.match(html, /data-testid="intake-keep-mine"[^>]*>保留我的修改，基于第 2 版保存<\/button>/);
  assert.match(html, /data-testid="intake-reload-latest"/);
  assert.match(html, /下一次保存会把它写到第 2 版之上/);
});
