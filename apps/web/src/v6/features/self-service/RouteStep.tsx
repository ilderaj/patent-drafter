import { useRef, useState } from "react";
import type { Party } from "../../../../../../packages/contracts/src/matter.ts";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { DISCLOSURE_OPTIONS, readIntake, saveIntake, type IntakeView } from "../intake/intake.ts";
import {
  createTarget,
  loadTargetsView,
  updateTargetConfig,
  type Route,
  type TargetView,
  type TargetsView,
} from "../targets/targets.ts";
import { intakeSaveInput } from "./persistence.ts";

export function RouteStep({
  repository,
  actor,
  matterId,
  intake,
  targets,
  target,
  onSaved,
  onBack,
}: {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  intake: IntakeView;
  targets: TargetsView;
  target: TargetView | null;
  onSaved: (targetId: string) => void;
  onBack: () => void;
}) {
  const initialRoute = target?.config?.route ?? targets.routeCards.find((card) => card.recommended)?.route ?? "cn_um";
  const [route, setRoute] = useState<Route>(initialRoute);
  const [parties, setParties] = useState<Party[]>(intake.parties);
  const [newParties, setNewParties] = useState<Party[]>([]);
  const [newPartyName, setNewPartyName] = useState("");
  const [newPartyKind, setNewPartyKind] = useState<Party["kind"]>("person");
  const [applicantIds, setApplicantIds] = useState<string[]>(target?.config?.applicantIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intakeRequestKey = useRef<string | null>(null);
  const targetRequestKey = useRef<string | null>(null);
  const card = targets.routeCards.find((candidate) => candidate.route === route)!;
  const newIds = new Set(newParties.map((party) => party.id));
  const notSavedParties = parties.filter((party) => newIds.has(party.id));

  const addParty = () => {
    const name = newPartyName.trim();
    if (!name) return;
    const party: Party = { id: crypto.randomUUID(), kind: newPartyKind, name, roles: [], country: null };
    setParties((current) => [...current, party]);
    setNewParties((current) => [...current, party]);
    if (newPartyKind === "person" || newPartyKind === "organization") {
      setApplicantIds((current) => [...current, party.id]);
    }
    setNewPartyName("");
    intakeRequestKey.current = null;
    targetRequestKey.current = null;
    setError(null);
  };

  const toggleApplicant = (partyId: string, checked: boolean) => {
    setApplicantIds((current) => checked ? [...current, partyId] : current.filter((id) => id !== partyId));
    targetRequestKey.current = null;
    setError(null);
  };

  const save = async () => {
    if (busy) return;
    if (target !== null && target.config === null) {
      setError("当前目标配置无法读取。请在专业工作台检查后再继续。");
      return;
    }
    setBusy(true);
    setError(null);
    let currentIntake = intake;

    if (notSavedParties.length > 0) {
      const savedParties = await saveIntake(
        repository,
        actor,
        matterId,
        intakeSaveInput(currentIntake, { parties }),
        { requestKey: intakeRequestKey.current ??= `self-route-parties-${crypto.randomUUID()}` },
      );
      if (!savedParties.ok) {
        const details = savedParties.fields?.map((field) => field.reason).join("；");
        setError(details ? `${savedParties.message} ${details}` : savedParties.message);
        setBusy(false);
        return;
      }
      intakeRequestKey.current = null;
      const refreshed = await readIntake(repository, actor, matterId);
      if (!refreshed.ok) {
        setError("人员已保存，但无法重新读取最新案件状态。请刷新后继续。");
        setBusy(false);
        return;
      }
      currentIntake = refreshed.view;
    }

    const latestTargets = await loadTargetsView(repository, actor, matterId);
    if (!latestTargets.ok) {
      setError(`人员状态已保存；路线尚未保存。${latestTargets.error.message}`);
      setBusy(false);
      return;
    }
    const activeTarget = target === null
      ? null
      : latestTargets.view.targets.find((candidate) => candidate.id === target.id && candidate.status === "active") ?? null;
    const routeCard = latestTargets.view.routeCards.find((candidate) => candidate.route === route)!;
    const config = {
      route,
      language: routeCard.defaultLanguage,
      applicantIds,
      inventorIds: currentIntake.answers.inventorIds,
      priorityClaims: activeTarget?.config?.priorityClaims.map((claim) => ({
        country: claim.country,
        applicationNumber: claim.applicationNumber,
        filedOn: claim.filedOn,
        evidenceAssetId: claim.evidenceAssetId,
        verification: claim.verification,
      })) ?? [],
    };

    if (activeTarget && activeTarget.config) {
      const unchanged = activeTarget.config.route === config.route
        && activeTarget.config.language === config.language
        && sameIds(activeTarget.config.applicantIds, config.applicantIds)
        && sameIds(activeTarget.config.inventorIds, config.inventorIds);
      if (!unchanged) {
        const updated = await updateTargetConfig(
          repository,
          actor,
          matterId,
          activeTarget.id,
          { baseVersion: activeTarget.configVersion, config },
          { requestKey: targetRequestKey.current ??= `self-route-target-${crypto.randomUUID()}` },
        );
        if (!updated.ok) {
          setError(`人员已保存；路线尚未保存。${updated.error.message}`);
          setBusy(false);
          return;
        }
      }
      targetRequestKey.current = null;
      setBusy(false);
      onSaved(activeTarget.id);
      return;
    }

    const created = await createTarget(
      repository,
      actor,
      matterId,
      { config },
      { requestKey: targetRequestKey.current ??= `self-route-target-${crypto.randomUUID()}` },
    );
    if (!created.ok) {
      setError(`人员已保存；路线尚未保存。${created.error.message}`);
      setBusy(false);
      return;
    }
    targetRequestKey.current = null;
    setBusy(false);
    onSaved(created.data.target.id);
  };

  return (
    <section className="v6-self-step" data-testid="self-route-step">
      <div className="v6-self-step-heading"><div><p className="v6-self-kicker">第 3 步</p><h2>选择申请准备路线</h2></div></div>
      <p className="v6-self-copy">路线建议只依据本案已保存的事实和你选择的成熟度。四张卡都可查看；选择后，点击保存才会写入本案。</p>
      {targets.snapshotEmpty ? <p className="notice">本案事实尚少，路线推荐不完整。你仍可自行选择；不会自动补写事实。</p> : null}
      <div className="v6-self-route-grid" role="radiogroup" aria-label="申请路线">
        {targets.routeCards.map((candidate) => (
          <button
            key={candidate.route}
            type="button"
            className={candidate.route === route ? "v6-self-route-card selected" : "v6-self-route-card"}
            role="radio"
            aria-checked={candidate.route === route}
            data-testid={`self-route-${candidate.route}`}
            onClick={() => { setRoute(candidate.route); targetRequestKey.current = null; setError(null); }}
          >
            <span className="v6-self-route-title">{candidate.label}</span>
            <span className="v6-self-route-badges">
              {candidate.recommended ? <span className="badge badge-ok">按已保存信息建议</span> : null}
              {candidate.excludedBy ? <span className="badge badge-warn">有规则提示</span> : null}
            </span>
            <span className="v6-self-route-detail"><strong>保护对象</strong>{candidate.protection}</span>
            <span className="v6-self-route-detail"><strong>审查方式</strong>{candidate.examination}</span>
            <span className="v6-self-route-detail"><strong>周期与费用</strong>{candidate.cycle.verified ? `${candidate.cycle.value ?? "未核实"} · ${candidate.fee.value ?? "未核实"}` : "未核实；本地版不收费"}</span>
            <span className="v6-self-route-detail"><strong>能力范围</strong>{candidate.limits.map((limit) => `${limit.state === "available" ? "可用" : "未开放"}：${limit.reason}`).join("；")}</span>
            {candidate.excludedBy ? <span className="field-hint">规则提示：{candidate.excludedBy.label}。这不是阻断；请按实际情况判断。</span> : null}
            {candidate.foreignWarning ? <span className="field-hint">{candidate.foreignWarning}</span> : null}
          </button>
        ))}
      </div>

      {intake.answers.disclosure !== null && intake.answers.disclosure !== "none" ? (
        <div className="notice" data-testid="self-route-disclosure-warning">
          {DISCLOSURE_OPTIONS.find((option) => option.value === intake.answers.disclosure)?.label ?? "已记录对外公开"}：请核实日期、对象和保密情况。此提示不替你判断法律影响，也不自动阻断准备稿。
        </div>
      ) : null}

      <section className="v6-self-people-panel" aria-labelledby="self-applicant-title">
        <div><h3 id="self-applicant-title">申请人</h3><p className="field-hint">按姓名选择本案人员。尚未确定时可以暂留空；进入正式递交前需要补齐。</p></div>
        {parties.length === 0 ? <p className="field-hint">本案还没有人员。</p> : null}
        <div className="v6-self-people">
          {parties.map((party) => (
            <label key={party.id} className="v6-self-person">
              <input type="checkbox" checked={applicantIds.includes(party.id)} onChange={(event) => toggleApplicant(party.id, event.currentTarget.checked)} />
              <span>{party.name} · {party.kind === "person" ? "自然人" : "组织"}</span>
            </label>
          ))}
        </div>
        <div className="v6-self-add-person">
          <input className="input" value={newPartyName} onChange={(event) => setNewPartyName(event.currentTarget.value)} placeholder="姓名或组织名称" aria-label="申请人姓名或组织名称" />
          <select className="select" value={newPartyKind} onChange={(event) => setNewPartyKind(event.currentTarget.value as Party["kind"])} aria-label="人员类型">
            <option value="person">自然人</option>
            <option value="organization">组织</option>
          </select>
          <button type="button" className="btn btn-outline" disabled={!newPartyName.trim()} onClick={addParty}>添加并选择</button>
        </div>
        {notSavedParties.length > 0 ? <p className="field-hint">新增人员在保存路线时写入本案。</p> : null}
      </section>

      {target && target.config === null ? <div className="notice" role="alert">已有目标配置无法读取，不能用空值覆盖。请从专业工作台检查本案。</div> : null}
      {error ? <div className="notice" role="alert" data-testid="self-route-error">{error}</div> : null}
      <div className="v6-self-actions">
        <button type="button" className="btn btn-outline" disabled={busy} onClick={onBack}>上一步</button>
        <span className="field-hint">人员和路线在点击保存后才写入本案；数值未核实时显示「未核实」。</span>
        <button type="button" className="btn btn-default" disabled={busy || target !== null && target.config === null} onClick={() => void save()}>
          {busy ? "正在保存…" : "保存路线并继续"}
        </button>
      </div>
    </section>
  );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
