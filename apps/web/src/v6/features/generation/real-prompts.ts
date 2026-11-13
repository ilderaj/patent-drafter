import system from "../../../../../../packages/prompts/system-core.md?raw";
import extract from "../../../../../../packages/prompts/extract-facts.md?raw";
import conflicts from "../../../../../../packages/prompts/detect-conflicts.md?raw";
import readiness from "../../../../../../packages/prompts/readiness.md?raw";
import intake from "../../../../../../packages/prompts/intake.md?raw";
import strategy from "../../../../../../packages/prompts/patent-strategy.md?raw";
import skeleton from "../../../../../../packages/prompts/claim-skeleton.md?raw";
import claims from "../../../../../../packages/prompts/draft-claims.md?raw";
import specification from "../../../../../../packages/prompts/draft-specification.md?raw";
import figures from "../../../../../../packages/prompts/figure-spec.md?raw";
import abstract from "../../../../../../packages/prompts/draft-abstract.md?raw";
import support from "../../../../../../packages/prompts/audit-support.md?raw";
import consistency from "../../../../../../packages/prompts/audit-consistency.md?raw";
import formal from "../../../../../../packages/prompts/audit-formal-rules.md?raw";

/** Existing reviewed-source prompts, with an explicit preparation-only CN utility-model scope. */
export const REAL_PIPELINE_PROMPTS: Readonly<Record<string, string>> = Object.freeze({
  "system-core.md": `${system}\n\n本次任务仅整理中国实用新型中文申请准备稿。仅使用案件中已提供且可追溯的材料与人工确认事实，不添加法律结论，不保证可申请或授权。法律与形式规则提示只供人工核对。缺少依据时如实返回缺项或风险，不补造。\n\n输入的 chunk 若带 origin=user_answer，则它是用户直接键入的回答（label 指明第几题），不是文件、也没有页码：可作为 source_backed 依据引用其 chunkId，refs 中不要写 page，不要把它说成文档或附件。`,
  "extract-facts.md": extract,
  "detect-conflicts.md": conflicts,
  "readiness.md": readiness,
  "intake.md": intake,
  "patent-strategy.md": strategy,
  "claim-skeleton.md": skeleton,
  "draft-claims.md": claims,
  "draft-specification.md": specification,
  "figure-spec.md": figures,
  "draft-abstract.md": abstract,
  "audit-support.md": support,
  "audit-consistency.md": consistency,
  "audit-formal-rules.md": formal,
});
