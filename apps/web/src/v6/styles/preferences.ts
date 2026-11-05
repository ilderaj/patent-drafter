/**
 * V6-09 — the appearance preference (S01 主题与设置, 05-contracts `Preference`).
 *
 * R1 keeps the preference in localStorage. This module is the whole domain:
 * validate, read, save, resolve and describe. It takes the storage, the
 * document root and the system media query as parameters, so the React panel,
 * the browser run and the Node scenarios all cross the same interface, and
 * every decision can be tested without a browser.
 *
 * Stored shape (one key, versioned):
 *   { "version": 1, "themeId": "native", "colorMode": "system" }
 * A record of another version, a malformed field or unparseable JSON is
 * `invalid`: the defaults apply and the caller tells the user. A storage that
 * throws is `unavailable`. Reads never write; writes never merge unknown
 * fields, so a tampered object cannot smuggle data into the preference.
 */

export const APPEARANCE_STORAGE_KEY = "patent-drafter.v6.appearance";
export const APPEARANCE_VERSION = 1;

export type ThemeId = "native" | "graphite" | "cyan" | "celadon";
export type ColorMode = "system" | "light" | "dark";
export type ResolvedMode = "light" | "dark";

export interface AppearancePreference {
  themeId: ThemeId;
  colorMode: ColorMode;
}

/** The subset of `Storage` this module needs; a test fake or `null` fits too. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The subset of `MediaQueryList` used for `prefers-color-scheme`. */
export interface MediaQueryLike {
  matches: boolean;
  addEventListener?(type: "change", listener: (event: { matches: boolean }) => void): void;
  removeEventListener?(type: "change", listener: (event: { matches: boolean }) => void): void;
  addListener?(listener: (event: { matches: boolean }) => void): void;
  removeListener?(listener: (event: { matches: boolean }) => void): void;
}

/** `document.documentElement`-like target; a plain `{ dataset: {} }` fits too. */
export interface AppearanceTarget {
  dataset: Record<string, string | undefined>;
}

export const THEME_IDS: readonly ThemeId[] = Object.freeze(["native", "graphite", "cyan", "celadon"]);
export const COLOR_MODES: readonly ColorMode[] = Object.freeze(["system", "light", "dark"]);

/** Labels from the v5 theme picker (review.html: 石墨/晒图/青瓷/原生). */
export const THEME_LABELS: Readonly<Record<ThemeId, string>> = Object.freeze({
  native: "原生",
  graphite: "石墨",
  cyan: "晒图",
  celadon: "青瓷",
});

export const MODE_LABELS: Readonly<Record<ColorMode, string>> = Object.freeze({
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
});

/** 05-contracts default: native/system. Frozen; callers copy before changing. */
export const DEFAULT_APPEARANCE: Readonly<AppearancePreference> = Object.freeze({
  themeId: "native",
  colorMode: "system",
});

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === "string" && (COLOR_MODES as readonly string[]).includes(value);
}

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isThemeId(record.themeId) && isColorMode(record.colorMode);
}

function defaultPreference(): AppearancePreference {
  return { themeId: DEFAULT_APPEARANCE.themeId, colorMode: DEFAULT_APPEARANCE.colorMode };
}

/**
 * Coerce an untrusted object to an appearance preference. Each field falls
 * back to its default on its own, so a partial record (for example a future
 * writer that stored only the theme) still yields a usable preference.
 */
export function parseAppearance(value: unknown): AppearancePreference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return defaultPreference();
  const record = value as Record<string, unknown>;
  return {
    themeId: isThemeId(record.themeId) ? record.themeId : DEFAULT_APPEARANCE.themeId,
    colorMode: isColorMode(record.colorMode) ? record.colorMode : DEFAULT_APPEARANCE.colorMode,
  };
}

export type AppearanceReadState = "stored" | "default" | "invalid" | "unavailable";

export interface AppearanceRead {
  state: AppearanceReadState;
  preference: AppearancePreference;
}

