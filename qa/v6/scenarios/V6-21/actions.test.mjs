import test from "node:test";
import assert from "node:assert/strict";

import { nextAction } from "../../../../apps/web/src/v6/features/matters/actions.ts";

const complete = Object.freeze({
  hasValidSource: true,
  fiveQuestionsComplete: true,
  hasOpenConflict: false,
  hasDraft: true,
  inputStale: false,
  mode: "self_service",
  hasUnconfirmedGeneratedContent: false,
  hasFullRead: true,
  hasCurrentCheck: true,
  hasUnacknowledgedRequiredRisk: false,
  hasInternalApproval: true,
  hasCurrentExport: true,
  hasConfirmedReceipt: true,
});

test("nextAction follows every S06 priority in order without mutating its input", () => {
  const cases = [
    [{ hasValidSource: false, fiveQuestionsComplete: false }, "add_sources"],
    [{ hasOpenConflict: true, inputStale: true }, "resolve_conflict"],
    [{ hasDraft: false, inputStale: true }, "generate_draft"],
    [{ inputStale: true }, "refresh_inputs"],
    [{ mode: "professional", hasUnconfirmedGeneratedContent: true }, "confirm_content"],
    [{ mode: "self_service", hasFullRead: false }, "confirm_content"],
    [{ hasCurrentCheck: false }, "run_check"],
    [{ hasUnacknowledgedRequiredRisk: true }, "ack_risk"],
    [{ mode: "professional", hasInternalApproval: false }, "approve"],
    [{ hasCurrentExport: false }, "export"],
    [{ hasCurrentExport: true, hasConfirmedReceipt: false }, "record_receipt"],
    [{}, "none"],
  ];

  for (const [patch, expected] of cases) {
    const target = { ...complete, ...patch };
    const before = structuredClone(target);
    assert.equal(nextAction(target), expected);
    assert.deepEqual(target, before, `input changed for ${expected}`);
  }
});
