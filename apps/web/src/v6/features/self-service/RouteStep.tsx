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
import { Callout, Icon, Tag } from "../../components/ui/index.ts";

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
    setApplicantIds((current) => [...current, party.id]);
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

  const weekly = route === "us_nonprovisional" || route === "pct";

  return (
    <div data-testid="self-route-step">
      <h1 className="wiz-h1">在哪里申请，用哪种类型</h1>
      <p className="wiz-sub">根据你的回答，先给一个建议。之后可以在专业工作台里增加更多法域目标。</p>
      <div className="route-grid" role="radiogroup" aria-label="申请路线">
        {targets.routeCards.map((candidate) => {
          const selected = candidate.route === route;
          return (
            <button
              key={candidate.route}
              type="button"
              className={selected ? "route-card sel" : "route-card"}
              role="radio"
              aria-checked={selected}
              data-testid={`self-route-${candidate.route}`}
              onClick={() => { setRoute(candidate.route); targetRequestKey.current = null; setError(null); }}
            >
              {candidate.recommended ? <span className="rc-rec rc-badge">建议</span> : null}
              <span className="rc-h"><span className="rc-t">{candidate.label}</span>{candidate.excludedBy ? <Tag tone="warn">规则提示</Tag> : null}</span>
              <span className="rc-d">{candidate.protection}</span>
              <span className="rc-m">
                <span><b>审查</b> {candidate.examination}</span>
                <span><b>周期</b> {candidate.cycle.verified ? candidate.cycle.value ?? "已核实" : "未核实"}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="route-extra">
        <Icon name="info" size="sm" /> 能力范围：{card.limits.map((limit) => `${limit.state === "available" ? "可用" : "未开放"}：${limit.reason}`).join("；")}
      </div>
      {card.foreignWarning ? <div className="route-extra"><Icon name="info" size="sm" /> {card.foreignWarning}</div> : null}

      {intake.answers.disclosure !== null && intake.answers.disclosure !== "none" ? (
        <Callout tone="warn" icon="alert" testId="self-route-disclosure-warning">
          <b>你提到有过对外公开。</b>
          {DISCLOSURE_OPTIONS.find((option) => option.value === intake.answers.disclosure)?.label ?? "已记录对外公开"}：请核实日期、对象和保密情况。此提示不替你判断法律影响，也不自动阻断准备稿。
        </Callout>
      ) : null}

      <div className="costsum">
        <div className="cs">官费<b>按提交日标准</b></div>
        <div className="cs">平台服务费<b>未开放</b></div>
        <div className="cs">预计完成<b>{weekly ? "需专业人员接手" : "本机测试生成"}</b></div>
        <div className="cs" style={{ marginLeft: "auto", textAlign: "right" }}><Tag tone="plain">本地版不收费</Tag></div>
      </div>

      <div className="wiz-sec">
        <div className="q-meta"><span>申请人</span><span className="dotsep" /><span>按姓名选择；尚未确定时可以暂留空</span></div>
        {parties.length === 0 ? <p className="small muted">本案还没有人员。</p> : null}
        <div className="optgrid">
          {parties.map((party) => {
            const selected = applicantIds.includes(party.id);
            return (
              <button key={party.id} type="button" className={selected ? "optcard sel" : "optcard"}
                aria-pressed={selected}
                onClick={() => toggleApplicant(party.id, !selected)}>
                <span className={selected ? "radio on" : "radio"} />
                <span><span className="oc-t">{party.name}</span><span className="small muted">{party.kind === "person" ? "自然人" : "组织"}</span></span>
              </button>
            );
          })}
        </div>
        <div className="rowgap" style={{ marginTop: 10 }}>
          <input className="input" value={newPartyName} onChange={(event) => setNewPartyName(event.currentTarget.value)} placeholder="姓名或组织名称" aria-label="申请人姓名或组织名称" />
          <select className="select" value={newPartyKind} onChange={(event) => setNewPartyKind(event.currentTarget.value as Party["kind"])} aria-label="人员类型">
            <option value="person">自然人</option>
            <option value="organization">组织</option>
          </select>
          <button type="button" className="btn" disabled={!newPartyName.trim()} onClick={addParty}>添加并选择</button>
        </div>
        {notSavedParties.length > 0 ? <p className="small muted">新增人员在保存路线时写入本案。</p> : null}
      </div>

      {target && target.config === null ? <Callout tone="warn" icon="alert">已有目标配置无法读取，不能用空值覆盖。请从专业工作台检查本案。</Callout> : null}
      {error ? <Callout tone="warn" icon="alert" testId="self-route-error">{error}</Callout> : null}

      <div className="wiz-foot">
        <button type="button" className="btn" disabled={busy} onClick={onBack}>
          <Icon name="chevL" size="sm" />上一步
        </button>
        <span className="hint">人员与路线在保存后写入本案；未核实的数值不显示估算。</span>
        <button type="button" className="btn primary lg" disabled={busy || (target !== null && target.config === null)} onClick={() => void save()}>
          {busy ? "正在保存…" : "生成材料"}<Icon name="arrow" size="sm" />
        </button>
      </div>
    </div>
  );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
