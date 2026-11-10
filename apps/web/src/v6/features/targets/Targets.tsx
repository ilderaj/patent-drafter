/**
 * V6-14 — targets panel (S03 路线与目标).
 *
 * The panel is deliberately thin: every rule about routes, recommendations,
 * validation and writes lives in `targets.ts`. This file renders four states
 * (empty / loading / error / stale), a read-only target switcher, the route
 * cards with their verification-gated numbers, the recommendation trace, and
 * the create and update forms.
 *
 * Switching a target only changes the URL hash and local state; it never
 * writes. Every successful write is shown only after the engine returned it;
 * nothing here simulates success, invents a target or fills in a number.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FACT_KIND_LABELS,
  MATURITY_LABELS,
  UNVERIFIED_LABEL,
  createTarget,
  loadTargetsView,
  updateTargetConfig,
  type CreateTargetResult,
  type Language,
  type PriorityClaimInput,
  type Route,
  type TargetConfigInput,
  type TargetFailure,
  type TargetFieldError,
  type TargetsView,
  type TargetView,
  type UpdateTargetConfigResult,
} from "./targets.ts";
import type { Actor, LocalRepository } from "../../lib/repository.ts";

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

export interface ConfigFormState {
  route: Route;
  language: Language;
  applicantIds: string[];
  inventorIds: string[];
  priorityClaims: PriorityClaimInput[];
}

function defaultRoute(view: TargetsView): Route {
  const recommended = view.routeCards.find((card) => card.recommended);
  if (recommended !== undefined) return recommended.route;
  const excludesUm = view.recommendation.excluded.some((item) => item.route === "cn_um");
  return excludesUm ? "cn_invention" : "cn_um";
}

function initialForm(view: TargetsView): ConfigFormState {
  const route = defaultRoute(view);
  const card = view.routeCards.find((candidate) => candidate.route === route);
  return {
    route,
    language: card?.defaultLanguage ?? "zh-CN",
    applicantIds: [],
    inventorIds: [],
    priorityClaims: [],
  };
}

function formFromConfig(view: TargetsView, config: TargetView["config"]): ConfigFormState {
  return {
    route: config?.route ?? "cn_um",
    language: config?.language ?? "zh-CN",
    applicantIds: [...(config?.applicantIds ?? [])],
    inventorIds: [...(config?.inventorIds ?? [])],
    priorityClaims: (config?.priorityClaims ?? []).map((claim) => ({ ...claim })),
  };
}

function sameForm(a: ConfigFormState, b: ConfigFormState): boolean {
  return a.route === b.route
    && a.language === b.language
    && JSON.stringify(a.applicantIds) === JSON.stringify(b.applicantIds)
    && JSON.stringify(a.inventorIds) === JSON.stringify(b.inventorIds)
    && JSON.stringify(a.priorityClaims) === JSON.stringify(b.priorityClaims);
}

function formConfig(form: ConfigFormState): { config: TargetConfigInput; problem: null } {
  return {
    config: {
      route: form.route,
      language: form.language,
      applicantIds: [...form.applicantIds],
      inventorIds: [...form.inventorIds],
      priorityClaims: form.priorityClaims.map((claim) => ({ ...claim, verification: "unverified" })),
    },
    problem: null,
  };
}

function toggleId(values: readonly string[], id: string, checked: boolean): string[] {
  return checked ? [...new Set([...values, id])] : values.filter((value) => value !== id);
}

function unavailableIds(ids: readonly string[], view: TargetsView): string[] {
  const known = new Set(view.parties.map((party) => party.id));
  const missing = ids.filter((id) => !known.has(id));
  return missing.length > 0 ? missing : [];
}

function appendPriorityClaim(claims: readonly PriorityClaimInput[]): PriorityClaimInput[] {
  return [...claims, { country: "", applicationNumber: "", filedOn: "", evidenceAssetId: null, verification: "unverified" }];
}

// ---------------------------------------------------------------------------
// Panel props
// ---------------------------------------------------------------------------

export interface TargetsActions {
  refresh: () => void;
  select: (targetId: string | null) => void;
  create: (form: ConfigFormState) => Promise<void>;
  update: (targetId: string, baseVersion: number, form: ConfigFormState) => Promise<void>;
}

export interface TargetsPanelProps {
  repository?: LocalRepository;
  actor?: Actor;
  matterId?: string;
  /** Injected view for rendering tests; the panel reads storage when absent. */
  initialView?: TargetsView | null;
  loading?: boolean;
  loadError?: TargetFailure | null;
  selectedTargetId?: string | null;
  /** Called after a successful create or update so the shell can refresh. */
  onSettled?: () => void;
}

