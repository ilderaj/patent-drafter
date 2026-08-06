import type { DeterministicCheckFn, RuleCheckResult, RulePack } from "./types.js";

/**
 * Deterministic check registry. Checks are keyed by the `deterministicCheck`
 * string used inside rule pack JSON, so rule packs stay data-driven.
 */
export class CheckRegistry {
  private readonly checks = new Map<string, DeterministicCheckFn>();

  register(name: string, fn: DeterministicCheckFn): void {
    if (this.checks.has(name)) {
      throw new Error(`duplicate deterministic check: ${name}`);
    }
    this.checks.set(name, fn);
  }

  has(name: string): boolean {
    return this.checks.has(name);
  }

  run(rules: RulePack["rules"], ctx: Parameters<DeterministicCheckFn>[0]): RuleCheckResult[] {
    const out: RuleCheckResult[] = [];
    for (const rule of rules) {
      const fn = this.checks.get(rule.deterministicCheck);
      if (!fn) {
        out.push({
          ruleId: rule.ruleId,
          passed: false,
          severity: "error",
          message: `no registered check for deterministicCheck="${rule.deterministicCheck}"`,
          remediation: rule.remediation,
        });
        continue;
      }
      for (const result of fn(ctx)) {
        if (result.ruleId === rule.ruleId) out.push(result);
      }
    }
    return out;
  }
}

/** Rule check prototype from spikes/rules-spike will be ported here during implementation. */
export const PROTO_CHECK_NAMES = [
  "nameFormat",
  "specSectionsComplete",
  "problemSolutionEffectAligned",
  "claimsSupported",
  "dependentClaimReferences",
  "multipleDependentReferences",
  "termConsistency",
  "utilityModelProductSubject",
  "utilityModelFiguresRequired",
  "abstractWordLimit",
  "noPromotionalLanguage",
  "figureRefsBidirectional",
  "figureNumbersConsistent",
  "noBeyondOriginalDisclosure",
  "inventorNaturalPerson",
  "aiDisclosureConfirmed",
] as const;
