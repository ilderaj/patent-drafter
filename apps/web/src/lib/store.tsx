import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuditRow, IntakeAnswer, PatentType, Project, ProjectFile } from "./types";
import { demoProject, emptyProject, statusLabelOf } from "./data";
import { newId } from "@patent/shared";
import type { PipelineContext } from "@patent/pipeline";
import type { PipelineStage } from "@patent/domain";
import { createBrowserRunner, newLiveContext, RULE_PACK_VERSION, PROMPT_VERSION } from "./pipeline";
import { liveProjectView } from "./live-view";

const LS_KEY = "patent-drafter.v1";

function now(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/** Substring-window match: the claim body may reword a feature
 * (e.g. "插卡槽的下端设有…水通路" vs feature "插卡槽下端水通路"). */
function fuzzyHit(text: string, feature: string): boolean {
  if (text.includes(feature)) return true;
  for (let len = Math.min(6, feature.length); len >= 3; len--) {
    for (let i = 0; i + len <= feature.length; i++) {
      if (text.includes(feature.slice(i, i + len))) return true;
    }
  }
  return false;
}

/**
 * Apply a user confirmation of the given feature texts (or a whole claim):
 * flips "none" status to user-confirmed in claims, audit rows, and (for live
 * projects) the draft_claims context + matching audit findings.
 */
function confirmFeatureSources(p: Project, claimId: string | undefined, texts: string[]): Project {
  if (p.live) {
    const ctx: PipelineContext = { ...p.live.ctx, results: { ...p.live.ctx.results } };
    const claimsOut = ctx.results.draft_claims?.output as
      | { claims: Array<{ number: number; text: string; features: Array<{ text: string; status: string }> }> }
      | undefined;
    if (claimsOut) {
      claimsOut.claims = claimsOut.claims.map((c) => ({
        ...c,
        features: c.features.map((f) =>
          f.status === "none" && texts.some((t) => f.text === t || f.text.includes(t) || t.includes(f.text))
            ? { ...f, status: "user_confirmed" }
            : f,
        ),
      }));
      (ctx.results as Record<string, { output?: unknown }>).draft_claims = { ...ctx.results.draft_claims!, output: claimsOut };
    }
    for (const stage of ["audit_support", "audit_consistency", "audit_formal_rules"] as const) {
      const r = ctx.results[stage] as { output?: { findings: Array<{ severity: string; message: string }> } } | undefined;
      if (r?.output?.findings) {
        const findings = r.output.findings.filter(
          (f) => !(f.severity === "error" && texts.some((t) => fuzzyHit(f.message, t))),
        );
        (ctx.results as Record<string, { output?: unknown }>)[stage] = { ...r, output: { ...r.output, findings } };
      }
    }
    return liveProjectView({ ...p, live: { ...p.live, ctx } });
  }
  // Local/mock project: update claim sources and the stored audit in place.
  const claims = p.claims.map((c) => {
    const target = claimId ? c.id === claimId : c.sources.some((s) => s.kind === "none") && texts.some((t) => fuzzyHit(c.text, t));
    return target
      ? { ...c, sources: c.sources.map((src) => (src.kind === "none" ? { label: "用户确认", kind: "user" as const } : src)) }
      : c;
  });
  let audit = p.audit;
  if (audit) {
    const hit = (r: AuditRow): boolean =>
      r.status === "none" &&
      (claimId ? r.claimId === claimId : texts.some((t) => r.feature === t || r.feature.includes(t) || t.includes(r.feature)));
    const confirmed = audit.rows.filter(hit).length;
    if (confirmed > 0) {
      audit = {
        ...audit,
        rows: audit.rows.map((r) => (hit(r) ? { ...r, status: "user" as const, source: "用户确认" } : r)),
        errors: Math.max(0, audit.errors - confirmed),
        passed: audit.passed + confirmed,
      };
    }
  }
  return { ...p, claims, audit };
}

interface AppState {
  projects: Project[];
  currentId: string | null;
  bridgeMode: "connected" | "none" | "pairing" | "error";
}

interface AppStore extends AppState {
  current: Project | null;
  createProject: (name: string, type: PatentType) => string;
  loadDemo: () => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  patchFile: (id: string, fileId: string, patch: Partial<ProjectFile>) => void;
  proceedFromReadiness: (id: string) => void;
  answerIntake: (id: string, answer: IntakeAnswer) => void;
  completeIntake: (id: string) => void;
  confirmStrategy: (id: string) => void;
  /** User confirms the source of an unsupported feature (unblocks the export gate). */
  confirmClaimSource: (id: string, claimId: string) => void;
  /** Confirm a single audit row (feature text) regardless of claim linkage. */
  confirmAuditFeature: (id: string, featureText: string) => void;
  /** Persist claim text edits; for live projects the draft_claims context stays in sync. */
  saveClaimText: (id: string, claimId: string, text: string) => void;
  regenerateClaim: (id: string, claimId: string) => void;
  /** Start a real pipeline project from pasted disclosure text. */
  startLive: (id: string, title: string, text: string) => Promise<void>;
  /** Run the live pipeline up to and including `stage` (cached stages are skipped). */
  runLiveTo: (id: string, stage: string) => Promise<void>;
  /** Persist user answers into the live intake and continue to merge. */
  answerLiveIntake: (id: string, answers: Record<string, string>) => Promise<void>;
  setBridgeMode: (mode: AppState["bridgeMode"]) => void;
  deleteProject: (id: string) => void;
  resetDemo: () => void;
}

const Ctx = createContext<AppStore | null>(null);

function load(): AppState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch {
    /* ignore corrupt state */
  }
  return { projects: [], currentId: null, bridgeMode: "connected" };
}

