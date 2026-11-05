/**
 * V6-09 — the settings appearance panel (S01 主题与设置).
 *
 * All validation, persistence and theme resolution live in
 * `v6/styles/preferences.ts`; this file only wires that interface to React and
 * the document root. `AppearanceProvider` owns the current preference for the
 * whole `/v6` shell, including failed saves and departure protection.
 *
 * Saving is explicit about its outcome: "已保存" appears only after a
 * successful write, a failed write keeps the live preview and shows
 * "尚未保存" with a retry, and a refresh reads the stored record again — so a
 * value that never reached storage is not claimed after a reload.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import {
  COLOR_MODES,
  MODE_LABELS,
  THEME_IDS,
  THEME_LABELS,
  applyAppearance,
  describeAppearance,
  readAppearance,
  saveAppearance,
  systemPrefersDark,
  watchSystemColorMode,
  type AppearancePreference,
  type ColorMode,
  type MediaQueryLike,
  type ThemeId,
} from "../../styles/preferences.ts";

function storageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function mediaOrNull(): MediaQueryLike | null {
  try {
    return typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? null
      : window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return null;
  }
}

/** Track OS light/dark at runtime (S01: system follows runtime changes). */
function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark(mediaOrNull()));
  useEffect(() => {
    const media = mediaOrNull();
    if (!media) return;
    setPrefersDark(systemPrefersDark(media));
    return watchSystemColorMode(media, setPrefersDark);
  }, []);
  return prefersDark;
}

type SaveState = { state: "idle" } | { state: "saved" } | { state: "failed"; message: string };

/** BrowserRouter has no useBlocker; guard its navigator and indexed POPs. */
function useFailedSaveProtection(failed: boolean, discard: () => void): void {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  useLayoutEffect(() => {
    if (!failed) return;
    const confirmDeparture = () => {
      if (!window.confirm("外观尚未保存。确定放弃未保存的选择并离开吗？取消可留在页面重试。")) return false;
      discard();
      return true;
    };
    const push = navigator.push;
    const replace = navigator.replace;
    navigator.push = (...args) => { if (confirmDeparture()) push(...args); };
    navigator.replace = (...args) => { if (confirmDeparture()) replace(...args); };

    const currentState = window.history.state;
    const currentUrl = window.location.href;
    let restoring = false;
    const onPop = (event: PopStateEvent) => {
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      if (confirmDeparture()) return;
      // A capture listener on window runs before BrowserRouter's bubble
      // listener, so on Stay the router never sees the POP and the page stays
      // mounted. Return to the settings entry; push one only when the entry
      // has no router index to step back by.
      event.stopImmediatePropagation();
      const delta = currentState?.idx - event.state?.idx;
      if (Number.isFinite(delta) && delta !== 0) {
        restoring = true;
        window.history.go(delta);
      } else {
        window.history.pushState(currentState, "", currentUrl);
      }
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("popstate", onPop, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      navigator.push = push;
      navigator.replace = replace;
      window.removeEventListener("popstate", onPop, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [failed, discard, navigator]);
}

function useAppearance() {
  const prefersDark = useSystemPrefersDark();
  const [initial] = useState(() => readAppearance(storageOrNull()));
  const [preference, setPreference] = useState<AppearancePreference>(initial.preference);
  const [savedPreference, setSavedPreference] = useState(initial.preference);
  const [save, setSave] = useState<SaveState>({ state: "idle" });

  useLayoutEffect(() => {
    const root = document.documentElement;
    const theme = root.getAttribute("data-theme");
    const mode = root.getAttribute("data-mode");
    return () => {
      if (theme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", theme);
      if (mode === null) root.removeAttribute("data-mode");
      else root.setAttribute("data-mode", mode);
    };
  }, []);
  useLayoutEffect(() => {
    applyAppearance(document.documentElement, preference, prefersDark);
  }, [preference, prefersDark]);

  const persist = useCallback((next: AppearancePreference) => {
    const result = saveAppearance(storageOrNull(), next);
    if (result.ok) setSavedPreference(next);
    setSave(result.ok ? { state: "saved" } : { state: "failed", message: result.message });
  }, []);
  const choose = useCallback((next: AppearancePreference) => {
    setPreference(next);
    persist(next);
  }, [persist]);
  const discard = useCallback(() => {
    setPreference(savedPreference);
    setSave({ state: "idle" });
  }, [savedPreference]);
  useFailedSaveProtection(save.state === "failed", discard);
  return { initial, preference, prefersDark, save, choose, persist };
}

const AppearanceContext = createContext<ReturnType<typeof useAppearance> | null>(null);

/** One owner survives settings navigation and releases the root on V6 exit. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const appearance = useAppearance();
  return <AppearanceContext.Provider value={appearance}>{children}</AppearanceContext.Provider>;
}

export function AppearancePage() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) throw new Error("AppearancePage requires AppearanceProvider");
  const { initial, preference, prefersDark, save, choose, persist } = appearance;
  const readNote =
    initial.state === "invalid"
      ? "之前保存的外观设置无法识别，已使用默认外观。"
      : initial.state === "unavailable"
        ? "本机存储暂时无法读取，正在使用默认外观。"
        : null;

  return (
    <div className="v6-page" data-testid="appearance">
      <h1 className="v6-title">设置</h1>
      <p className="muted">外观保存在这台设备的浏览器里，不会上传。</p>
      {readNote ? (
        <div className="notice" data-testid="appearance-read-note">
          {readNote}
        </div>
      ) : null}
      <section className="card v6-appearance" aria-labelledby="appearance-title">
        <h2 className="card-title" id="appearance-title">
          外观
        </h2>
        <fieldset className="v6-field">
          <legend>主题</legend>
          <div className="v6-choices">
            {THEME_IDS.map((id: ThemeId) => (
              <label key={id} className="v6-choice">
                <input
                  type="radio"
                  name="theme"
                  value={id}
                  checked={preference.themeId === id}
                  onChange={() => choose({ ...preference, themeId: id })}
                />
                <span>{THEME_LABELS[id]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="v6-field">
          <legend>颜色模式</legend>
          <div className="v6-choices">
            {COLOR_MODES.map((id: ColorMode) => (
              <label key={id} className="v6-choice">
                <input
                  type="radio"
                  name="color-mode"
                  value={id}
                  checked={preference.colorMode === id}
                  onChange={() => choose({ ...preference, colorMode: id })}
                />
                <span>{MODE_LABELS[id]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="v6-appearance-status" data-testid="appearance-status" role="status" aria-live="polite">
          当前外观：{describeAppearance(preference, prefersDark)}
        </p>
        {save.state === "saved" ? (
          <p className="v6-save-state" data-testid="appearance-save" data-state="saved">
            已保存。
          </p>
        ) : null}
        {save.state === "failed" ? (
          <div className="notice" role="alert" data-testid="appearance-save-failed">
            <strong>尚未保存</strong>
            <p>{save.message}</p>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => persist(preference)}>
              重试
            </button>
          </div>
        ) : null}
        <p className="field-hint">选择「跟随系统」时，系统切换浅色或深色会立即生效。这里只保存主题和颜色模式。</p>
      </section>
      <section className="card" data-testid="notification-capability">
        <h2 className="card-title">通知</h2>
        <p className="card-description">
          R1 不发送邮件，也不会出现模拟送达。云协作与邮件通知尚未配置，通知设置将在后续版本提供。
        </p>
      </section>
    </div>
  );
}
