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

  return (
    <main className="v6-page" data-testid="inbox-page" data-state={error ? "error" : items === null ? "loading" : "ready"}>
      <h1 className="v6-title">收件箱</h1>
      <p className="muted">待办从案件当前状态派生。已读只记录本人的阅读游标，不会完成业务事项；已解决只由底层条件决定。</p>
      {error ? <div className="notice" role="alert" data-testid="inbox-error"><strong>无法读取待办。</strong><p>{error}</p><button className="btn btn-outline btn-sm" type="button" onClick={() => void refresh(true)}>重试</button></div> : null}
      {items === null && !error && !refreshing ? <div aria-busy="true" data-testid="inbox-loading"><div className="skeleton v6-skeleton" /><div className="skeleton v6-skeleton" /></div> : null}
      {items !== null && refreshing ? <div aria-busy="true" data-testid="inbox-refreshing"><div className="skeleton v6-skeleton" /></div> : null}
      {items !== null && items.length === 0 && !error ? <section className="card v6-empty" data-testid="inbox-empty"><p>暂无待办</p></section> : null}
      {items !== null && items.length > 0 ? GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        return <section className="card" key={group} data-testid={`inbox-group-${group}`}>
          <h2 className="card-title">{group}</h2>
          <ul className="v6-list">{groupItems.map((item) => <InboxRow key={item.id} item={item} busy={busyId === item.id} onRead={() => void markRead(item)} />)}</ul>
        </section>;
      }) : null}
      {lastLoadedAt !== null ? <p className="field-hint">上次读取：{new Date(lastLoadedAt).toLocaleString("zh-CN", { hour12: false })}</p> : null}
    </main>
  );
}

function InboxRow({ item, busy, onRead }: { item: InboxItem; busy: boolean; onRead: () => void }) {
  return <li className="project-row" data-testid={`inbox-item-${item.id}`} data-state={item.state} data-kind={item.kind as InboxKind}>
    <div><Link to={item.actionPath}>{item.title}</Link><div className="muted">{item.state === "resolved" ? "已解决" : "待处理"}{item.dueAt ? ` · ${item.dueAt}` : ""} · 案件 {item.matterId}</div></div>
    {item.readAt === null ? <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onRead}>标记已读</button> : <span className="muted">已读</span>}
  </li>;
}