function save(state: AppState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* storage full / private mode: flow continues in memory */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);

  useEffect(() => {
    save(state);
  }, [state]);

  const update = useCallback((fn: (s: AppState) => AppState) => {
    setState((prev) => fn(prev));
  }, []);

  const current = useMemo(
    () => state.projects.find((p) => p.id === state.currentId) ?? null,
    [state.projects, state.currentId],
  );

  const createProject = useCallback(
    (name: string, type: PatentType) => {
      const id = newId("prj", 8);
      const now = new Date().toISOString().slice(0, 16).replace("T", " ");
      const p: Project = { ...emptyProject(), id, name, patentType: type, updatedAt: now };
      update((s) => ({ ...s, projects: [p, ...s.projects], currentId: id }));
      return id;
    },
    [update],
  );

  const loadDemo = useCallback(() => {
    const p = demoProject();
    update((s) => {
      const exists = s.projects.some((x) => x.id === p.id);
      return {
        ...s,
        projects: exists ? s.projects.map((x) => (x.id === p.id ? p : x)) : [p, ...s.projects],
        currentId: p.id,
      };
    });
  }, []);

  const resetDemo = useCallback(() => {
    update((s) => ({
      ...s,
      projects: s.projects.filter((p) => p.id !== "demo-hot-water-meter"),
      currentId: s.currentId === "demo-hot-water-meter" ? null : s.currentId,
    }));
  }, []);

  const patchProject = useCallback(
    (id: string, patch: Partial<Project>) => {
      update((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === id
            ? { ...p, ...patch, updatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") }
            : p,
        ),
      }));
    },
    [update],
  );

  /** Functional file patch: reads the latest project state (parse results). */
  const patchFile = useCallback(
    (id: string, fileId: string, patch: Partial<ProjectFile>) => {
      update((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === id
            ? { ...p, files: (p.files ?? []).map((f) => (f.id === fileId ? { ...f, ...patch } : f)) }
            : p,
        ),
      }));
    },
    [update],
  );

  const proceedFromReadiness = useCallback(
    (id: string) => {
      patchProject(id, { status: "intake", statusLabel: statusLabelOf("intake") });
    },
    [patchProject],
  );

  const answerIntake = useCallback(
    (id: string, answer: IntakeAnswer) => {
      update((s) => ({
        ...s,
        projects: s.projects.map((p) => {
          if (p.id !== id) return p;
          const rest = p.intakeAnswers.filter((a) => a.id !== answer.id);
          return { ...p, intakeAnswers: [...rest, answer] };
        }),
      }));
    },
    [update],
  );

  const completeIntake = useCallback(
    (id: string) => {
      patchProject(id, { status: "strategy", statusLabel: statusLabelOf("strategy") });
    },
    [patchProject],
  );

  const confirmStrategy = useCallback(
    (id: string) => {
      patchProject(id, {
        strategyConfirmed: true,
        status: "drafting",
        statusLabel: statusLabelOf("drafting"),
      });
    },
    [patchProject],
  );

  const confirmClaimSource = useCallback(
    (id: string, claimId: string) => {
      update((s) => ({
        ...s,
        projects: s.projects.map((p) => {
          if (p.id !== id) return p;
          const claim = p.claims.find((c) => c.id === claimId);
          const texts = (p.audit?.rows ?? [])
            .filter((r) => r.status === "none" && (r.claimId === claimId || (claim ? fuzzyHit(claim.text, r.feature) : false)))
            .map((r) => r.feature);
          return confirmFeatureSources(p, claimId, texts);
        }),
      }));
    },
    [update],
  );

  const confirmAuditFeature = useCallback(
    (id: string, featureText: string) => {
      update((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === id ? confirmFeatureSources(p, undefined, [featureText]) : p)),
      }));
    },
    [update],
  );

  const saveClaimText = useCallback(
    (id: string, claimId: string, text: string) => {
      update((s) => ({
        ...s,
        projects: s.projects.map((p) => {
          if (p.id !== id) return p;
          const claims = p.claims.map((c) => (c.id === claimId ? { ...c, text } : c));
          if (!p.live) return { ...p, claims, updatedAt: now() };
          // Live pipeline: write the edit back into the draft_claims context so
          // derived views (workbench/audit/export) stay consistent until the
          // next pipeline run regenerates the stage.
          const ctx: PipelineContext = { ...p.live.ctx, results: { ...p.live.ctx.results } };
          const claimsOut = ctx.results.draft_claims?.output as
            | { claims: Array<{ number: number; text: string }> }
            | undefined;
          const num = Number(claimId.replace("live-claim-", ""));
          if (claimsOut) {
            claimsOut.claims = claimsOut.claims.map((c) => (c.number === num ? { ...c, text } : c));
            (ctx.results as Record<string, { output?: unknown }>).draft_claims = { ...ctx.results.draft_claims!, output: claimsOut };
          }
          return liveProjectView({ ...p, claims, live: { ...p.live, ctx }, updatedAt: now() });
        }),
      }));
    },
    [update],
  );

  /** Shared live-pipeline executor: loads the project, runs, saves back. */
  const withLive = useCallback(
    async (id: string, fn: (ctx: PipelineContext) => Promise<string>) => {
      const p = state.projects.find((x) => x.id === id);
      if (!p?.live) throw new Error("project is not a live pipeline project");
      const ctx: PipelineContext = { ...p.live.ctx, results: { ...p.live.ctx.results } };
      update((s) => ({
        ...s,
        projects: s.projects.map((x) =>
          x.id === id ? { ...x, live: { ...x.live!, running: true, error: undefined } } : x,
        ),
      }));
      try {
        const reached = await fn(ctx);
        update((s) => ({
          ...s,
          projects: s.projects.map((x) =>
            x.id === id ? liveProjectView({ ...x, live: { ...x.live!, ctx, reached, running: false }, updatedAt: now() }) : x,
          ),
        }));
        return;
      } catch (e) {
        update((s) => ({
          ...s,
          projects: s.projects.map((x) =>
            x.id === id ? { ...x, live: { ...x.live!, running: false, error: (e as Error).message } } : x,
          ),
        }));
        throw e;
      }
    },
    [state.projects, update],
  );

  const startLive = useCallback(
    async (id: string, title: string, text: string) => {
      const ctx = newLiveContext(title, text);
      update((s) => ({
        ...s,
        projects: s.projects.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "readiness",
                statusLabel: "分析交底材料",
                intakeQuestions: [],
                live: { ctx, reached: "ingest_sources", running: true, disclosure: text },
              }
            : x,
        ),
      }));
      const runner = await createBrowserRunner(true);
      try {
        await runner.runUntil(ctx, "generate_intake_questions");
        const intakeOut = ctx.results.generate_intake_questions?.output as {
          questions: Array<{ id: string; question: string; options?: string[]; required: boolean }>;
        };
        const readinessOut = ctx.results.assess_readiness?.output as { readiness: string; coverage: number };
        update((s) => ({
          ...s,
          projects: s.projects.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status: "intake",
                  statusLabel: "补充确认",
                  coverage: Math.round((readinessOut?.coverage ?? 0.5) * 100),
                  intakeQuestions: (intakeOut?.questions ?? []).map((q, i) => ({
                    id: i + 1,
                    question: q.question,
                    source: q.required ? "必答" : "可选",
                    options: q.options ?? [],
                    notePlaceholder: "补充说明（可选）",
                  })),
                  live: { ...x.live!, ctx, reached: "generate_intake_questions", running: false },
                }
              : x,
          ),
        }));
      } catch (e) {
        update((s) => ({
          ...s,
          projects: s.projects.map((x) =>
            x.id === id ? { ...x, live: { ...x.live!, running: false, error: (e as Error).message } } : x,
          ),
        }));
        throw e;
      }
    },
    [update],
  );

  const answerLiveIntake = useCallback(
    async (id: string, answers: Record<string, string>) => {
      await withLive(id, async (ctx) => {
        ctx.userAnswers = answers;
        const runner = await createBrowserRunner(true);
        await runner.runUntil(ctx, "merge_user_confirmations");
        return "merge_user_confirmations";
      });
    },
    [withLive],
  );

  const runLiveTo = useCallback(
    async (id: string, stage: string) => {
      await withLive(id, async (ctx) => {
        const runner = await createBrowserRunner(true);
        await runner.runUntil(ctx, stage as PipelineStage);
        return stage;
      });
    },
    [withLive],
  );

  const regenerateClaim = useCallback(
    (id: string, claimId: string) => {
      update((s) => ({
        ...s,
        projects: s.projects.map((p) => {
          if (p.id !== id) return p;
          return {
            ...p,
            claims: p.claims.map((c) => (c.id === claimId ? { ...c, stale: false } : c)),
          };
        }),
      }));
    },
    [update],
  );

  const setBridgeMode = useCallback((mode: AppState["bridgeMode"]) => {
    update((s) => ({ ...s, bridgeMode: mode }));
  }, [update]);

  const deleteProject = useCallback(
    (id: string) => {
      update((s) => ({
        ...s,
        projects: s.projects.filter((p) => p.id !== id),
        currentId: s.currentId === id ? null : s.currentId,
      }));
    },
    [update],
  );

  const value = useMemo<AppStore>(
    () => ({
      ...state,
      current,
      createProject,
      loadDemo,
      resetDemo,
      updateProject: patchProject,
      patchFile,
      proceedFromReadiness,
      answerIntake,
      completeIntake,
      confirmStrategy,
      confirmClaimSource,
      confirmAuditFeature,
      saveClaimText,
      regenerateClaim,
      startLive,
      runLiveTo,
      answerLiveIntake,
      setBridgeMode,
      deleteProject,
    }),
    [
      state,
      current,
      createProject,
      loadDemo,
      resetDemo,
      patchProject,
      patchFile,
      proceedFromReadiness,
      answerIntake,
      completeIntake,
      confirmStrategy,
      confirmClaimSource,
      confirmAuditFeature,
      saveClaimText,
      regenerateClaim,
      startLive,
      runLiveTo,
      answerLiveIntake,
      setBridgeMode,
      deleteProject,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): AppStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
