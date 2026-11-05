import { adaptCnRulePacks, type CheckRulePack } from "../../../../../../packages/domain/src/v6/checks.ts";

/** The R1 host rule pack version; legal rows stay unverified under G-RULES closed. */
export const R1_ACTIVE_RULE_PACK_VERSION = "cnipa-2026-01-01";

/** Build the R1 pack from already-parsed rule JSON sources. */
export function buildR1RulePack(sources: readonly unknown[]): CheckRulePack {
  return adaptCnRulePacks(sources, R1_ACTIVE_RULE_PACK_VERSION);
}

/** Fallback for tests/hosts that do not load the shipped rule JSON. */
export const EMPTY_R1_RULE_PACK: CheckRulePack = Object.freeze({
  version: R1_ACTIVE_RULE_PACK_VERSION,
  rules: [],
});