export interface TargetsViewProps {
  view: TargetsView | null;
  loading: boolean;
  loadError: TargetFailure | null;
  stale: TargetFailure | null;
  busy: boolean;
  notice: string | null;
  actionError: TargetFailure | null;
  localProblem: string | null;
  selectedTargetId: string | null;
  actions: TargetsActions;
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export function TargetsPanel({ repository, actor, matterId, initialView, loading, loadError, selectedTargetId, onSettled }: TargetsPanelProps) {
  const injected = initialView !== undefined;
  const [view, setView] = useState<TargetsView | null>(initialView ?? null);
  const [readError, setReadError] = useState<TargetFailure | null>(loadError ?? null);
  const [readLoading, setReadLoading] = useState(loading ?? !injected);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selected, setSelected] = useState<string | null>(selectedTargetId ?? null);
  const [stale, setStale] = useState<TargetFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<TargetFailure | null>(null);
  const [localProblem, setLocalProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (injected || repository === undefined || actor === undefined || matterId === undefined) return;
    let live = true;
    setReadLoading(true);
    setReadError(null);
    void loadTargetsView(repository, actor, matterId).then((outcome) => {
      if (!live) return;
      setReadLoading(false);
      if (outcome.ok) {
        setView(outcome.view);
        setSelected((current) => current ?? outcome.view.targets[0]?.id ?? null);
      } else {
        setReadError(outcome.error);
      }
    });
    return () => {
      live = false;
    };
  }, [repository, actor, matterId, refreshToken, injected]);

  const refresh = useCallback(() => {
    setStale(null);
    setNotice(null);
    setActionError(null);
    setLocalProblem(null);
    if (!injected) setRefreshToken((token) => token + 1);
  }, [injected]);

  const select = useCallback((targetId: string | null) => {
    setSelected(targetId);
    setNotice(null);
    setActionError(null);
    setLocalProblem(null);
    if (typeof window === "undefined") return;
    const next =
      targetId === null
        ? window.location.pathname + window.location.search
        : `#target=${encodeURIComponent(targetId)}`;
    window.history.replaceState(null, "", next);
  }, []);

  const applyTarget = useCallback((result: CreateTargetResult | UpdateTargetConfigResult) => {
    setView((previous) => {
      if (previous === null) return previous;
      const index = previous.targets.findIndex((target) => target.id === result.target.id);
      const next: TargetView = {
        id: result.target.id,
        label: index >= 0 ? previous.targets[index]!.label : `目标 ${previous.targets.length + 1}`,
        status: result.target.status,
        configVersion: result.target.configVersion,
        config: result.config,
        configAvailable: true,
      };
      return {
        ...previous,
        matterVersion: previous.matterVersion + 1,
        targets:
          index >= 0
            ? previous.targets.map((target) => (target.id === result.target.id ? next : target))
            : [...previous.targets, next],
      };
    });
  }, []);

  const create = useCallback(
    async (form: ConfigFormState) => {
      if (busyRef.current || repository === undefined || actor === undefined || matterId === undefined) return;
      const built = formConfig(form);
      if (built.config === null) {
        setLocalProblem(built.problem);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setLocalProblem(null);
      setActionError(null);
      setStale(null);
      setNotice(null);
      try {
        const outcome = await createTarget(
          repository,
          actor,
          matterId,
          { config: built.config },
          { requestKey: `target-create-${crypto.randomUUID()}` },
        );
        if (outcome.ok) {
          applyTarget(outcome.data);
          setSelected(outcome.data.target.id);
          setNotice("目标已保存。");
          onSettled?.();
          return;
        }
        if (outcome.error.code === "VERSION_CONFLICT") setStale(outcome.error);
        else setActionError(outcome.error);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [repository, actor, matterId, applyTarget, onSettled],
  );

  const update = useCallback(
    async (targetId: string, baseVersion: number, form: ConfigFormState) => {
      if (busyRef.current || repository === undefined || actor === undefined || matterId === undefined) return;
      const built = formConfig(form);
      if (built.config === null) {
        setLocalProblem(built.problem);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setLocalProblem(null);
      setActionError(null);
      setStale(null);
      setNotice(null);
      try {
        const outcome = await updateTargetConfig(
          repository,
          actor,
          matterId,
          targetId,
          { baseVersion, config: built.config },
          { requestKey: `target-update-${crypto.randomUUID()}` },
        );
        if (outcome.ok) {
          applyTarget(outcome.data);
          setNotice("目标配置已保存，其他目标没有变化。");
          onSettled?.();
          return;
        }
        if (outcome.error.code === "VERSION_CONFLICT") setStale(outcome.error);
        else setActionError(outcome.error);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [repository, actor, matterId, applyTarget, onSettled],
  );

  const actions = useMemo<TargetsActions>(() => ({ refresh, select, create, update }), [refresh, select, create, update]);

  return (
    <TargetsViewPanel
      view={injected ? (initialView ?? null) : view}
      loading={injected ? (loading ?? false) : readLoading}
      loadError={injected ? (loadError ?? null) : readError}
      stale={stale}
      busy={busy}
      notice={notice}
      actionError={actionError}
      localProblem={localProblem}
      selectedTargetId={selected}
      actions={actions}
    />
  );
}

// ---------------------------------------------------------------------------
// Presentational view
// ---------------------------------------------------------------------------

const STACKED_NOTICE = { flexDirection: "column", alignItems: "flex-start" } as const;
const COLUMN = { flexDirection: "column", alignItems: "stretch" } as const;

function Triggers({ triggers }: { triggers: TargetsView["recommendation"]["rules"][number]["triggers"] }) {
  return (
    <span className="muted">
      {triggers
        .map((trigger) =>
          trigger.kind === "fact"
            ? `事实 ${trigger.factId}（${FACT_KIND_LABELS[trigger.factKind]}）`
            : `回答 maturity=${trigger.value}（${MATURITY_LABELS[trigger.value]}）`,
        )
        .join("；")}
    </span>
  );
}

function gatedText(gate: { value: string | null; verified: boolean }): string {
  if (!gate.verified || gate.value === null) return UNVERIFIED_LABEL;
  return gate.value;
}

function FieldErrors({ fields, id }: { fields: readonly TargetFieldError[]; id: string }) {
  return (
    <ul className="field-hint" data-testid={id} style={{ margin: 0, paddingLeft: 18 }}>
      {fields.map((field, index) => (
        <li key={`${field.path}-${index}`}>
          <code>{field.path}</code>：{field.reason}
        </li>
      ))}
    </ul>
  );
}

function ConfigFields({
  idPrefix,
  form,
  view,
  busy,
  onChange,
}: {
  idPrefix: string;
  form: ConfigFormState;
  view: TargetsView;
  busy: boolean;
  onChange: (next: ConfigFormState) => void;
}) {
  const card = view.routeCards.find((candidate) => candidate.route === form.route) ?? null;
  const languageProblem =
    card?.languageOptions.find((option) => option.value === form.language && option.disabled)?.reason ?? null;
  const unavailableApplicantIds = unavailableIds(form.applicantIds, view);
  const unavailableInventorIds = unavailableIds(form.inventorIds, view);
  return (
    <>
      <fieldset className="v6-field" data-testid={`${idPrefix}-route`}>
        <legend className="field-label">申请路线</legend>
        <div className="v6-route-grid">
          {view.routeCards.map((candidate) => <label key={candidate.route} className="v6-route-choice">
            <input type="radio" name={`${idPrefix}-route`} value={candidate.route} checked={form.route === candidate.route} disabled={busy}
              onChange={() => onChange({ ...form, route: candidate.route, language: candidate.defaultLanguage })} />
            <span className="v6-route-choice-body">
              <span className="v6-route-choice-title">{candidate.label}{candidate.recommended ? " · 推荐" : ""}</span>
              <span className="v6-route-choice-detail">保护对象：{candidate.protection}</span>
              <span className="v6-route-choice-detail">审查方式：{candidate.examination}</span>
              <span className="v6-route-choice-detail">能力：{candidate.limits.map((limit) => `${limit.reason}（${limit.state === "available" ? "可用" : "不可用"}）`).join("；")}</span>
              {candidate.excludedBy ? <span className="badge badge-warn">依据当前事实不推荐</span> : null}
              <span className="v6-route-choice-detail">规则：{candidate.verificationLabel} · 周期 {gatedText(candidate.cycle)} · 费用 {gatedText(candidate.fee)} · 保护期 {gatedText(candidate.term)}</span>
            </span>
          </label>)}
        </div>
      </fieldset>
      <fieldset className="v6-field" data-testid={`${idPrefix}-language`}>
        <legend className="field-label">语言</legend>
        {card?.languageOptions.map((option) => (
          <label key={option.value} className="row" data-testid={`${idPrefix}-language-${option.value}`}>
            <input
              type="radio"
              name={`${idPrefix}-language`}
              value={option.value}
              checked={form.language === option.value}
              disabled={busy || option.disabled}
              data-disabled-reason={option.reason ?? undefined}
              onChange={() => onChange({ ...form, language: option.value })}
            />
            <span>{option.label}</span>
            {option.disabled ? (
              <span className="field-hint" data-testid={`${idPrefix}-language-reason-${option.value}`}>
                {option.reason}
              </span>
            ) : null}
          </label>
        ))}
        {languageProblem !== null ? (
          <p className="field-hint" data-testid={`${idPrefix}-language-problem`}>
            {languageProblem}
          </p>
        ) : null}
      </fieldset>
      <fieldset className="v6-field" data-testid={`${idPrefix}-applicants`}>
        <legend className="field-label">申请人</legend>
        {view.parties.length === 0 ? <p className="field-hint">本案尚无人员。请先在「事实」中添加申请人或发明人。</p> : <div className="v6-person-picker">
          {view.parties.map((party) => <label className="v6-person-option" key={party.id}>
            <input type="checkbox" checked={form.applicantIds.includes(party.id)} disabled={busy}
              onChange={(event) => onChange({ ...form, applicantIds: toggleId(form.applicantIds, party.id, event.currentTarget.checked) })} />
            <span>{party.name} · {party.kind === "person" ? "个人" : "组织"}</span>
          </label>)}
        </div>}
        {unavailableApplicantIds.length > 0 ? <details className="v6-tech-details"><summary>无法匹配的已保存人员记录</summary>{unavailableApplicantIds.map((id) => <code key={id}>{id} </code>)}</details> : null}
      </fieldset>
      <fieldset className="v6-field" data-testid={`${idPrefix}-inventors`}>
        <legend className="field-label">发明人</legend>
        {view.parties.filter((party) => party.kind === "person").length === 0 ? <p className="field-hint">本案尚无可选的个人。请先在「事实」中添加发明人。</p> : <div className="v6-person-picker">
          {view.parties.filter((party) => party.kind === "person").map((party) => <label className="v6-person-option" key={party.id}>
            <input type="checkbox" checked={form.inventorIds.includes(party.id)} disabled={busy}
              onChange={(event) => onChange({ ...form, inventorIds: toggleId(form.inventorIds, party.id, event.currentTarget.checked) })} />
            <span>{party.name} · 个人</span>
          </label>)}
        </div>}
        {unavailableInventorIds.length > 0 ? <details className="v6-tech-details"><summary>无法匹配的已保存人员记录</summary>{unavailableInventorIds.map((id) => <code key={id}>{id} </code>)}</details> : null}
      </fieldset>
      <div className="stack-3" data-testid={`${idPrefix}-claims`}>
        <div>
          <h4 className="field-label">优先权声明</h4>
          <p className="field-hint">填写国家、申请号和申请日；可从本案材料中选择证据。保存后仍标记为未核实。</p>
        </div>
        {form.priorityClaims.map((claim, index) => {
          const evidenceMissing = claim.evidenceAssetId !== null && !view.evidenceAssets.some((asset) => asset.id === claim.evidenceAssetId);
          return <fieldset className="v6-priority-claim" key={`${idPrefix}-claim-${index}`}>
            <legend>优先权 {index + 1}</legend>
            <label className="field">国家或地区
              <input className="input" value={claim.country} disabled={busy} onChange={(event) => onChange({ ...form, priorityClaims: form.priorityClaims.map((item, itemIndex) => itemIndex === index ? { ...item, country: event.currentTarget.value } : item) })} />
            </label>
            <label className="field">申请号
              <input className="input" value={claim.applicationNumber} disabled={busy} onChange={(event) => onChange({ ...form, priorityClaims: form.priorityClaims.map((item, itemIndex) => itemIndex === index ? { ...item, applicationNumber: event.currentTarget.value } : item) })} />
            </label>
            <label className="field">申请日
              <input className="input" type="date" value={claim.filedOn} disabled={busy} onChange={(event) => onChange({ ...form, priorityClaims: form.priorityClaims.map((item, itemIndex) => itemIndex === index ? { ...item, filedOn: event.currentTarget.value } : item) })} />
            </label>
            <label className="field">证据材料
              <select className="select" value={claim.evidenceAssetId ?? ""} disabled={busy} onChange={(event) => onChange({ ...form, priorityClaims: form.priorityClaims.map((item, itemIndex) => itemIndex === index ? { ...item, evidenceAssetId: event.currentTarget.value || null } : item) })}>
                <option value="">不关联证据材料</option>
                {view.evidenceAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                {evidenceMissing ? <option value={claim.evidenceAssetId ?? ""}>已保存的证据材料暂不可用</option> : null}
              </select>
              {evidenceMissing ? <details className="v6-tech-details"><summary>查看材料标识</summary><code>{claim.evidenceAssetId}</code></details> : null}
            </label>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy}
              onClick={() => onChange({ ...form, priorityClaims: form.priorityClaims.filter((_, itemIndex) => itemIndex !== index) })}>移除此声明</button>
          </fieldset>;
        })}
        <button type="button" className="btn btn-outline btn-sm" disabled={busy}
          onClick={() => onChange({ ...form, priorityClaims: appendPriorityClaim(form.priorityClaims) })}>添加优先权声明</button>
        <p className="field-hint" data-testid={`${idPrefix}-evidence-assets`}>
          {view.evidenceAssets.length === 0
            ? "本案还没有可作为证据的材料。"
            : `可选证据材料：${view.evidenceAssets.map((asset) => asset.name).join("、")}`}
        </p>
      </div>
    </>
  );
}

function CreateForm({ view, busy, onSave }: { view: TargetsView; busy: boolean; onSave: (form: ConfigFormState) => void }) {
  const [form, setForm] = useState<ConfigFormState>(() => initialForm(view));
  const card = view.routeCards.find((candidate) => candidate.route === form.route) ?? null;
  const languageProblem =
    card?.languageOptions.find((option) => option.value === form.language && option.disabled)?.reason ?? null;
  const disabledReason =
    view.matterStatus !== "active"
      ? "案件已归档，不能新增目标。"
      : card === null
        ? "不支持的申请路线，尚未保存。"
        : languageProblem;
  return (
    <div className="stack-3" data-testid="targets-create">
      <h3 className="card-title">新建目标</h3>
      <ConfigFields idPrefix="targets-create" form={form} view={view} busy={busy} onChange={setForm} />
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-default"
          data-testid="targets-create-save"
          disabled={busy || disabledReason !== null}
          title={disabledReason ?? undefined}
          onClick={() => onSave(form)}
        >
          {busy ? "正在保存…" : "创建目标"}
        </button>
        {disabledReason !== null ? (
          <span className="field-hint" data-testid="targets-create-disabled-reason">
            {disabledReason}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function UpdateForm({
  view,
  target,
  busy,
  onSave,
}: {
  view: TargetsView;
  target: TargetView;
  busy: boolean;
  onSave: (targetId: string, baseVersion: number, form: ConfigFormState) => void;
}) {
  const saved = formFromConfig(view, target.config);
  const [form, setForm] = useState<ConfigFormState>(() => saved);
  const dirty = !sameForm(form, saved);
  const disabledReason = view.matterStatus !== "active" ? "案件已归档，不能修改目标。" : null;
  return (
    <div className="stack-3" data-testid="targets-update-form">
      {dirty ? (
        <p className="field-hint" data-testid="targets-update-dirty">
          修改尚未保存；切换目标不会保存这些改动。
        </p>
      ) : null}
      <ConfigFields idPrefix="targets-update" form={form} view={view} busy={busy} onChange={setForm} />
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-default"
          data-testid="targets-update-save"
          disabled={busy || disabledReason !== null}
          title={disabledReason ?? undefined}
          onClick={() => onSave(target.id, target.configVersion, form)}
        >
          {busy ? "正在保存…" : "保存目标配置"}
        </button>
        {disabledReason !== null ? (
          <span className="field-hint" data-testid="targets-update-disabled-reason">
            {disabledReason}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function TargetsViewPanel(props: TargetsViewProps) {
  const { view, loading, loadError, stale, busy, notice, actionError, localProblem, actions } = props;

  if (loading) {
    return (
      <section className="card" data-testid="targets" data-state="loading" aria-busy="true">
        <h2 className="card-title">目标与路线</h2>
        <p className="muted" data-testid="targets-loading">
          正在读取本机目标…
        </p>
        <div className="skeleton v6-skeleton" />
      </section>
    );
  }
  if (loadError !== null) {
    return (
      <section className="card" data-testid="targets" data-state="error" aria-labelledby="targets-title">
        <h2 className="card-title" id="targets-title">
          目标与路线
        </h2>
        <div
          className="notice"
          role="alert"
          data-testid="targets-load-error"
          data-code={loadError.code}
          style={STACKED_NOTICE}
        >
          <strong>读取失败</strong>
          <p>{loadError.message}</p>
          <button type="button" className="btn btn-outline btn-sm" data-testid="targets-retry-load" onClick={actions.refresh}>
            重试
          </button>
        </div>
      </section>
    );
  }
  if (view === null) {
    return (
      <section className="card" data-testid="targets" data-state="loading" aria-busy="true">
        <h2 className="card-title">目标与路线</h2>
        <p className="muted" data-testid="targets-loading">
          正在读取本机目标…
        </p>
      </section>
    );
  }

  const current = view.targets.find((target) => target.id === props.selectedTargetId) ?? null;
  return (
    <section className="card stack-3" data-testid="targets" data-state="ready" data-matter-version={view.matterVersion}>
      <div className="row-between">
        <h2 className="card-title">目标与路线</h2>
        <span className="field-hint" data-testid="targets-version">
          案件版本 {view.matterVersion} · 材料版本 {view.sourceVersion}
        </span>
      </div>

      {stale !== null ? (
        <div className="notice" role="alert" data-testid="targets-stale" data-code={stale.code} style={STACKED_NOTICE}>
          <strong>尚未保存</strong>
          <p>{stale.message}</p>
          <button type="button" className="btn btn-outline btn-sm" data-testid="targets-stale-retry" onClick={actions.refresh}>
            重新读取
          </button>
        </div>
      ) : null}

      {view.targets.length === 0 ? (
        <div className="notice" data-testid="targets-empty" style={STACKED_NOTICE}>
          <strong>本案还没有目标</strong>
          <p className="muted">选择一条路线并创建目标；同一案件可以为不同路线分别创建目标。</p>
        </div>
      ) : (
        // Not `.v6-targets`: its `.chip { color: inherit }` overrides the
        // active chip's text colour and leaves the selected label invisible.
        <nav className="row" style={{ flexWrap: "wrap", gap: 8 }} aria-label="目标切换" data-testid="targets-switcher">
          {view.targets.map((target) => (
            <button
              key={target.id}
              type="button"
              className={target.id === props.selectedTargetId ? "chip active" : "chip"}
              data-testid={`targets-switch-${target.id}`}
              data-target-version={target.configVersion}
              onClick={() => actions.select(target.id)}
            >
              {target.label} · {target.config?.route ?? "配置缺失"} · v{target.configVersion}
              {target.status === "archived" ? " · 已归档" : ""}
            </button>
          ))}
        </nav>
      )}

      {current !== null ? (
        <div className="stack-3" data-testid="targets-selected" data-target-id={current.id}>
          <div className="row-between">
            <h3 className="card-title" data-testid="targets-selected-label">
              {current.label}
            </h3>
            <span className="field-hint" data-testid="targets-selected-version">
              配置版本 {current.configVersion} · 语言 {current.config?.language ?? "未知"}
            </span>
          </div>
          {current.config === null ? (
            <div className="notice" role="alert" data-testid="targets-selected-missing">
              这个目标的配置版本 {current.configVersion} 不在本机存储里；请重新读取后再修改。
            </div>
          ) : (
            <>
              <dl className="kv v6-overview" data-testid="targets-selected-config">
                <dt>路线</dt>
                <dd>
                  {view.routeCards.find((card) => card.route === current.config?.route)?.label ?? current.config.route}
                </dd>
                <dt>申请人</dt>
                <dd>
                  {current.config.applicantIds.length === 0
                    ? "尚未填写"
                    : `${current.config.applicantIds.length} 位`}
                </dd>
                <dt>发明人</dt>
                <dd>
                  {current.config.inventorIds.length === 0
                    ? "尚未填写"
                    : `${current.config.inventorIds.length} 位`}
                </dd>
                <dt>优先权</dt>
                <dd>
                  {current.config.priorityClaims.length === 0
                    ? "没有声明"
                    : current.config.priorityClaims
                        .map(
                          (claim) =>
                            `${claim.country} ${claim.applicationNumber}（${claim.filedOn}，${
                              claim.verification === "unverified" ? UNVERIFIED_LABEL : "人工确认"
                            }）`,
                        )
                        .join("；")}
                </dd>
                <dt>语言</dt>
                <dd>{current.config.language}</dd>
              </dl>
              <UpdateForm
                key={`${current.id}/${current.configVersion}`}
                view={view}
                target={current}
                busy={busy}
                onSave={actions.update}
              />
            </>
          )}
        </div>
      ) : null}

      <CreateForm view={view} busy={busy} onSave={actions.create} />

      <div className="stack-3" data-testid="targets-recommendation" data-fallback={view.recommendation.fallback}>
        <h3 className="card-title">路线推荐（确定性规则，不调用模型）</h3>
        {view.recommendation.rules.length === 0 ? (
          <p className="field-hint" data-testid="targets-recommendation-none">
            当前事实和五题回答没有触发任何路线规则；路线卡照常显示，你可以按需要选择。
          </p>
        ) : (
          <ul className="v6-list" data-testid="targets-recommendation-rules">
            {view.recommendation.rules.map((rule) => (
              <li key={rule.ruleId} className="v6-entry" data-testid={`targets-rule-${rule.ruleId}`}>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <code>{rule.ruleId}</code>
                  <span>{rule.label}</span>
                  {rule.recommend.length > 0 ? (
                    <span className="badge badge-ok">推荐 {rule.recommend.join("、")}</span>
                  ) : null}
                  {rule.exclude.length > 0 ? (
                    <span className="badge badge-warn">不推荐 {rule.exclude.join("、")}</span>
                  ) : null}
                </div>
                <div className="field-hint" data-testid={`targets-rule-triggers-${rule.ruleId}`}>
                  触发：<Triggers triggers={rule.triggers} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="field-hint" data-testid="targets-recommendation-summary">
          {view.recommendation.recommended.length === 0
            ? "没有推荐路线；推荐只是建议，你仍可保存其他有效路线。"
            : `推荐：${view.recommendation.recommended.join("、")}。推荐只是建议，你仍可保存其他有效路线。`}
        </p>
      </div>

      <div className="stack-3" data-testid="targets-cards">
        <h3 className="card-title">路线卡</h3>
        {view.routeCards.map((card) => (
          <article
            key={card.route}
            className="card"
            data-testid={`targets-card-${card.route}`}
            data-recommended={card.recommended}
            data-verification={card.verification ?? "missing"}
          >
            <div className="row" style={{ flexWrap: "wrap" }}>
              <h4 className="card-title">{card.label}</h4>
              {card.recommended ? <span className="badge badge-ok">推荐</span> : null}
              {card.excludedBy !== null ? (
                <span className="badge badge-warn" data-testid={`targets-excluded-${card.route}`}>
                  不推荐：{card.excludedBy.ruleId}
                </span>
              ) : null}
              <span className="badge badge-outline" data-testid={`targets-verification-${card.route}`}>
                规则核实：{card.verificationLabel}
              </span>
            </div>
            <dl className="kv v6-overview">
              <dt>保护对象</dt>
              <dd>{card.protection}</dd>
              <dt>审查方式</dt>
              <dd>{card.examination}</dd>
              <dt>能力限制</dt>
              <dd data-testid={`targets-limits-${card.route}`}>
                {card.limits
                  .map((limit) => `${limit.reason}（${limit.state === "available" ? "可用" : "不可用"}）`)
                  .join("；")}
              </dd>
              <dt>周期</dt>
              <dd data-testid={`targets-cycle-${card.route}`}>{gatedText(card.cycle)}</dd>
              <dt>费用</dt>
              <dd data-testid={`targets-fee-${card.route}`}>{gatedText(card.fee)}</dd>
              <dt>保护期</dt>
              <dd data-testid={`targets-term-${card.route}`}>{gatedText(card.term)}</dd>
            </dl>
            {card.foreignWarning !== null ? (
              <p className="field-hint" data-testid={`targets-foreign-warning-${card.route}`}>
                {card.foreignWarning}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      {localProblem !== null ? (
        <div className="notice" role="alert" data-testid="targets-local-problem" style={STACKED_NOTICE}>
          <strong>尚未保存</strong>
          <p>{localProblem}</p>
        </div>
      ) : null}

      {actionError !== null ? (
        <div
          className="notice"
          role="alert"
          data-testid="targets-action-error"
          data-code={actionError.code}
          style={STACKED_NOTICE}
        >
          <strong>尚未保存</strong>
          <p>{actionError.message}</p>
          {actionError.fields !== undefined && actionError.fields.length > 0 ? (
            <FieldErrors fields={actionError.fields} id="targets-action-error-fields" />
          ) : null}
        </div>
      ) : null}

      <p className="field-hint" role="status" aria-live="polite" data-testid="targets-notice">
        {notice ?? (view.matterStatus === "active" ? "" : "案件已归档：目标只能查看。")}
      </p>
    </section>
  );
}

export default TargetsPanel;
