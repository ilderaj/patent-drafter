import { useCallback, useEffect, useRef, useState } from "react";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { GenerationConsentDetails, IncompleteAnswersNotice, realGenerationAllowed } from "../../components/GenerationConsentDetails.tsx";
import { Button, Callout, Sheet, Tag } from "../../components/ui/index.ts";
import { GenerationPanel } from "../generation/Generation.tsx";
import { createGenerationSession, resolveGenerationRuntime, type GenerationRuntime } from "../generation/runtime.ts";

type Props = {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string;
  onAdopted: () => void;
  answerHref?: string;
};

/** Do not mount a real engine until its exact outbound scope is authorized. */
export function SelfGeneration(props: Props) {
  const { repository, actor, matterId, targetId } = props;
  const [runtime, setRuntime] = useState<GenerationRuntime | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(0);

  // Depend on the actor's identity values, not its object: a parent that rebuilds
  // the actor object must not re-run the effect below and close an open sheet.
  const actorRef = useRef(actor);
  actorRef.current = actor;
  const resolve = useCallback(
    () => resolveGenerationRuntime(repository, actorRef.current, matterId, targetId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repository, actor.tenantId, actor.userId, matterId, targetId],
  );

  const refresh = useCallback(async (openSheet = false) => {
    const id = ++operation.current;
    setBusy(true);
    setError(null);
    setRuntime(null);
    try {
      const next = await resolve();
      if (id !== operation.current) return;
      setRuntime(next);
      setSheetOpen(openSheet || (next.mode === "real" && next.consent.required));
    } catch {
      if (id === operation.current) setError("无法读取起草服务状态，请重试。已保存的材料没有变化。");
    } finally {
      if (id === operation.current) setBusy(false);
    }
  }, [resolve]);

  useEffect(() => {
    setAccessCode("");
    setSheetOpen(false);
    void refresh();
    return () => { operation.current += 1; };
  }, [refresh]);

  // Start/retry found the server-side consent gone or revoked. Re-read the outbound scope so
  // the sheet opens again; the user must grant explicitly, and nothing is resent automatically.
  const recoverConsent = useCallback(() => {
    setRuntime(null);
    void refresh(true);
  }, [refresh]);

  const close = () => {
    operation.current += 1;
    setAccessCode("");
    setError(null);
    setBusy(false);
    setSheetOpen(false);
  };

  const authenticate = async () => {
    if (busy || !accessCode.trim()) return;
    const id = ++operation.current;
    setBusy(true);
    setError(null);
    // Only this request receives the code. No code is written to the repository
    // or browser storage; the server owns its HttpOnly session cookie.
    const code = accessCode;
    setAccessCode("");
    try {
      await createGenerationSession(code);
      const next = await resolve();
      if (id !== operation.current) return;
      setRuntime(next);
      // Verifying a code is not consent, even if the server found an old grant.
      // Keep this sheet open so the user can inspect the actual material scope.
    } catch {
      if (id === operation.current) setError("访问码验证未完成，请检查访问码或服务状态后重试。材料没有发送。");
    } finally {
      if (id === operation.current) setBusy(false);
    }
  };

  const agree = async () => {
    if (busy || runtime?.mode !== "real" || !realGenerationAllowed(runtime)) return;
    const id = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      const next = runtime.consent.required ? await runtime.consent.grant() : await resolve();
      if (id !== operation.current) return;
      setRuntime(next);
      if (next.mode !== "real" || next.consent.required) {
        setError(next.unavailableReason ?? "材料或处理方信息已变化，请查看最新清单后重新确认。");
        return;
      }
      setAccessCode("");
      setSheetOpen(false);
    } catch {
      if (id === operation.current) {
        // A failed grant may mean the manifest changed. Never start with the
        // previously displayed runtime; the next attempt must resolve it anew.
        setRuntime(null);
        setError("外发确认没有完成，材料没有开始发送。请重新读取处理方与材料清单。");
      }
    } finally {
      if (id === operation.current) setBusy(false);
    }
  };

  return <>
    {runtime === null ? <div className="route-extra" role="status" data-testid="self-runtime-loading">
      {busy ? "正在读取起草服务与外发范围…" : "起草服务状态尚未读取。"}
    </div> : runtime.mode === "test" ? <Callout tone="warn" icon="info" testId="self-runtime-test">
      <b>本机测试引擎。</b> 真实起草不可用：{runtime.unavailableReason ?? "原因未知。"}
      <p>当前仅返回固定测试输出，不发送材料到模型；采纳、确认或导出不会去掉测试标记。</p>
    </Callout> : <div className="route-extra" data-testid="self-runtime-real">
      <Tag tone="plain">真实 AI 起草</Tag> {runtime.processor.name} · {runtime.processor.model ?? "未知"}
      {runtime.consent.required ? " · 请先确认外发范围" : " · 已有本次范围的有效外发确认"}
    </div>}
    <IncompleteAnswersNotice runtime={sheetOpen ? null : runtime} answerHref={props.answerHref} testIdPrefix="self" />
    <div className="rowgap" style={{ margin: "12px 0" }}>
      <Button disabled={busy} onClick={() => void refresh(true)} data-testid="self-runtime-consent-open">
        {runtime?.mode === "real" ? "查看外发确认" : "访问码与真实起草"}
      </Button>
      <Button disabled={busy} onClick={() => void refresh()} data-testid="self-runtime-refresh">重新读取状态</Button>
    </div>
    {error && !sheetOpen ? <Callout tone="warn" icon="alert" testId="self-runtime-error">{error}</Callout> : null}
    {runtime !== null && !sheetOpen && (runtime.mode === "test" || (!runtime.consent.required && realGenerationAllowed(runtime))) ?
      <GenerationPanel {...props} engineOptions={runtime.engineOptions} onConsentRequired={recoverConsent} /> : null}
    {sheetOpen ? <GenerationConsentSheet runtime={runtime} accessCode={accessCode} busy={busy} error={error}
      onCode={setAccessCode} onClose={close} onAuthenticate={() => void authenticate()}
      onAgree={() => void agree()} onRefresh={() => void refresh(true)} answerHref={props.answerHref} /> : null}
  </>;
}

