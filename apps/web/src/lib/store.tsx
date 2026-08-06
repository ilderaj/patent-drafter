import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { IntakeAnswer, PatentType, Project, ProjectFile } from "./types";
import { INTAKE_QUESTIONS, READINESS_DIMENSIONS, demoProject, emptyProject, statusLabelOf } from "./data";
import { newId } from "@patent/shared";

const LS_KEY = "patent-drafter.v1";

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
