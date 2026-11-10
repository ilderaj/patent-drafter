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

import { Body, Pane, Toolbar } from "../../components/ui/index.ts";

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

  const view = <ActivityFeedView
    data={data}
    error={error}
    refreshing={refreshing}
    currentMatterId={currentMatterId}
    onRetry={() => setAttempt((value) => value + 1)}
  />;
  if (currentMatterId !== "") return view;
  return <>
    <Toolbar title="动态" subtitle="跨案件的本机追加记录；不包含草稿正文、密钥或提示词" />
    <Body><Pane>{view}</Pane></Body>
  </>;
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
    matterId: currentMatterId === "" ? null : currentMatterId,
    targetId: "all",
    actorKind: "all",
    actionClass: "all",
    modelOnly: false,
  });
  useEffect(() => {
    setFilters((current) => ({
      ...current,
      matterId: currentMatterId === "" ? null : currentMatterId,
      targetId: "all",
    }));
  }, [currentMatterId]);
  const events = useMemo(() => data === null ? [] : filterActivity(data.events, filters), [data, filters]);
  const matterNames = useMemo(() => new Map((data?.matters ?? []).map((matter) => [matter.id, matter.title])), [data]);
  const targetIds = useMemo(() => [...new Set((data?.events ?? [])
    .filter((event) => filters.matterId === null || event.matterId === filters.matterId)
    .map((event) => event.targetId)
    .filter((id): id is string => id !== null))].sort(), [data, filters.matterId]);
  const actionClasses = useMemo(() => [...new Set((data?.events ?? []).map((event) => event.action.split(".")[0] ?? ""))]
    .filter(Boolean).sort(), [data]);
  const state = data === null ? (error ? "error" : "loading") : error ? "stale" : "ready";

  return <section className={currentMatterId === "" ? "stack-3" : "card stack-3"} data-testid="workbench-activity" data-state={state} aria-busy={refreshing}>
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
          {targetIds.map((id, index) => <option key={id} value={id}>目标 {index + 1}</option>)}
        </select>
      </label>
      <label className="field"><span className="field-label">操作者</span>
        <select className="select" value={filters.actorKind} onChange={(event) => setFilters({ ...filters, actorKind: event.target.value as ActivityFilters["actorKind"] })}>
          <option value="all">全部操作者</option><option value="user">本机用户（自报）</option><option value="worker">worker</option><option value="webhook">webhook</option>
        </select>
      </label>
      <div className="seg" data-testid="activity-action-filter" role="group" aria-label="动作类别">
        {["all", ...actionClasses].map((item) => <button key={item} type="button"
          className={filters.actionClass === item ? "sel" : ""}
          onClick={() => setFilters({ ...filters, actionClass: item })}>{item === "all" ? "全部" : actionClassLabel(item)}</button>)}
      </div>
      <label className="row"><input type="checkbox" checked={filters.modelOnly} onChange={(event) => setFilters({ ...filters, modelOnly: event.target.checked })} />仅显示模型参与</label>
      <button type="button" className="btn btn-outline btn-sm" disabled={refreshing} onClick={onRetry}>刷新动态</button>
    </div> : null}
    {data && events.length === 0 && !error ? <p className="muted" data-testid="workbench-activity-empty">尚无记录</p> : null}
    {events.length > 0 ? <div className="timeline" data-testid="workbench-activity-rows">
      {events.map((event) => <ActivityRow key={event.id} event={event} matterTitle={matterNames.get(event.matterId ?? "") ?? "案件"} />)}
    </div> : null}
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
  return <div className="tl-item" data-testid={`activity-${event.id}`} data-state={outcome} data-action={event.action}>
    <span className={`tl-dot${outcome === "failed" ? " risk" : outcome === "succeeded" ? " ok" : ""}`} aria-hidden="true" />
    <span className="tl-line" aria-hidden="true" />
    <div>
    <div className="row-between" style={{ flexWrap: "wrap" }}>
      <strong>{activityActionLabel(event.action)}</strong>
      <time dateTime={event.occurredAt}>{formatActivityTime(event.occurredAt)}</time>
    </div>
    <div className="field-hint">操作者：{actorLabel(event)} · 案件：{matterTitle} · 目标：{event.targetId === null ? "整个案件" : "目标记录"}</div>
    <div className="field-hint">
      {version !== null ? <span>版本 {version} · </span> : null}
      {revisionId ? <span>有修订记录 · </span> : null}
      {event.snapshot ? <span>配置版本 {event.snapshot.targetConfigVersion} · 输入版本 {event.snapshot.sourceVersion}</span> : null}
      {stage ? <span> · 阶段 {stageLabel(stage)}</span> : null}
    </div>
    {outcome === "failed" ? <p className="badge badge-err">失败</p> : null}
    {hasModel ? <div className="field-hint" data-testid={`activity-model-${event.id}`}>
      模型参与{provider ? ` · 处理方 ${provider}` : ""}{model ? ` · 模型 ${model}` : ""}
    </div> : null}
    <details className="v6-tech-details">
      <summary>技术详情</summary>
      <div>事件：<code>{event.id}</code></div>
      <div>动作：<code>{event.action}</code></div>
      <div>案件 ID：<code>{event.matterId ?? "无"}</code></div>
      {event.targetId ? <div>目标 ID：<code>{event.targetId}</code></div> : null}
      <div>资源 ID：<code>{event.resourceId ?? "无"}</code></div>
      <div>作业 ID：<code>{event.jobId ?? "无"}</code></div>
      <div>操作者 ID：<code>{event.actorId}</code></div>
      {errorCode ? <><div>失败 · {errorCode}</div><div>错误码：<code>{errorCode}</code></div></> : null}
      <div>发生时间：<code>{event.occurredAt}</code></div>
    </details>
    </div>
  </div>;
}

function actionClassLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    matter: "案件", source: "材料", target: "目标", figures: "附图", revision: "修订",
    job: "任务", consent: "外发授权", check: "检查", confirmation: "确认", approval: "批准",
    export: "导出", review: "审阅", receipt: "回执", deadline: "期限", payment: "支付",
    entitlement: "使用权", service: "服务", privacy: "隐私", member: "成员",
  };
  return labels[value] ?? "其他";
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { hour12: false });
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "extract": return "材料提取";
    case "draft": return "起草";
    case "check":
    case "checks": return "检查";
    case "ocr": return "文字识别";
    default: return "其他阶段";
  }
}

function safeMetadataNumber(event: ActivityRecord, key: "version" | "count"): number | null {
  const value = event.metadata[key];
  return typeof value === "number" ? value : null;
}

function safeMetadataString(event: ActivityRecord, key: "stage" | "errorCode" | "provider" | "model"): string | null {
  const value = event.metadata[key];
  return typeof value === "string" ? value : null;
}