export interface GenerationConsentSheetProps {
  runtime: GenerationRuntime | null;
  accessCode: string;
  busy: boolean;
  error: string | null;
  onCode: (value: string) => void;
  onClose: () => void;
  onAuthenticate: () => void;
  onAgree: () => void;
  onRefresh: () => void;
  answerHref?: string;
}

/** Uses the prototype's SHEETS.consent markup; every disclosure comes from runtime. */
export function GenerationConsentSheet(props: GenerationConsentSheetProps) {
  const { runtime, busy } = props;
  return <Sheet title="首次把材料发送到设备之外" subtitle="这一步只在你同意后发生。取消不会丢失已上传的材料。"
    onClose={props.onClose}
    footer={<>
      <span className="sf-note">验证访问码不会发送材料；确认后才可开始生成。</span>
      <Button onClick={props.onClose}>取消</Button>
      <Button variant="primary" disabled={busy || !realGenerationAllowed(runtime)}
        onClick={props.onAgree} data-testid="self-consent-agree">{busy ? "正在处理…" : "同意并继续"}</Button>
    </>}>
    <GenerationConsentDetails runtime={runtime} testIdPrefix="self" answerHref={props.answerHref}
      error={props.error ? <Callout tone="warn" icon="alert" testId="self-consent-error">{props.error}</Callout> : undefined} />
    {runtime?.mode !== "real" ? <>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="field-label">访问码</span>
        <input className="input" type="password" autoComplete="off" value={props.accessCode} disabled={busy}
          onChange={(event) => props.onCode(event.currentTarget.value)} data-testid="self-consent-access-code" />
        <span className="small muted">至少 16 个字符；只用于建立本次访问会话，不保存在本机案件或浏览器存储中。</span>
      </label>
      <div className="rowgap" style={{ marginTop: 10 }}>
        <Button disabled={busy || !props.accessCode.trim()} onClick={props.onAuthenticate} data-testid="self-consent-authenticate">验证访问码</Button>
        <Button disabled={busy} onClick={props.onRefresh}>重新读取清单</Button>
      </div>
      <p className="small muted">{runtime?.unavailableReason ?? "正在读取起草服务状态。"}</p>
    </> : null}
  </Sheet>;
}
