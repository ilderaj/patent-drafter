import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Actor, ActivityRecord, LocalRepository } from "../../lib/repository.ts";
import {
  activityActionLabel,
  activityOutcome,
  actorLabel,
  filterActivity,
  hasModelParticipation,
  loadActivityFeed,
  type ActivityFeedData,
  type ActivityFilters,
} from "./workbench.ts";

const REFRESH_CHECK_MS = 15_000;
const STALE_AFTER_MS = 60_000;

export interface ActivityFeedProps {
  repository: LocalRepository;
  actor: Actor;
  currentMatterId: string;
}

/** Activity reads are append-only repository events; this component creates none. */
export function ActivityFeed({ repository, actor, currentMatterId }: ActivityFeedProps) {
  const [data, setData] = useState<ActivityFeedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const result = await loadActivityFeed(repository, actor);
    setRefreshing(false);
    if (!result.ok) {
      setError(result.error.code === "RESOURCE_NOT_FOUND" ? "案件不可用。" : "无法读取动态。上次读取的记录仍保留；请重试。");
      return;
    }
    setData(result.data);
    setError(null);
  }, [actor, repository]);

  useEffect(() => { void refresh(); }, [refresh, attempt]);
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (data === null || Date.now() - data.loadedAt > STALE_AFTER_MS) void refresh();
    }, REFRESH_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [data, refresh]);

  return <ActivityFeedView
    data={data}
    error={error}
    refreshing={refreshing}
    currentMatterId={currentMatterId}
    onRetry={() => setAttempt((value) => value + 1)}
  />;
}

export interface ActivityFeedViewProps {
  data: ActivityFeedData | null;
  error: string | null;
  refreshing: boolean;
  currentMatterId: string;
  onRetry: () => void;
}

