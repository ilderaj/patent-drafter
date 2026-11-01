/**
 * V6-14 deterministic recommendation and route cards (S03-A07, S03-A08,
 * S03-A09). Pure rules: same input, same output, no model and no clock.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  FOREIGN_DRAFT_WARNING,
  R1_RULE_PACK,
  TRANSLATION_CAPABILITY,
  UNVERIFIED_LABEL,
  buildCapabilities,
  createTarget,
  languageOptions,
  normalizeConfigInput,
  recommendRoutes,
  routeCards,
} from "../../../../apps/web/src/v6/features/targets/targets.ts";
import {
  ACTOR_A,
  FACTS,
  FACT_METHOD,
  FACT_STRUCTURE,
  MATTER_A,
  T1,
  config,
  readyView,
  seed,
} from "./harness.mjs";

const structure = { id: FACT_STRUCTURE, kind: "structure", statement: "结构" };
const method = { id: FACT_METHOD, kind: "method", statement: "方法" };

function verifiedPack() {
  return {
    version: "test-verified",
    rules: R1_RULE_PACK.rules.map((rule) =>
      rule.route === "cn_um"
        ? {
            ...rule,
            verification: "verified",
            verifiedBy: "synthetic-reviewer",
            verifiedAt: T1,
            cycle: { value: "合成周期 6 个月", note: null },
            fee: { value: "合成费用 100 元", note: null },
            term: { value: "合成保护期 10 年", note: null },
          }
        : { ...rule, cycle: { value: "不应显示", note: null }, fee: { value: "不应显示", note: null }, term: null },
    ),
  };
}

test("S03 a structure fact plus tested_sample or drawing recommends cn_um and lists cn_invention", () => {
  for (const maturity of ["tested_sample", "drawing"]) {
    const result = recommendRoutes([structure], maturity);
    assert.deepEqual(result.recommended, ["cn_um", "cn_invention"]);
    assert.equal(result.fallback, false);
    assert.equal(result.rules.length, 1);
    assert.equal(result.rules[0].ruleId, "structure_evidence_utility_model");
    assert.deepEqual(result.rules[0].triggers, [
      { kind: "fact", factId: FACT_STRUCTURE, factKind: "structure" },
      { kind: "maturity", value: maturity },
    ]);
    assert.deepEqual(result.excluded, []);
  }
});

test("S03-A09 a method fact excludes cn_um and names the triggering rule and fact", () => {
  const result = recommendRoutes([structure, method], "tested_sample");
  assert.equal(result.recommended.includes("cn_um"), false);
  assert.deepEqual(result.recommended, ["cn_invention"]);
  const excluded = result.excluded.find((item) => item.route === "cn_um");
  assert.equal(excluded.ruleId, "method_blocks_utility_model");
  assert.deepEqual(excluded.triggers, [{ kind: "fact", factId: FACT_METHOD, factKind: "method" }]);
  const card = routeCards(result, buildCapabilities()).find((item) => item.route === "cn_um");
  assert.equal(card.recommended, false);
  assert.equal(card.excludedBy.ruleId, "method_blocks_utility_model");
  assert.equal(card.excludedBy.triggers[0].factId, FACT_METHOD);
});

test("S03 maturity=idea excludes cn_um even with a structure fact", () => {
  const result = recommendRoutes([structure], "idea");
  assert.equal(result.recommended.includes("cn_um"), false);
  const excluded = result.excluded.find((item) => item.route === "cn_um");
  assert.equal(excluded.ruleId, "idea_blocks_utility_model");
  assert.deepEqual(excluded.triggers, [{ kind: "maturity", value: "idea" }]);
});

test("S03 no route rule fires without facts: fallback, nothing recommended, no invented reason", () => {
  const result = recommendRoutes([], null);
  assert.equal(result.fallback, true);
  assert.deepEqual(result.recommended, []);
  assert.deepEqual(result.rules, []);
  assert.deepEqual(recommendRoutes([], null), result, "pure and deterministic");
});

test("S03 the user may save a route other than the recommendation", async () => {
  const { repository } = await seed({ facts: ["structure", "method"], maturity: "tested_sample" });
  const view = await readyView(repository);
  assert.deepEqual(view.recommendation.recommended, ["cn_invention"]);
  assert.equal(view.routeCards.find((card) => card.route === "cn_um").excludedBy.ruleId, "method_blocks_utility_model");
  const created = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, { now: () => T1 });
  assert.equal(created.ok, true, "an excluded route is still a valid user choice");
  assert.equal(created.data.config.route, "cn_um");
});

test("the view's recommendation is built from the stored snapshot facts and maturity", async () => {
  const { repository } = await seed({ facts: ["structure", "effect"], maturity: "drawing" });
  const view = await readyView(repository);
  assert.deepEqual(view.recommendation.recommended, ["cn_um", "cn_invention"]);
  assert.equal(view.recommendation.rules[0].triggers[0].factId, FACTS.structure.id);
});

test("S03-A07 every card shows protection, examination, limits and verification; numbers stay hidden when unverified", () => {
  const cards = routeCards(recommendRoutes([structure], "tested_sample"), buildCapabilities());
  assert.deepEqual(
    cards.map((card) => card.route),
    ["cn_um", "cn_invention", "us_nonprovisional", "pct"],
  );
  for (const card of cards) {
    assert.ok(card.protection.length > 0);
    assert.ok(card.examination.length > 0);
    assert.ok(card.limits.length > 0);
    assert.equal(card.verification, "unverified");
    assert.equal(card.verificationLabel, UNVERIFIED_LABEL);
    for (const number of [card.cycle, card.fee, card.term]) {
      assert.equal(number.value, null);
      assert.equal(number.verified, false);
    }
  }
});

test("S03-A07 numbers appear only for a verified rule entry", () => {
  const cards = routeCards(recommendRoutes([], null), buildCapabilities(), verifiedPack());
  const um = cards.find((card) => card.route === "cn_um");
  assert.equal(um.verification, "verified");
  assert.equal(um.cycle.value, "合成周期 6 个月");
  assert.equal(um.fee.value, "合成费用 100 元");
  assert.equal(um.term.value, "合成保护期 10 年");
  const invention = cards.find((card) => card.route === "cn_invention");
  assert.equal(invention.verification, "unverified");
  assert.equal(invention.cycle.value, null, "an unverified entry never shows its number");
  assert.equal(invention.fee.value, null);
});

test("S03-A08 US and PCT default to zh-CN and carry the exact handoff sentence", () => {
  const cards = routeCards(recommendRoutes([], null), buildCapabilities());
  for (const card of cards) {
    if (card.route === "us_nonprovisional" || card.route === "pct") {
      assert.equal(card.foreign, true);
      assert.equal(card.defaultLanguage, "zh-CN");
      assert.equal(card.foreignWarning, "中文准备稿，需翻译并由适格人员核对，不能直接作为该法域申请文件");
      assert.equal(card.foreignWarning, FOREIGN_DRAFT_WARNING);
    } else {
      assert.equal(card.foreignWarning, null);
    }
  }
  const shaped = normalizeConfigInput(config("pct"));
  assert.equal(shaped.ok, true);
  assert.equal(shaped.config.language, "zh-CN");
});

test("S03-A08 en-US is disabled with a visible reason unless translation_en is available", () => {
  const off = languageOptions(buildCapabilities(), "us_nonprovisional");
  const en = off.find((option) => option.value === "en-US");
  assert.equal(en.disabled, true);
  assert.ok(en.reason && en.reason.length > 0);
  assert.equal(off.find((option) => option.value === "zh-CN").disabled, false);

  const on = buildCapabilities().map((capability) =>
    capability.key === TRANSLATION_CAPABILITY ? { ...capability, state: "available", reason: null } : capability,
  );
  const enabled = languageOptions(on, "us_nonprovisional").find((option) => option.value === "en-US");
  assert.equal(enabled.disabled, false);
  assert.equal(enabled.reason, null);
  const shaped = normalizeConfigInput({ ...config("us_nonprovisional"), language: "en-US" }, on);
  assert.equal(shaped.ok, true);
  assert.equal(shaped.config.language, "en-US");

  const missing = languageOptions([], "pct").find((option) => option.value === "en-US");
  assert.equal(missing.disabled, true, "a capability list without translation_en keeps en-US off");
  assert.ok(missing.reason.length > 0);
});
