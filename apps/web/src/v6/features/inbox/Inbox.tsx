import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { loadInbox, markInboxItemRead, type InboxGroup, type InboxItem, type InboxKind } from "./inbox.ts";

export interface InboxPageProps {
  repository: LocalRepository;
  actor: Actor;
  /** Optional preloaded items for hosts that already performed the read. */
  initialItems?: readonly InboxItem[] | null;
  initialLoadError?: string | null;
}

const GROUPS: readonly InboxGroup[] = ["期限", "审阅", "事实与确认", "检查", "任务", "服务"];
/** How often a mounted inbox re-derives items; S06's 60 s staleness rule is checked per tick. */
const INBOX_REFRESH_CHECK_MS = 15_000;
const INBOX_STALE_AFTER_MS = 60_000;

export function InboxPage({ repository, actor, initialItems = null, initialLoadError = null }: InboxPageProps) {
  const [items, setItems] = useState<readonly InboxItem[] | null>(initialItems);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(initialItems === null ? null : Date.now());
  const [error, setError] = useState<string | null>(initialLoadError);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async (retain = true) => {
    if (!retain) setItems(null);
    setRefreshing(true);
    setError(null);
    const result = await loadInbox(repository, actor);
    setRefreshing(false);
    if (!result.ok) {
      setError(result.error.code === "RESOURCE_NOT_FOUND" ? "案件不可用。" : "无法读取待办。已保留上次读取的结果（如有）。请重试。");
      return;
    }
    setItems(result.data.items);
    setLastLoadedAt(result.data.loadedAt);
  }, [actor, repository]);

  useEffect(() => { if (items === null) void refresh(false); }, [refresh]);
  useEffect(() => {
    const onFocus = () => void refresh(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (lastLoadedAt === null || Date.now() - lastLoadedAt > INBOX_STALE_AFTER_MS) void refresh(true);
    }, INBOX_REFRESH_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [lastLoadedAt, refresh]);

  const markRead = async (item: InboxItem) => {
    if (item.readAt !== null) return;
    setBusyId(item.id);
    const result = await markInboxItemRead(repository, actor, item.matterId, item.id, new Date().toISOString());
    setBusyId(null);
    if (!result.ok) {
      setError(result.error.code === "RESOURCE_NOT_FOUND" ? "案件不可用。" : "无法保存已读标记，请重试。");
      return;
    }
    await refresh(true);
  };

  const selected = items?.find((item) => item.id === selectedId) ?? items?.[0] ?? null;
  const openCount = items?.filter((item) => item.state === "open").length ?? 0;

  return (
    <main className="v6-page v6-inbox-page" data-testid="inbox-page" data-state={error ? "error" : items === null ? "loading" : "ready"}>
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <h1 className="v6-title">收件箱</h1>
        {items ? <span className="field-hint">待处理 {openCount} 项 · 全部 {items.length} 项</span> : null}
      </div>
      <p className="muted">待办从案件当前状态派生。已读只记录本人的阅读游标，不会完成业务事项；已解决状态由底层条件决定。</p>
      {error ? <div className="notice" role="alert" data-testid="inbox-error"><strong>无法读取待办。</strong><p>{error}</p><button className="btn btn-outline btn-sm" type="button" onClick={() => void refresh(true)}>重试</button></div> : null}
      {items === null && !error && !refreshing ? <div aria-busy="true" data-testid="inbox-loading"><div className="skeleton v6-skeleton" /><div className="skeleton v6-skeleton" /></div> : null}
      {items !== null && refreshing ? <div aria-busy="true" data-testid="inbox-refreshing"><div className="skeleton v6-skeleton" /></div> : null}
      {items !== null && items.length === 0 && !error ? <section className="card v6-empty" data-testid="inbox-empty"><p>暂无待办</p></section> : null}
      {items !== null && items.length > 0 ? <div className="v6-inbox-layout" data-testid="inbox-layout">
        <aside className="v6-inbox-list" aria-label="待办列表">
          <div className="v6-inbox-list-heading">选择一项查看详情</div>
          {GROUPS.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return <section key={group} data-testid={`inbox-group-${group}`}>
              <h2 className="v6-inbox-group-heading">{group}</h2>
              {groupItems.map((item) => <InboxRow key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />)}
            </section>;
          })}
        </aside>
        <section className="v6-inbox-detail" aria-live="polite" data-testid="inbox-detail">
          {selected ? <div className="v6-inbox-detail-inner">
            <div className="row" style={{ flexWrap: "wrap" }}>
              <span className={selected.state === "resolved" ? "badge badge-ok" : "badge badge-warn"}>{selected.state === "resolved" ? "已解决" : "待处理"}</span>
              <span className="badge badge-outline">{selected.readAt === null ? "未读" : "已读"}</span>
              <span className="muted">{selected.group}</span>
            </div>
            <h2 style={{ marginTop: 12 }}>{selected.title}</h2>
            <p className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
              {selected.state === "resolved" ? "对应业务条件当前已满足。" : "此事项仍待处理；标记已读不会改变处理状态。"}
            </p>
            <dl className="v6-overview" style={{ marginTop: 16 }}>
              <dt>案件</dt><dd>本机案件</dd>
              <dt>目标</dt><dd>{selected.targetId === null ? "整个案件" : "目标记录"}</dd>
              <dt>发生时间</dt><dd>{formatInboxTime(selected.createdAt)}</dd>
              {selected.dueAt ? <><dt>记录日期</dt><dd>{formatInboxTime(selected.dueAt)}</dd></> : null}
            </dl>
            <div className="v6-inbox-actions">
              <Link className="btn btn-default btn-sm" to={selected.actionPath}>查看并处理</Link>
              {selected.readAt === null ? <button type="button" className="btn btn-outline btn-sm" disabled={busyId === selected.id} onClick={() => void markRead(selected)}>
                {busyId === selected.id ? "正在保存…" : "标记已读"}
              </button> : <span className="field-hint">已记录为已读</span>}
            </div>
            <details className="v6-tech-details" style={{ marginTop: 16 }}>
              <summary>技术标识</summary>
              <div>案件 ID：<code>{selected.matterId}</code></div>
              {selected.targetId ? <div>目标 ID：<code>{selected.targetId}</code></div> : null}
              <div>资源 ID：<code>{selected.resourceId}</code></div>
              <div>动作类型：<code>{selected.actionKind}</code></div>
            </details>
          </div> : null}
        </section>
      </div> : null}
      {lastLoadedAt !== null ? <p className="field-hint">上次读取：{new Date(lastLoadedAt).toLocaleString("zh-CN", { hour12: false })}</p> : null}
    </main>
  );
}

function InboxRow({ item, selected, onSelect }: { item: InboxItem; selected: boolean; onSelect: () => void }) {
  return <button type="button" className="v6-inbox-item" aria-current={selected ? "true" : undefined}
    data-testid={`inbox-item-${item.id}`} data-state={item.state} data-kind={item.kind as InboxKind} onClick={onSelect}>
    <span className="v6-inbox-item-title">{item.state === "open" ? "○ " : "✓ "}{item.title}</span>
    <span className="v6-inbox-item-meta">{item.state === "resolved" ? "已解决" : "待处理"} · {item.readAt === null ? "未读" : "已读"}{item.dueAt ? ` · ${formatInboxTime(item.dueAt)}` : ""}</span>
  </button>;
}

function formatInboxTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日期未知" : date.toLocaleString("zh-CN", { hour12: false });
}
