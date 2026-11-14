/**
 * Generation wiring for the professional draft tab.
 *
 * The panel never assumes a model may be used: it asks the runtime for the
 * actual mode, discloses the exact outbound scope and mounts the generation
 * engine only after the user consented to that scope. In test mode it runs the
 * local test engine and says why real drafting is unavailable.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { GenerationConsentDetails, IncompleteAnswersNotice, realGenerationAllowed } from "../../components/GenerationConsentDetails.tsx";
import { Button, Callout, Sheet, Tag } from "../../components/ui/index.ts";
import { GenerationPanel } from "../generation/Generation.tsx";
import { createGenerationSession, resolveGenerationRuntime, type GenerationRuntime } from "../generation/runtime.ts";

export interface WorkbenchGenerationProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string;
  onAdopted: () => void;
  answerHref?: string;
  /** Called when something needs the user's eyes (sheet, re-consent, running/failed job). */
  onAttention?: () => void;
}

const ATTENTION_JOB_STATES: ReadonlySet<string> = new Set(["queued", "running", "cancel_requested", "failed", "interrupted"]);

/**
 * The collapsible 「生成任务」 strip. Its expanded state is React state, never a
 * hard-coded `open` attribute: re-renders, the 15 s refresh and window focus
 * must not collapse it (the consent sheet lives inside it). It opens by itself
 * when attention is needed (consent sheet, re-consent, running or failed job)
 * and when the editor asks to reveal it; after that the user decides.
 */
export function WorkbenchGenerationStrip(props: WorkbenchGenerationProps & { revealToken?: number }) {
  const { revealToken = 0, ...generation } = props;
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastTarget = useRef(props.targetId);
  useEffect(() => {
    if (lastTarget.current === props.targetId) return;
    lastTarget.current = props.targetId;
    setOpen(false);
  }, [props.targetId]);
  const lastReveal = useRef(revealToken);
  useEffect(() => {
    if (lastReveal.current === revealToken) return;
    lastReveal.current = revealToken;
    setOpen(true);
    requestAnimationFrame(() => {
      const node = bodyRef.current;
      node?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      node?.focus?.({ preventScroll: true });
    });
  }, [revealToken]);
  const onAttention = useCallback(() => setOpen(true), []);
  return <details className="v6-generation-strip" data-testid="workbench-generation-panel" open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span>生成任务</span>
      <span className="sh-r">起草方式、外发确认与进度 · 展开查看</span>
    </summary>
    <div ref={bodyRef} tabIndex={-1}>
      <WorkbenchGeneration {...generation} onAttention={onAttention} />
    </div>
  </details>;
}

