import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { IntakeAnswer, PatentType, Project, ProjectFile } from "./types";
import { INTAKE_QUESTIONS, READINESS_DIMENSIONS, demoProject, emptyProject, statusLabelOf } from "./data";
import { newId } from "@patent/shared";
import type { PipelineContext } from "@patent/pipeline";
import type { PipelineStage } from "@patent/domain";
import { createBrowserRunner, newLiveContext, RULE_PACK_VERSION, PROMPT_VERSION } from "./pipeline";
import { liveProjectView } from "./live-view";

const LS_KEY = "patent-drafter.v1";

function now(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
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
  addFiles: (id: string, files: ProjectFile[]) => void;
  runParse: (id: string) => void;
  proceedFromReadiness: (id: string) => void;
  answerIntake: (id: string, answer: IntakeAnswer) => void;
  completeIntake: (id: string) => void;
  confirmStrategy: (id: string) => void;
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

  const addFiles = useCallback(
    (id: string, files: ProjectFile[]) => {
      patchProject(id, { files: [...files], status: "uploading", statusLabel: "解析中" });
    },
    [patchProject],
  );

  /** Mock 解析：短暂进度后进入充分性报告。 */
  const runParse = useCallback(
    (id: string) => {
      patchProject(id, {
        files: [],
        status: "readiness",
        statusLabel: statusLabelOf("readiness"),
        coverage: 62,
        coverageNote:
          "已识别 14 项事实，其中 8 项有材料来源；需要补充 6 项才能进入起草。存在 3 处需要确认的矛盾。",
        dimensions: READINESS_DIMENSIONS,
        intakeNote: "当前材料不足以直接起草。系统将先通过 4 个问题补充信息并确认 3 处矛盾。",
        intakeQuestions: INTAKE_QUESTIONS,
      });
    },
    [patchProject],
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
      const runner = createBrowserRunner(true);
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
        const runner = createBrowserRunner(true);
        await runner.runUntil(ctx, "merge_user_confirmations");
        return "merge_user_confirmations";
      });
    },
    [withLive],
  );

  const runLiveTo = useCallback(
    async (id: string, stage: string) => {
      await withLive(id, async (ctx) => {
        const runner = createBrowserRunner(true);
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
      addFiles,
      runParse,
      proceedFromReadiness,
      answerIntake,
      completeIntake,
      confirmStrategy,
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
      addFiles,
      runParse,
      proceedFromReadiness,
      answerIntake,
      completeIntake,
      confirmStrategy,
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
