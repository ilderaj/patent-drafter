/**
 * The settings route, split into its own chunk. `AppearanceProvider` stays in
 * the root because it applies the saved theme to every page; the recovery
 * panel is only needed on this route.
 *
 * Recovery export needs an explicit source matter. This route lists the local
 * matters once and lets the user choose which one the `.patentpack` covers;
 * the newest matter is selected by default. After a successful import the list
 * is read again so the imported matter can be exported immediately.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppearancePage } from "../features/settings/Appearance.tsx";
import { Recovery } from "../features/recovery/Recovery.tsx";
import { LOCAL_ACTOR } from "./navigation.ts";
import type { Actor, LocalRepository, MatterAggregate } from "../lib/repository.ts";

export interface RecoveryMatterChoice {
  id: string;
  title: string;
  updatedAt: string;
}

/** Project the repository's matter aggregates into selector rows, preserving its newest-first order. */
export function recoveryMatterChoices(items: readonly MatterAggregate[]): RecoveryMatterChoice[] {
  return items.map((item) => ({
    id: item.matter.id,
    title: item.matter.title,
    updatedAt: item.matter.updatedAt,
  }));
}

export function defaultRecoveryMatterId(choices: readonly RecoveryMatterChoice[]): string | null {
  return choices[0]?.id ?? null;
}

function displayUpdatedAt(value: string): string {
  return value.replace("T", " ").slice(0, 16);
}

export interface SettingsRecoveryProps {
  repository: LocalRepository;
  actor: Actor;
  /** Test/embedding seam: show this list before the first background read finishes. */
  initialMatters?: readonly RecoveryMatterChoice[];
  /** Test/embedding seam: start on this matter instead of the newest one. */
  initialSelectedMatterId?: string | null;
}

export function SettingsRecovery(props: SettingsRecoveryProps) {
  const { repository, actor, initialMatters, initialSelectedMatterId } = props;
  const [choices, setChoices] = useState<RecoveryMatterChoice[] | null>(
    initialMatters ? [...initialMatters] : null,
  );
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(() =>
    initialSelectedMatterId !== undefined
      ? initialSelectedMatterId
      : defaultRecoveryMatterId(initialMatters ?? []),
  );
  const [loading, setLoading] = useState(initialMatters === undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Read the actor's identity, not the object: a parent that rebuilds the
  // actor must not restart the list read on every render.
  const actorRef = useRef(actor);
  actorRef.current = actor;

  const reload = useCallback(async (preferMatterId?: string) => {
    setLoading(true);
    const listed = await repository.listMatters(actorRef.current);
    if (!listed.ok) {
      setLoadError(listed.error.message);
      setLoading(false);
      return;
    }
    const next = recoveryMatterChoices(listed.data.items);
    setChoices(next);
    setLoadError(null);
    setLoading(false);
    setSelectedMatterId((current) => {
      const preferred = preferMatterId ?? current;
      return preferred !== null && next.some((choice) => choice.id === preferred)
        ? preferred
        : defaultRecoveryMatterId(next);
    });
  }, [repository, actor.tenantId, actor.userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <section className="setsec" data-testid="settings-recovery-source">
        <h3>本地案件备份</h3>
        <p className="small muted">选择要导出 .patentpack 的本机案件。恢复包在本机加密，不会上传。</p>
        {loadError ? <p role="alert" className="field-hint" data-testid="settings-recovery-matter-error">{loadError}</p> : null}
        {choices !== null && choices.length > 0 ? (
          <label className="field">
            <span className="field-label">导出源案件</span>
            <select
              className="input"
              data-testid="settings-recovery-matter-select"
              value={selectedMatterId ?? ""}
              disabled={loading}
              onChange={(event) => setSelectedMatterId(event.currentTarget.value || null)}
            >
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.title} · 更新于 {displayUpdatedAt(choice.updatedAt)} · {choice.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <span className="field-hint">下方「生成恢复包」只导出当前选中的案件。</span>
          </label>
        ) : choices === null ? (
          <p className="field-hint" data-testid="settings-recovery-loading">正在读取本机案件…</p>
        ) : (
          <p className="field-hint" data-testid="settings-recovery-no-matters">
            当前本机暂无可导出的案件；你仍可在下方选择已有的 .patentpack 恢复包导入恢复。
          </p>
        )}
      </section>
      <Recovery
        repository={repository}
        actor={actor}
        sourceMatterId={selectedMatterId}
        onImported={(matterId) => { void reload(matterId); }}
      />
    </>
  );
}

export default function SettingsPage({ repository }: { repository: LocalRepository }) {
  return (
    <>
      <AppearancePage>
        <SettingsRecovery repository={repository} actor={LOCAL_ACTOR} />
      </AppearancePage>
    </>
  );
}
