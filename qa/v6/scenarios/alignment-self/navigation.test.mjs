import test from "node:test";
import assert from "node:assert/strict";
import { parseV6Path, v6Path } from "../../../../apps/web/src/v6/routes/navigation.ts";
import { requiredSelfServiceStep, resolveQuestionIndex } from "../../../../apps/web/src/v6/features/self-service/route-state.ts";

const MATTER_ID = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
const TARGET_ID = "66666666-6666-4666-8666-666666666666";
const STEPS = ["upload", "questions", "route", "generate", "preview", "done"];
const QUESTION_KEYS = ["problem", "difference", "inventorIds", "disclosure", "maturity"];

function intake({ missing = [], changedSource = null } = {}) {
  return {
    missing,
    questions: QUESTION_KEYS.map((key) => ({
      key,
      answered: !missing.includes(key),
      sourceChanged: key === changedSource,
    })),
  };
}

function progress(overrides = {}) {
  return {
    intake: intake(),
    target: { id: TARGET_ID, config: {} },
    targetRecord: { draftRevisionId: "revision-1" },
    ...overrides,
  };
}

test("self-service URLs round-trip and legacy upload links remain valid aliases", () => {
  for (const step of STEPS) {
    const route = { kind: "self_service", matterId: MATTER_ID, step };
    const path = v6Path(route);
    assert.equal(path, `/v6/new/${MATTER_ID}/${step}`);
    assert.deepEqual(parseV6Path(path), route);
  }
  assert.deepEqual(parseV6Path(`/v6/matters/${MATTER_ID}/upload`), { kind: "upload", matterId: MATTER_ID });
  assert.equal(v6Path({ kind: "upload", matterId: MATTER_ID }), `/v6/matters/${MATTER_ID}/upload`);
  assert.deepEqual(parseV6Path("/v6/pricing"), { kind: "section", key: "pricing" });
});

test("deep links return to the first missing prerequisite without filling anything", () => {
  assert.equal(requiredSelfServiceStep("route", progress({ intake: intake({ missing: ["problem", "difference"] }) })), "questions");
  assert.equal(requiredSelfServiceStep("generate", progress({ target: null, targetRecord: null })), "route");
  assert.equal(requiredSelfServiceStep("preview", progress({ targetRecord: { draftRevisionId: null } })), "generate");
  assert.equal(requiredSelfServiceStep("preview", progress({ targetRecord: { draftRevisionId: "revision-2" } })), "preview");
  assert.equal(requiredSelfServiceStep("done", progress()), "done");
  assert.equal(requiredSelfServiceStep("generate", progress({ intake: intake({ changedSource: "problem" }) })), "questions");
  assert.equal(requiredSelfServiceStep("preview", progress({ target: { id: TARGET_ID, config: null } })), "route");
  assert.equal(requiredSelfServiceStep("upload", progress({ intake: intake({ missing: QUESTION_KEYS }) })), "upload");
  assert.equal(requiredSelfServiceStep("questions", progress({ intake: intake({ missing: QUESTION_KEYS }) })), "questions");
});

test("question URLs preserve back-and-forward position and stop at an unanswered question", () => {
  const allAnswered = intake();
  assert.equal(resolveQuestionIndex(allAnswered, "2"), 2);
  assert.equal(resolveQuestionIndex(allAnswered, null), 4);
  assert.equal(resolveQuestionIndex(intake({ missing: ["difference", "maturity"] }), "4"), 1);
  assert.equal(resolveQuestionIndex(intake({ changedSource: "problem" }), null), 0);
  assert.equal(resolveQuestionIndex(allAnswered, "99"), 4);
});
