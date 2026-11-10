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
import { UNSAFE_NavigationContext, Link } from "react-router-dom";
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
import { Body, Button, Pane, StatusShape, Toolbar } from "../../components/ui/index.ts";

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

export function AppearancePage({ children }: { children?: ReactNode } = {}) {
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
    <>
      <Toolbar title="设置" subtitle="外观、通知与数据" />
      <Body><Pane width="narrow"><div data-testid="appearance">
        {readNote ? (
          <div className="callout info" role="status" data-testid="appearance-read-note">
            <span>{readNote}</span>
          </div>
        ) : null}

        <div className="setsec">
          <h3>外观</h3>
          <div className="group">
            <div className="row">
              <div className="r-main"><div className="r-title">主题</div><div className="r-sub">选择配色。当前产品验收以「原生」为准。</div></div>
              <div className="r-right">
                <div className="seg" role="radiogroup" aria-label="主题">
                  {THEME_IDS.map((id: ThemeId) => (
                    <label key={id} className={preference.themeId === id ? "sel" : ""}>
                      <input className="sr" type="radio" name="theme" value={id} checked={preference.themeId === id}
                        onChange={() => choose({ ...preference, themeId: id })} />
                      <span>{THEME_LABELS[id]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="row">
              <div className="r-main"><div className="r-title">颜色模式</div><div className="r-sub">跟随系统时，系统切换明暗会立即生效。</div></div>
              <div className="r-right">
                <div className="seg" role="radiogroup" aria-label="颜色模式">
                  {COLOR_MODES.map((id: ColorMode) => (
                    <label key={id} className={preference.colorMode === id ? "sel" : ""}>
                      <input className="sr" type="radio" name="color-mode" value={id} checked={preference.colorMode === id}
                        onChange={() => choose({ ...preference, colorMode: id })} />
                      <span>{MODE_LABELS[id]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="row">
              <div className="r-main"><div className="r-title">当前外观</div><div className="r-sub">外观保存在这台设备的浏览器里，不会上传。</div></div>
              <div className="r-right">
                <span className="small muted" data-testid="appearance-status" role="status" aria-live="polite">
                  {describeAppearance(preference, prefersDark)}
                </span>
              </div>
            </div>
            {save.state === "saved" ? (
              <div className="row"><div className="r-main"><StatusShape tone="ok" label="已保存" /></div></div>
            ) : null}
            {save.state === "saved" ? <span className="sr" data-testid="appearance-save" data-state="saved">已保存。</span> : null}
            {save.state === "failed" ? (
              <div className="row" data-testid="appearance-save-failed">
                <div className="r-main"><div className="r-title">尚未保存</div><div className="r-sub">{save.message}</div></div>
                <div className="r-right"><Button size="sm" onClick={() => persist(preference)}>重试</Button></div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="setsec" data-testid="notification-capability">
          <h3>通知</h3>
          <div className="group">
            <div className="row"><div className="r-main"><div className="r-title">邮件与提醒</div>
              <div className="r-sub">R1 不发送邮件，也不会出现模拟送达。云协作与邮件通知尚未配置，后续版本提供。</div></div>
              <div className="r-right"><span className="tag plain">未开放</span></div></div>
          </div>
        </div>

        <div className="setsec" data-testid="settings-data-privacy">
          <h3>数据与隐私</h3>
          <div className="group">
            <div className="row"><div className="r-main"><div className="r-title">本机存储</div>
              <div className="r-sub">案件与外观偏好保存在这台设备的本机存储中。恢复数据的工具在本页下方。</div></div></div>
            {children ? <div className="row" style={{ alignItems: "flex-start" }}><div className="r-main">{children}</div></div> : null}
          </div>
        </div>

        <div className="setsec" data-testid="settings-legacy">
          <h3>旧版入口</h3>
          <div className="group">
            <div className="row"><div className="r-main"><div className="r-title">切换到旧版</div>
              <div className="r-sub">需要使用旧版工作区时，从这里离开卷宗。</div></div>
              <div className="r-right"><Link className="btn sm" to="/projects">切换到旧版</Link></div></div>
          </div>
        </div>
      </div></Pane></Body>
    </>
  );
}
