import { buildR1RulePack, R1_ACTIVE_RULE_PACK_VERSION } from "./rule-pack.ts";
import type { CheckRulePack } from "../../../../../../packages/domain/src/v6/checks.ts";
import common from "../../../../../../packages/rules-cn/2023-baseline/common.json?raw";
import claims from "../../../../../../packages/rules-cn/2023-baseline/claims.json?raw";
import invention from "../../../../../../packages/rules-cn/2023-baseline/invention.json?raw";
import utilityModel from "../../../../../../packages/rules-cn/2023-baseline/utility-model.json?raw";
import aiRelated from "../../../../../../packages/rules-cn/2026-01-01/ai-related.json?raw";

/** Vite-only loader: imports the shipped rule JSON as raw text. */
export const R1_RULE_PACK: CheckRulePack = buildR1RulePack(
  [common, claims, invention, utilityModel, aiRelated].map((raw) => JSON.parse(raw) as unknown),
);
export { R1_ACTIVE_RULE_PACK_VERSION };
