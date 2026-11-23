// V6-22 regression: the draft title input binds only to the real title state.
// Clearing it must show the placeholder through `placeholder`, never by
// assigning the placeholder text to the controlled `value` (which would be
// written into the draft AST on the next keystroke).
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const harness = await import("../V6-19/harness.mjs");
const editor = await import("../../../../apps/web/src/v6/features/draft/Editor.tsx");

const { ACTOR, MATTER_ID, TARGET_ID, T0, makeFixture, nextUuid, modules } = harness;

const renderTitle = (value) => renderToStaticMarkup(createElement(editor.DraftTitleField, {
  value, disabled: false, onChange() {},
}));

test("V6-22-B01: blank and default titles render as an empty value with a placeholder", () => {
  for (const value of ["", "   ", "未命名案件"]) {
    const markup = renderTitle(value);
    assert.match(markup, /data-testid="draft-title"/);
    assert.match(markup, /placeholder="（未填写发明名称）"/);
    assert.match(markup, /value=""/);
    assert.doesNotMatch(markup, /value="（未填写发明名称）"/, `placeholder must not be the value for ${JSON.stringify(value)}`);
    assert.doesNotMatch(markup, /value="未命名案件"/);
  }
  const real = renderTitle("一种智能水表");
  assert.match(real, /value="一种智能水表"/);
  assert.doesNotMatch(real, /value="（未填写发明名称）/);
});

test("V6-22-B02: clearing then typing a title stores exactly the typed name", async () => {
  const fixture = await makeFixture();
  const blankTitleAst = { ...structuredClone(fixture.ast), title: "" };
  assert.equal(modules.contracts.draftAstSchema.safeParse(blankTitleAst).success, true);
  const blank = await fixture.revisions.saveEditedRevision(MATTER_ID, TARGET_ID, fixture.revision.id, blankTitleAst);
  assert.equal(blank.ok, true, blank.ok ? "" : JSON.stringify(blank.error));

  const buffers = new editor.IndexedDbDraftBufferStore(fixture.backend, ACTOR);
  const session = new editor.DraftEditorSession({
    repository: fixture.repository,
    actor: ACTOR,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    revisions: fixture.revisions,
    bufferStore: buffers,
    newId: nextUuid,
    now: () => T0,
  });
  await session.load();
  const loaded = session.getSnapshot();
  assert.equal(loaded.phase, "ready");
  assert.equal(loaded.matterTitle, "合成测试案件");
  // A blank revision title may inherit the valid matter title once, at load.
  assert.equal(loaded.model.title, "合成测试案件");

  // Clearing the field is a real, stable `""` — no placeholder bounce.
  await session.updateModel({ ...loaded.model, title: "" });
  assert.equal(session.getSnapshot().model.title, "");
  // Typing then keeps exactly what the user typed.
  await session.updateModel({ ...session.getSnapshot().model, title: "一种智能水表" });
  assert.equal(session.getSnapshot().model.title, "一种智能水表");

  const saved = await session.save();
  assert.ok(saved);
  assert.equal(saved.ast.title, "一种智能水表");
  assert.equal(saved.ast.title.includes("（未填写发明名称）"), false);
  assert.equal(saved.ast.title.includes("未命名案件"), false);

  const head = await fixture.revisions.loadHeadRevision(MATTER_ID, TARGET_ID);
  assert.equal(head.ok, true);
  assert.equal(head.data.ast.title, "一种智能水表");
  fixture.repository.close();
});

test("V6-22-B03: a placeholder matter title is not used to seed the draft title", () => {
  assert.equal(editor.isPlaceholderDraftTitle("未命名案件"), true);
  assert.equal(editor.isPlaceholderDraftTitle(""), true);
  assert.equal(editor.isPlaceholderDraftTitle("一种智能水表"), false);
});
