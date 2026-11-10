import { useCallback, useEffect, useState } from "react";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { loadInbox, markInboxItemRead, type InboxGroup, type InboxItem, type InboxKind } from "./inbox.ts";
import { Button, Callout, Icon, StatusShape, Toolbar } from "../../components/ui/index.ts";

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
    <>
      <Toolbar title="收件箱" subtitle={items === null ? "正在读取本机待办" : `${openCount} 项待处理 · 全部 ${items.length} 项`} />
      <div className="work page-work" data-testid="inbox-page" data-state={error ? "error" : items === null ? "loading" : "ready"}>
        <div className="listpane">
          <div className="list-h">待处理 {openCount} 项</div>
          {error ? <div style={{ padding: 12 }}><Callout tone="risk" icon="alert" testId="inbox-error">
            <b>无法读取待办。</b><div>{error}</div>
            <Button size="sm" onClick={() => void refresh(true)}>重试</Button>
          </Callout></div> : null}
          {items === null && !error && !refreshing ? <div aria-busy="true" data-testid="inbox-loading" style={{ padding: 12 }}><div className="skeleton v6-skeleton" /><div className="skeleton v6-skeleton" /></div> : null}
          {items !== null && refreshing ? <div aria-busy="true" data-testid="inbox-refreshing" style={{ padding: 12 }}><div className="skeleton v6-skeleton" /></div> : null}
          {items !== null && items.length === 0 && !error ? <div className="empty" data-testid="inbox-empty"><Icon name="inbox" size="lg" /><h3>暂无待办</h3><p>案件状态变化后，这里会出现需要处理的事项。</p></div> : null}
          {items !== null && items.length > 0 ? GROUPS.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return <section key={group} data-testid={`inbox-group-${group}`}>
              <div className="list-h">{group}</div>
              {groupItems.map((item) => <InboxRow key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />)}
            </section>;
          }) : null}
        </div>
        <div className="detailpane" aria-live="polite" data-testid="inbox-detail">
          {selected ? <div style={{ maxWidth: 640 }}>
            <div className="casehead">
              <h2>{selected.title}</h2>
              <StatusShape tone={selected.state === "resolved" ? "ok" : "warn"} label={selected.state === "resolved" ? "已解决" : "待处理"} />
              <span className={`tag ${selected.readAt === null ? "plain" : ""}`}>{selected.readAt === null ? "未读" : "已读"}</span>
            </div>
            <p className="small muted" style={{ margin: "8px 0 16px", lineHeight: 1.65 }}>
              {selected.state === "resolved" ? "对应业务条件当前已满足。" : "此事项仍待处理；标记已读不会改变处理状态。"}
            </p>
            <Callout tone="warn" icon="alert">
              <b>这只是本机待办。</b>不代表真实期限、审核结果或法律结论；处理去向会打开同一案件与目标。
            </Callout>
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>分组</dt><dd>{selected.group}</dd>
              <dt>目标</dt><dd>{selected.targetId === null ? "整个案件" : "目标记录"}</dd>
              <dt>发生时间</dt><dd>{formatInboxTime(selected.createdAt)}</dd>
              {selected.dueAt ? <><dt>记录日期</dt><dd>{formatInboxTime(selected.dueAt)}</dd></> : null}
            </dl>
            <div className="rowgap" style={{ marginTop: 16, flexWrap: "wrap" }}>
              <Button variant="primary" size="sm" to={selected.actionPath}>查看并处理</Button>
              {selected.readAt === null ? <Button size="sm" disabled={busyId === selected.id} onClick={() => void markRead(selected)}>
                {busyId === selected.id ? "正在保存…" : "标记已读"}
              </Button> : <span className="field-hint">已记录为已读</span>}
            </div>
            <details className="v6-tech-details" style={{ marginTop: 16 }}>
              <summary>技术标识</summary>
              <div>案件 ID：<code>{selected.matterId}</code></div>
              {selected.targetId ? <div>目标 ID：<code>{selected.targetId}</code></div> : null}
              <div>资源 ID：<code>{selected.resourceId}</code></div>
              <div>动作类型：<code>{selected.actionKind}</code></div>
            </details>
            {lastLoadedAt !== null ? <p className="field-hint">上次读取：{new Date(lastLoadedAt).toLocaleString("zh-CN", { hour12: false })}</p> : null}
          </div> : <div className="empty"><Icon name="inbox" size="lg" /><h3>选择一项待办</h3></div>}
        </div>
      </div>
    </>
  );
}

function InboxRow({ item, selected, onSelect }: { item: InboxItem; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={`inbox-item${selected ? " sel" : ""}`} aria-current={selected ? "true" : undefined}
    data-testid={`inbox-item-${item.id}`} data-state={item.state} data-kind={item.kind as InboxKind} onClick={onSelect}>
    <span className="ii-t"><StatusShape tone={item.state === "resolved" ? "ok" : "warn"} /> {item.title}</span>
    <span className="ii-d" style={{ display: "block" }}>{item.state === "resolved" ? "已解决" : "待处理"} · {item.readAt === null ? "未读" : "已读"}{item.dueAt ? ` · ${formatInboxTime(item.dueAt)}` : ""}</span>
  </button>;
}

function formatInboxTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日期未知" : date.toLocaleString("zh-CN", { hour12: false });
}