/** Presentational feed interface for review and server-rendered scenario checks. */
export function ActivityFeedView({ data, error, refreshing, currentMatterId, onRetry }: ActivityFeedViewProps) {
  const [filters, setFilters] = useState<ActivityFilters>({
    matterId: currentMatterId,
    targetId: "all",
    actorKind: "all",
    actionClass: "all",
    modelOnly: false,
  });
  const events = useMemo(() => data === null ? [] : filterActivity(data.events, filters), [data, filters]);
  const matterNames = useMemo(() => new Map((data?.matters ?? []).map((matter) => [matter.id, matter.title])), [data]);
  const targetIds = useMemo(() => [...new Set((data?.events ?? [])
    .filter((event) => filters.matterId === null || event.matterId === filters.matterId)
    .map((event) => event.targetId)
    .filter((id): id is string => id !== null))].sort(), [data, filters.matterId]);
  const actionClasses = useMemo(() => [...new Set((data?.events ?? []).map((event) => event.action.split(".")[0] ?? ""))]
    .filter(Boolean).sort(), [data]);
  const state = data === null ? (error ? "error" : "loading") : error ? "stale" : "ready";

  return <section className="card stack-3" data-testid="workbench-activity" data-state={state} aria-busy={refreshing}>
    <div className="row-between" style={{ flexWrap: "wrap" }}>
      <h2 className="card-title">案件动态</h2>
      {data ? <span className="field-hint">按发生时间倒序 · {data.events.length} 条</span> : null}
    </div>
    <p className="muted">动态来自本机保存的追加记录。此列表不包含草稿正文、密钥或提示词。</p>
    {error ? <div className="notice" role="alert" data-testid="workbench-activity-error">
      <p>{error}</p><button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>重试</button>
    </div> : null}
    {data === null && !error ? <div aria-busy="true" data-testid="workbench-activity-loading">
      <div className="skeleton v6-skeleton" /><div className="skeleton v6-skeleton" />
    </div> : null}
    {data ? <div className="row" style={{ flexWrap: "wrap", alignItems: "end" }} data-testid="activity-filters">
      <label className="field"><span className="field-label">案件</span>
        <select className="select" value={filters.matterId ?? "all"} onChange={(event) => setFilters({ ...filters, matterId: event.target.value === "all" ? null : event.target.value, targetId: "all" })}>
          <option value="all">全部可访问案件</option>
          {data.matters.map((matter) => <option key={matter.id} value={matter.id}>{matter.title}</option>)}
        </select>
      </label>
      <label className="field"><span className="field-label">目标</span>
        <select className="select" value={filters.targetId === "all" ? "all" : filters.targetId === null ? "matter" : filters.targetId}
          onChange={(event) => setFilters({ ...filters, targetId: event.target.value === "all" ? "all" : event.target.value === "matter" ? null : event.target.value })}>
          <option value="all">全部目标</option><option value="matter">整个案件</option>
          {targetIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <label className="field"><span className="field-label">操作者</span>
        <select className="select" value={filters.actorKind} onChange={(event) => setFilters({ ...filters, actorKind: event.target.value as ActivityFilters["actorKind"] })}>
          <option value="all">全部操作者</option><option value="user">本机用户（自报）</option><option value="worker">worker</option><option value="webhook">webhook</option>
        </select>
      </label>
      <label className="field"><span className="field-label">动作类别</span>
        <select className="select" value={filters.actionClass} onChange={(event) => setFilters({ ...filters, actionClass: event.target.value })}>
          <option value="all">全部类别</option>{actionClasses.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label className="row"><input type="checkbox" checked={filters.modelOnly} onChange={(event) => setFilters({ ...filters, modelOnly: event.target.checked })} />仅显示模型参与</label>
      <button type="button" className="btn btn-outline btn-sm" disabled={refreshing} onClick={onRetry}>刷新动态</button>
    </div> : null}
    {data && events.length === 0 && !error ? <p className="muted" data-testid="workbench-activity-empty">尚无记录</p> : null}
    {events.length > 0 ? <ol className="v6-list" data-testid="workbench-activity-rows">
      {events.map((event) => <ActivityRow key={event.id} event={event} matterTitle={matterNames.get(event.matterId ?? "") ?? "案件"} />)}
    </ol> : null}
    {data ? <p className="field-hint">上次读取：{new Date(data.loadedAt).toLocaleString("zh-CN", { hour12: false })}</p> : null}
  </section>;
}

function ActivityRow({ event, matterTitle }: { event: ActivityRecord; matterTitle: string }) {
  const outcome = activityOutcome(event);
  const revisionId = event.snapshot?.draftRevisionId ?? null;
  const version = safeMetadataNumber(event, "version");
  const stage = safeMetadataString(event, "stage");
  const errorCode = safeMetadataString(event, "errorCode");
  const provider = safeMetadataString(event, "provider");
  const model = safeMetadataString(event, "model");
  const hasModel = hasModelParticipation(event);
  return <li className="v6-entry stack-2" data-testid={`activity-${event.id}`} data-state={outcome} data-action={event.action}>
    <div className="row-between" style={{ flexWrap: "wrap" }}>
      <strong>{activityActionLabel(event.action)}</strong>
      <time dateTime={event.occurredAt}>{event.occurredAt}</time>
    </div>
    <div className="field-hint">操作者：{actorLabel(event)} · 案件：{matterTitle} · 目标：{event.targetId ?? "整个案件"}</div>
    <div className="field-hint">
      {version !== null ? <span>版本 {version} · </span> : null}
      {revisionId ? <span>修订 {revisionId} · </span> : null}
      {event.snapshot ? <span>配置 v{event.snapshot.targetConfigVersion} · 输入 v{event.snapshot.sourceVersion}</span> : null}
      {stage ? <span> · 阶段 {stage}</span> : null}
    </div>
    {outcome === "failed" ? <p className="badge badge-err">失败{errorCode ? ` · ${errorCode}` : ""}</p> : null}
    {hasModel ? <div className="field-hint" data-testid={`activity-model-${event.id}`}>
      模型参与{event.jobId ? ` · job ${event.jobId}` : ""}{provider ? ` · 处理方 ${provider}` : ""}{model ? ` · 模型 ${model}` : ""}
    </div> : null}
  </li>;
}

function safeMetadataNumber(event: ActivityRecord, key: "version" | "count"): number | null {
  const value = event.metadata[key];
  return typeof value === "number" ? value : null;
}

function safeMetadataString(event: ActivityRecord, key: "stage" | "errorCode" | "provider" | "model"): string | null {
  const value = event.metadata[key];
  return typeof value === "string" ? value : null;
}