/** Read the stored preference. Never throws, never writes. */
export function readAppearance(storage: PreferenceStorage | null | undefined): AppearanceRead {
  if (!storage) return { state: "unavailable", preference: defaultPreference() };

  let raw: string | null;
  try {
    raw = storage.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    return { state: "unavailable", preference: defaultPreference() };
  }
  if (raw === null) return { state: "default", preference: defaultPreference() };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "invalid", preference: defaultPreference() };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { state: "invalid", preference: defaultPreference() };
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== APPEARANCE_VERSION) {
    return { state: "invalid", preference: defaultPreference() };
  }
  if (!isThemeId(record.themeId) || !isColorMode(record.colorMode)) {
    return { state: "invalid", preference: defaultPreference() };
  }
  return { state: "stored", preference: { themeId: record.themeId, colorMode: record.colorMode } };
}

export type AppearanceSaveCode = "STORAGE_UNAVAILABLE" | "INVALID_INPUT";

export type AppearanceSave =
  | { ok: true }
  | { ok: false; code: AppearanceSaveCode; message: string };

/** Static text: a storage exception message never reaches the user. */
export const APPEARANCE_SAVE_FAILED = "本机存储暂时不可写，外观没有保存。请稍后重试。";
export const APPEARANCE_INVALID = "外观设置不完整，尚未保存。";

/**
 * Write exactly the three known fields. The same preference always produces
 * the same stored string, so a retry cannot add a second record or reorder
 * anything. Unknown input is refused before touching storage.
 */
export function saveAppearance(
  storage: PreferenceStorage | null | undefined,
  preference: AppearancePreference,
): AppearanceSave {
  if (!isAppearancePreference(preference)) {
    return { ok: false, code: "INVALID_INPUT", message: APPEARANCE_INVALID };
  }
  if (!storage) {
    return { ok: false, code: "STORAGE_UNAVAILABLE", message: APPEARANCE_SAVE_FAILED };
  }
  const value = JSON.stringify({
    version: APPEARANCE_VERSION,
    themeId: preference.themeId,
    colorMode: preference.colorMode,
  });
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, value);
  } catch {
    return { ok: false, code: "STORAGE_UNAVAILABLE", message: APPEARANCE_SAVE_FAILED };
  }
  return { ok: true };
}

/** `system` follows the OS; an explicit light/dark ignores it (S01). */
export function resolveColorMode(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): ResolvedMode {
  if (preference.colorMode === "system") return systemPrefersDark ? "dark" : "light";
  return preference.colorMode;
}

/** The two attributes the theme stylesheet reads on `<html>`. */
export function appearanceAttributes(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): { "data-theme": ThemeId; "data-mode": ResolvedMode } {
  return {
    "data-theme": preference.themeId,
    "data-mode": resolveColorMode(preference, systemPrefersDark),
  };
}

/** Apply the attributes through the shared target interface (pure in tests). */
export function applyAppearance(
  target: AppearanceTarget,
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): void {
  const attributes = appearanceAttributes(preference, systemPrefersDark);
  target.dataset.theme = attributes["data-theme"];
  target.dataset.mode = attributes["data-mode"];
}

/** Text the panel shows, so the current state is readable without colour. */
export function describeAppearance(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): string {
  const theme = THEME_LABELS[preference.themeId];
  if (preference.colorMode !== "system") {
    return `${theme} · ${MODE_LABELS[preference.colorMode]}`;
  }
  const resolved = resolveColorMode(preference, systemPrefersDark);
  return `${theme} · 跟随系统（当前${resolved === "dark" ? "深色" : "浅色"}）`;
}

export function systemPrefersDark(media: MediaQueryLike | null | undefined): boolean {
  return media?.matches === true;
}

/**
 * Subscribe to OS light/dark changes and return the unsubscribe function.
 * Uses `addEventListener` when present and falls back to the legacy
 * `addListener` (older Safari) — never both.
 */
export function watchSystemColorMode(
  media: MediaQueryLike | null | undefined,
  listener: (prefersDark: boolean) => void,
): () => void {
  if (!media) return () => {};
  if (typeof media.addEventListener === "function") {
    const handler = (event: { matches: boolean }) => listener(event.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener?.("change", handler);
  }
  if (typeof media.addListener === "function") {
    const handler = (event: { matches: boolean }) => listener(event.matches);
    media.addListener(handler);
    return () => media.removeListener?.(handler);
  }
  return () => {};
}