export function WorkbenchGeneration(props: WorkbenchGenerationProps) {
  const { repository, actor, matterId, targetId, onAdopted, answerHref } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [jobState, setJobState] = useState<string | null>(null);
  const onAttentionRef = useRef(props.onAttention);
  onAttentionRef.current = props.onAttention;
  const [runtime, setRuntime] = useState<GenerationRuntime | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(0);

  // The panel exposes its job state on its root; watch it so a running or failed
  // job opens the strip without touching the panel's own module.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const read = () => setJobState(host.querySelector('[data-testid="generation"]')?.getAttribute("data-job-state") ?? null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-job-state"] });
    return () => observer.disconnect();
  }, []);
  const attention = sheetOpen ? "sheet"
    : runtime?.mode === "real" && runtime.consent.required ? "consent"
      : jobState !== null && ATTENTION_JOB_STATES.has(jobState) ? `job:${jobState}` : null;
  useEffect(() => {
    if (attention !== null) onAttentionRef.current?.();
  }, [attention]);

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
    try {
      const next = await resolve();
      if (id !== operation.current) return;
      setRuntime(next);
      // Real drafting may not start before its exact outbound scope was confirmed;
      // the sheet opens first so the disclosure is never skipped.
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

  // Start/retry found that the server-side consent is gone or revoked (expired credential,
  // new session, revoked scope). Drop the runtime snapshot and re-read the outbound scope so
  // the consent sheet opens; nothing is granted or resent automatically.
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
    // Only this request receives the code; it is never written to the matter or
    // to browser storage. The server owns the HttpOnly session cookie.
    const code = accessCode;
    setAccessCode("");
    try {
      await createGenerationSession(code);
      const next = await resolve();
      if (id !== operation.current) return;
      setRuntime(next);
      // Verifying the code is not consent: keep the sheet open with the actual
      // material list so the user can read it before agreeing.
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
        // A failed grant may mean the manifest changed. Never reuse the runtime
        // whose scope was displayed; the next attempt resolves it anew.
        setRuntime(null);
        setError("外发确认没有完成，材料没有开始发送。请重新读取处理方与材料清单。");
      }
    } finally {
      if (id === operation.current) setBusy(false);
    }
  };

  const controls = <div className="rowgap" style={{ margin: "10px 0" }}>
    <Button disabled={busy} onClick={() => void refresh(true)} data-testid="workbench-runtime-consent-open">
      {runtime?.mode === "real" ? "查看外发确认" : "访问码与真实起草"}
    </Button>
    <Button disabled={busy} onClick={() => void refresh()} data-testid="workbench-runtime-refresh">重新读取状态</Button>
  </div>;

  return <div ref={hostRef} style={{ display: "contents" }}>
    {runtime === null ? <div className="route-extra" role="status" data-testid="workbench-runtime-loading">
      {busy ? "正在读取起草服务与外发范围…" : "起草服务状态尚未读取。"}
    </div> : null}

    {runtime?.mode === "test" ? <Callout tone="warn" icon="info" testId="workbench-runtime-test">
      <b>本机测试引擎。</b>真实起草不可用：{runtime.unavailableReason ?? "原因未知。"}
      <p>当前只返回固定测试输出，不发送材料到模型；采纳后的修订保留测试标记，不能作为正式申请材料。</p>
    </Callout> : null}

    {runtime?.mode === "real" && !runtime.consent.required ? <div className="route-extra" data-testid="workbench-runtime-real">
      <Tag tone="plain">真实 AI 起草</Tag> {runtime.processor.name} · {runtime.processor.model ?? "未知"}
      {" · "}已有本次范围的有效外发确认
    </div> : null}

    {runtime?.mode === "real" && runtime.consent.required ? <Callout tone="warn" icon="shield" testId="workbench-runtime-consent-required">
      <b>真实起草需要先确认外发范围。</b>本次材料尚未获得外发确认，因此不会启动真实引擎。
      <p>{runtime.processor.name} · {runtime.processor.region} · 保留 {runtime.processor.retention}</p>
    </Callout> : null}

    <IncompleteAnswersNotice runtime={sheetOpen ? null : runtime} answerHref={answerHref} testIdPrefix="workbench" />

    {controls}

    {error !== null && !sheetOpen ? <Callout tone="warn" icon="alert" testId="workbench-runtime-error">{error}</Callout> : null}

    {runtime !== null && !sheetOpen && (runtime.mode === "test" || (!runtime.consent.required && realGenerationAllowed(runtime)) )
      ? <GenerationPanel repository={repository} actor={actor} matterId={matterId} targetId={targetId}
        engineOptions={runtime.engineOptions} onAdopted={onAdopted} onConsentRequired={recoverConsent} />
      : null}

    {sheetOpen ? <WorkbenchConsentSheet runtime={runtime} accessCode={accessCode} busy={busy} error={error}
      onCode={setAccessCode} onClose={close} onAuthenticate={() => void authenticate()}
      onAgree={() => void agree()} onRefresh={() => void refresh(true)} answerHref={answerHref} /> : null}
  </div>;
}

export interface WorkbenchConsentSheetProps {
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

/** Uses the prototype's consent markup; every disclosure value comes from the runtime. */
export function WorkbenchConsentSheet(props: WorkbenchConsentSheetProps) {
  const { runtime, busy } = props;
  return <Sheet title="首次把材料发送到设备之外" subtitle="这一步只在你同意后发生。取消不会丢失已保存的材料。"
    onClose={props.onClose}
    footer={<>
      <span className="sf-note">验证访问码不会发送材料；确认后才可开始生成。</span>
      <Button onClick={props.onClose}>取消</Button>
      <Button variant="primary" disabled={busy || !realGenerationAllowed(runtime)}
        onClick={props.onAgree} data-testid="workbench-consent-agree">{busy ? "正在处理…" : "同意并继续"}</Button>
    </>}>
    <GenerationConsentDetails runtime={runtime} testIdPrefix="workbench" answerHref={props.answerHref}
      error={props.error ? <Callout tone="warn" icon="alert" testId="workbench-consent-error">{props.error}</Callout> : undefined} />
    {runtime?.mode !== "real" ? <>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="field-label">访问码</span>
        <input className="input" type="password" autoComplete="off" value={props.accessCode} disabled={busy}
          onChange={(event) => props.onCode(event.currentTarget.value)} data-testid="workbench-consent-access-code" />
        <span className="small muted">至少 16 个字符；只用于建立本次访问会话，不保存在本机案件或浏览器存储中。</span>
      </label>
      <div className="rowgap" style={{ marginTop: 10 }}>
        <Button disabled={busy || !props.accessCode.trim()} onClick={props.onAuthenticate} data-testid="workbench-consent-authenticate">验证访问码</Button>
        <Button disabled={busy} onClick={props.onRefresh}>重新读取清单</Button>
      </div>
      <p className="small muted">{runtime?.unavailableReason ?? "正在读取起草服务状态。"}</p>
    </> : null}
  </Sheet>;
}
