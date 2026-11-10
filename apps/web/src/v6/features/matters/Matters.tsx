import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import {
  archiveMatter,
  createMatter,
  filterAndPaginateMatterRows,
  listMatterRows,
  renameMatter,
  shouldRefreshMatterRows,
  unarchiveMatter,
} from "./matters.ts";
import type { MatterFilters, MatterListRow, MatterRoute, MatterTargetRow } from "./matters.ts";
import type { NextActionKind } from "./actions.ts";
import { v6Path, type MatterTab } from "../../routes/navigation.ts";

export interface MattersPageProps {
  repository: LocalRepository;
  actor: Actor;
  onCreate?: (matterId: string) => void;
  onOpenUpload?: (matterId: string) => void;
  /** Optional preloaded view for mounting hosts that already performed the read. */
  initialRows?: readonly MatterListRow[] | null;
  initialLoadError?: string | null;
}

export function MattersPage({ repository, actor, onCreate, onOpenUpload, initialRows = null, initialLoadError = null }: MattersPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState<readonly MatterListRow[] | null>(initialRows);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(initialRows === null ? null : Date.now());
  const [error, setError] = useState<string | null>(initialLoadError);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<MatterFilters>({ status: "active", page: 1 });
  const [titleEdit, setTitleEdit] = useState<{ id: string; title: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(async (retain = true) => {
    if (!retain) setRows(null);
    setBusy(true);
    setError(null);
    const result = await listMatterRows(repository, actor);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.code === "STORAGE_UNAVAILABLE" || result.error.code === "QUOTA_EXCEEDED"
        ? "无法读取案件列表；已保留上次读取的结果（如有）。"
        : result.error.code === "RESOURCE_NOT_FOUND" ? "案件不可用。" : "无法读取案件列表。请重试。");
      return;
    }
    setRows(result.data.rows);
    setLastLoadedAt(result.data.loadedAt);
  }, [actor, repository]);

  useEffect(() => {
    if (location.pathname === "/v6/matters") {
      setRows(null);
      void refresh(false);
    }
  }, [location.pathname, refresh]);
  useEffect(() => {
    const onFocus = () => {
      if (shouldRefreshMatterRows(lastLoadedAt, Date.now(), true)) void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [lastLoadedAt, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (shouldRefreshMatterRows(lastLoadedAt, Date.now())) void refresh(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [lastLoadedAt, refresh]);

  const filtered = rows === null ? null : filterAndPaginateMatterRows(rows, filters);
  const create = async () => {
    const matterId = globalThis.crypto.randomUUID();
    const result = await createMatter(repository, actor, {
      matterId,
      eventId: globalThis.crypto.randomUUID(),
      requestId: globalThis.crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    if (!result.ok) {
      setError(result.error.code === "INVALID_TRANSITION" ? "案件已归档，只读。请先取消归档。" : "案件尚未创建。请重试。");
      return;
    }
    await refresh();
    if (onCreate) onCreate(matterId);
    else if (onOpenUpload) onOpenUpload(matterId);
    else navigate(`/v6/matters/${encodeURIComponent(matterId)}/overview`);
  };

  const startFromUpload = async () => {
    if (busy) return;
    const matterId = globalThis.crypto.randomUUID();
    const result = await createMatter(repository, actor, {
      matterId,
      eventId: globalThis.crypto.randomUUID(),
      requestId: globalThis.crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    if (!result.ok) {
      setError("案件尚未创建。请重试。");
      return;
    }
    await refresh();
    if (onOpenUpload) onOpenUpload(matterId);
    else navigate(`/v6/matters/${encodeURIComponent(matterId)}/upload`);
  };

  const saveTitle = async () => {
    if (!titleEdit) return;
    const row = rows?.find((candidate) => candidate.matter.id === titleEdit.id);
    if (!row) return;
    const result = await renameMatter(repository, actor, {
      matterId: row.matter.id,
      expectedVersion: row.matter.version,
      eventId: globalThis.crypto.randomUUID(),
      requestId: globalThis.crypto.randomUUID(),
      now: new Date().toISOString(),
      title: titleEdit.title,
    });
    if (!result.ok) {
      setError(result.error.code === "INVALID_TRANSITION" ? "案件已归档，只读。可取消归档后再保存。" : "标题尚未保存。请重试。");
      return;
    }
    setTitleEdit(null);
    await refresh();
  };

  const transition = async (row: MatterListRow, operation: "archive" | "unarchive") => {
    const command = {
      matterId: row.matter.id,
      expectedVersion: row.matter.version,
      eventId: globalThis.crypto.randomUUID(),
      requestId: globalThis.crypto.randomUUID(),
      now: new Date().toISOString(),
    };
    const result = operation === "archive"
      ? await archiveMatter(repository, actor, command)
      : await unarchiveMatter(repository, actor, command);
    if (!result.ok) {
      setError(`案件状态未更改（${result.error.code}）：${result.error.message}`);
      return;
    }
    setError(null);
    setNotice(operation === "archive" ? "案件已归档。" : "案件已取消归档，现可继续编辑。");
    await refresh();
  };

  return (
    <main className="v6-page" data-testid="matters-page" data-state={rows === null ? "loading" : error ? "error" : "ready"}>
      <div className="row-between">
        <h1 className="v6-title">案件</h1>
        <button type="button" className="btn btn-default btn-sm" disabled={busy} onClick={() => void create()}>创建案件</button>
      </div>
      <p className="muted">案件列表以本机保存的案件状态为准。超过 60 秒或窗口重新获得焦点时会刷新。</p>
      {notice ? <div role="status" className="notice">{notice}</div> : null}
      {error ? <div role="alert" className="notice" data-testid="matters-error"><strong>无法读取或保存。</strong><p>{error}</p><button className="btn btn-outline btn-sm" type="button" onClick={() => void refresh(true)}>重试</button></div> : null}
      <div className="v6-matters-filters">
        <label>状态 <select value={filters.status ?? "active"} onChange={(event) => setFilters({ ...filters, status: event.target.value as MatterFilters["status"], page: 1 })}>
          <option value="active">进行中</option><option value="archived">已归档</option><option value="all">全部</option>
        </select></label>
        <label>路线 <select value={filters.route ?? ""} onChange={(event) => setFilters({ ...filters, route: (event.target.value || null) as MatterRoute | null, page: 1 })}>
          <option value="">全部路线</option><option value="cn_um">中国实用新型</option><option value="cn_invention">中国发明</option><option value="us_nonprovisional">美国非临时申请</option><option value="pct">PCT 国际申请</option>
        </select></label>
        <label>下一步 <select value={filters.nextAction ?? ""} onChange={(event) => setFilters({ ...filters, nextAction: (event.target.value || null) as MatterFilters["nextAction"], page: 1 })}>
          <option value="">全部动作</option>{NEXT_ACTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>标题 <input type="search" value={filters.title ?? ""} onChange={(event) => setFilters({ ...filters, title: event.target.value, page: 1 })} placeholder="只搜索案件标题" /></label>
      </div>
      {rows === null && !error ? <div aria-busy="true" data-testid="matters-loading"><div className="skeleton v6-skeleton" /><div className="skeleton v6-skeleton" /></div> : null}
      {rows !== null && busy ? <div aria-busy="true" data-testid="matters-refreshing"><div className="skeleton v6-skeleton" /></div> : null}
      {rows !== null && filtered?.total === 0 && !error ? (rows.length === 0 ? <section className="card v6-empty" data-testid="matters-empty">
        <p>还没有案件。</p>
        <div className="v6-empty-actions"><button type="button" className="btn btn-default" disabled={busy} onClick={() => void create()}>创建案件</button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void startFromUpload()}>从上传材料开始</button></div>
      </section> : <section className="card v6-empty" data-testid="matters-filter-empty"><p>没有符合筛选条件的案件。</p></section>) : null}
      {rows !== null && filtered && filtered.total > 0 ? <>
        <div className="v6-matters-table-wrap"><table className="v6-matters-table" data-testid="matters-list">
          <thead><tr><th>标题</th><th>路线与状态</th><th>下一步</th><th>最近更新</th><th>创建人</th><th>操作</th></tr></thead>
          <tbody>{filtered.items.map((row) => {
            const actionTab = matterActionTab(row.nextAction);
            const actionTarget = row.targets.find((target) => target.status === "active") ?? row.targets[0] ?? null;
            return <tr key={row.matter.id} data-testid={`matter-row-${row.matter.id}`}>
              <td className="v6-matter-title-cell">{titleEdit?.id === row.matter.id ? <><input aria-label="案件标题" value={titleEdit.title} onChange={(event) => setTitleEdit({ ...titleEdit, title: event.target.value })} /><button type="button" onClick={() => void saveTitle()}>保存</button><button type="button" onClick={() => setTitleEdit(null)}>取消</button></> : <><Link to={v6Path({ kind: "matter", matterId: row.matter.id, targetId: null, tab: "overview" })}>{row.matter.title}</Link>{row.matter.status === "active" ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTitleEdit({ id: row.matter.id, title: row.matter.title })}>重命名</button> : <span className="muted">已归档，只读</span>}</>}
                <details className="v6-tech-details"><summary>案件 ID</summary><code>{row.matter.id}</code></details>
              </td>
              <td><div className="v6-matter-route-list">{row.targets.length ? row.targets.map((target) => <TargetLabel key={target.id} target={target} />) : <span className="muted">尚无目标</span>}</div></td>
              <td>{actionTab ? <Link to={v6Path({ kind: "matter", matterId: row.matter.id, targetId: actionTarget?.id ?? null, tab: actionTab })}>{matterActionLabel(row.nextAction)}</Link> : <span>{matterActionLabel(row.nextAction)}</span>}</td>
              <td><time dateTime={row.matter.updatedAt}>{formatMatterTime(row.matter.updatedAt)}</time></td>
              <td>本机用户<details className="v6-tech-details"><summary>创建人 ID</summary><code>{row.matter.createdBy}</code></details></td>
              <td>{row.matter.status === "archived" ? <button type="button" className="btn btn-outline btn-sm" onClick={() => void transition(row, "unarchive")}>取消归档</button> : <button type="button" className="btn btn-outline btn-sm" onClick={() => void transition(row, "archive")}>归档</button>}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="row-between"><span>共 {filtered.total} 个案件 · 第 {filtered.page} 页</span><div><button type="button" className="btn btn-outline btn-sm" disabled={filtered.page <= 1} onClick={() => setFilters({ ...filters, page: filtered.page - 1 })}>上一页</button> <button type="button" className="btn btn-outline btn-sm" disabled={filtered.page * filtered.pageSize >= filtered.total} onClick={() => setFilters({ ...filters, page: filtered.page + 1 })}>下一页</button></div></div>
      </> : null}
    </main>
  );
}

function TargetLabel({ target }: { target: MatterTargetRow }) {
  return <div>{matterRouteLabel(target.route)} · {target.status === "active" ? "进行中" : "已归档"}<details className="v6-tech-details"><summary>目标 ID</summary><code>{target.id}</code></details></div>;
}

const NEXT_ACTION_OPTIONS: readonly (readonly [NextActionKind, string])[] = [
  ["add_sources", "补充材料或事实"],
  ["resolve_conflict", "处理事实冲突"],
  ["generate_draft", "生成或撰写草稿"],
  ["refresh_inputs", "核对最新输入"],
  ["confirm_content", "确认草稿内容"],
  ["run_check", "运行检查"],
  ["ack_risk", "处理检查风险"],
  ["approve", "记录内部批准"],
  ["export", "准备导出"],
  ["record_receipt", "核对回执记录"],
  ["none", "暂无待处理动作"],
];

function matterActionLabel(action: NextActionKind): string {
  return NEXT_ACTION_OPTIONS.find(([value]) => value === action)?.[1] ?? "其他动作";
}

function matterActionTab(action: NextActionKind): MatterTab | null {
  switch (action) {
    case "add_sources": return "sources";
    case "resolve_conflict": return "facts";
    case "generate_draft": return "draft";
    case "refresh_inputs": return "facts";
    case "confirm_content": return "draft";
    case "run_check":
    case "ack_risk": return "check";
    case "approve":
    case "export": return "deliver";
    case "record_receipt": return "filing";
    case "none": return null;
  }
}

function matterRouteLabel(route: MatterRoute | null): string {
  switch (route) {
    case "cn_um": return "中国实用新型";
    case "cn_invention": return "中国发明";
    case "us_nonprovisional": return "美国非临时申请";
    case "pct": return "PCT 国际申请";
    case null: return "路线未配置";
  }
}

function formatMatterTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { hour12: false });
}
