// Derives the Project display fields (claims/spec/audit/…) from a live
// pipeline context, so existing screens render real data without rewiring.
import type { PipelineContext } from "@patent/pipeline";
import type { Project } from "./types";

export function statusFromReached(reached: string): Project["status"] {
  switch (reached) {
    case "ingest_sources":
    case "extract_invention_facts":
    case "detect_conflicts":
    case "assess_readiness":
      return "readiness";
    case "generate_intake_questions":
      return "intake";
    case "merge_user_confirmations":
    case "build_invention_model":
    case "recommend_patent_type":
    case "propose_claim_strategy":
      return "strategy";
    case "draft_claim_skeleton":
    case "draft_claims":
    case "draft_specification":
    case "generate_figure_specs":
    case "draft_abstract":
      return "drafting";
    case "audit_support":
    case "audit_consistency":
    case "audit_formal_rules":
      return "auditing";
    case "export":
      return "ready";
    default:
      return "new";
  }
}

export function liveProjectView(p: Project): Project {
  const live = p.live;
  if (!live) return p;
  const ctx: PipelineContext = live.ctx;
  const out = { ...p };

  out.status = statusFromReached(live.reached);
  out.statusLabel = statusLabel(live.reached);

  const claims = ctx.results.draft_claims?.output as
    | { claims: Array<{ number: number; text: string; features: Array<{ text: string; status: string }> }> }
    | undefined;
  if (claims?.claims.length) {
    out.claims = claims.claims.map((c) => ({
      id: `live-claim-${c.number}`,
      label: `权利要求 ${c.number}`,
      text: c.text,
      sources: c.features.map((f) => ({
        label: f.status === "user_confirmed" ? `${f.text.slice(0, 42)}（用户确认）` : f.text.slice(0, 42),
        kind: (f.status === "source_backed" ? "source" : f.status === "user_confirmed" ? "user" : "none") as "source" | "user" | "none",
      })),
    }));
    out.claimsCount = claims.claims.length;
  }

  const spec = ctx.results.draft_specification?.output as { sections: Array<{ section: string; content: string }> } | undefined;
  if (spec?.sections.length) {
    const titles: Record<string, string> = {
      technical_field: "技术领域",
      background: "背景技术",
      summary: "发明内容",
      figures_desc: "附图说明",
      embodiments: "具体实施方式",
    };
    out.specSections = spec.sections.map((s, i) => ({
      id: `live-sec-${i}`,
      title: titles[s.section] ?? s.section,
      body: s.content,
    }));
  }

  const abstract = ctx.results.draft_abstract?.output as { abstract: string } | undefined;
  if (abstract?.abstract) out.abstractText = abstract.abstract;

  const figures = ctx.results.generate_figure_specs?.output as { figures: Array<{ kind: string; title: string }> } | undefined;
  if (figures?.figures.length) {
    out.figures = figures.figures.map((f, i) => ({
      id: `live-fig-${i}`,
      title: f.title,
      mode: (f.kind === "mechanical" || f.kind === "circuit" || f.kind === "structure" ? "brief" : "auto") as "auto" | "brief",
      badge: f.kind,
      previewLabel: f.kind === "brief" ? "需上传图纸" : "可自动生成",
    }));
  }

  const findings = ["audit_support", "audit_consistency", "audit_formal_rules"].flatMap((stage) => {
    const r = ctx.results[stage as keyof typeof ctx.results]?.output as { findings: Array<{ severity: string; message: string }> } | undefined;
    return (r?.findings ?? []).map((f) => ({ ...f, stage }));
  });
  if (findings.length) {
    const errors = findings.filter((f) => f.severity === "error").length;
    const warnings = findings.filter((f) => f.severity === "warning").length;
    const passed = findings.filter((f) => f.severity === "info").length;
    out.audit = {
      passed,
      warnings,
      errors,
      rows: (ctx.results.draft_claims?.output as { claims: Array<{ features: Array<{ text: string; status: string }> }> } | undefined)?.claims.flatMap(
        (c, ci) =>
          c.features.map((f) => ({
            feature: f.text,
            status: (f.status === "source_backed" ? "source" : f.status === "user_confirmed" ? "user" : "none") as "source" | "user" | "none",
            source: f.status,
            position: "",
            claimId: `live-claim-${ci + 1}`,
          })),
      ) ?? [],
      checks: findings.slice(0, 8).map((f) => ({
        icon: (f.severity === "error" ? "err" : f.severity === "warning" ? "warn" : "ok") as "ok" | "warn" | "err",
        text: f.message,
      })),
    };
  }

  return out;
}

function statusLabel(reached: string): string {
  const map: Record<string, string> = {
    ingest_sources: "解析材料",
    extract_invention_facts: "提取事实",
    detect_conflicts: "检测矛盾",
    assess_readiness: "充分性评估",
    generate_intake_questions: "补充确认",
    merge_user_confirmations: "合并确认",
    build_invention_model: "构建发明模型",
    recommend_patent_type: "类型建议",
    propose_claim_strategy: "策略建议",
    draft_claim_skeleton: "起草骨架",
    draft_claims: "起草权利要求",
    draft_specification: "起草说明书",
    generate_figure_specs: "附图规划",
    draft_abstract: "起草摘要",
    audit_support: "支持矩阵审校",
    audit_consistency: "一致性审校",
    audit_formal_rules: "形式规则审校",
    export: "导出门禁",
  };
  return map[reached] ?? reached;
}
