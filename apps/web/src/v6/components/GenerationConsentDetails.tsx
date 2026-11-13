import type { ReactNode } from "react";
import type { GenerationRuntime } from "../features/generation/runtime.ts";
import { INTAKE_QUESTIONS } from "../features/intake/intake.ts";
import { Button, Callout } from "./ui/index.ts";

const LOCAL_ONLY_ANSWERS = "发明人、公开历史、成熟度只在本机，不会发送。";

function documentChunkCount(runtime: GenerationRuntime | null): number | null {
  const manifest = runtime?.consent.manifest;
  if (!manifest) return null;
  const answerChunkIds = new Set(manifest.answers.items.filter((item) => item.sent).flatMap((item) => item.chunkId ? [item.chunkId] : []));
  return manifest.chunkIds.filter((id) => !answerChunkIds.has(id)).length;
}

export function realGenerationAllowed(runtime: GenerationRuntime | null): boolean {
  if (runtime?.mode !== "real" || runtime.consent.manifest === null) return false;
  return runtime.consent.manifest.answers.complete || (documentChunkCount(runtime) ?? 0) > 0;
}

function incompleteWithoutDocuments(runtime: GenerationRuntime | null): boolean {
  if (runtime?.consent.manifest) {
    return !runtime.consent.manifest.answers.complete && documentChunkCount(runtime) === 0;
  }
  return runtime?.mode === "test" && runtime.unavailableReason?.includes("没有已解析的文档") === true;
}

function missingAnswers(runtime: GenerationRuntime | null): string | null {
  if (!incompleteWithoutDocuments(runtime)) return null;
  const manifestMissing = runtime?.consent.manifest?.answers.missing.join("、");
  if (manifestMissing) return manifestMissing;
  if (runtime?.mode === "test") {
    const fromReason = /缺：([^。]+)\。答完/.exec(runtime.unavailableReason ?? "")?.[1];
    if (fromReason) return fromReason;
  }
  return INTAKE_QUESTIONS.map((item, index) => `第 ${index + 1} 题（${item.label}）`).join("、");
}

/** Shared exact-scope disclosure used by both self-service and workbench sheets. */
export function IncompleteAnswersNotice({
  runtime,
  answerHref,
  testIdPrefix,
}: {
  runtime: GenerationRuntime | null;
  answerHref?: string;
  testIdPrefix: string;
}) {
  if (!incompleteWithoutDocuments(runtime)) return null;
  const missing = missingAnswers(runtime);
  return <Callout tone="warn" icon="alert" testId={`${testIdPrefix}-answer-incomplete`}>
    <b>没有已解析文档，不能真实起草。</b>
    <p>还缺：{missing}</p>
    {answerHref ? <Button to={answerHref} size="sm" data-testid={`${testIdPrefix}-answer-link`}>去回答</Button> : null}
  </Callout>;
}

export function GenerationConsentDetails({
  runtime,
  testIdPrefix,
  answerHref,
  error,
}: {
  runtime: GenerationRuntime | null;
  testIdPrefix: string;
  answerHref?: string;
  error?: ReactNode;
}) {
  const manifest = runtime?.consent.manifest;
  const processor = runtime?.processor;
  const known = (value?: string | null) => value?.trim() && value !== "unknown" ? value : "未知";
  const answer = manifest?.answers;
  const blockedForAnswers = incompleteWithoutDocuments(runtime);
  const missingFromReason = missingAnswers(runtime);
  const showAnswerSummary = answer !== undefined || missingFromReason !== null;
  // The title is disclosed as the exact text that may be sent, never hidden
  // behind a length. React escapes it; nothing here renders it as HTML.
  const titleSent = manifest?.titleSent === true && manifest.title !== null;

  return <div className="consentbox" data-testid={`${testIdPrefix}-consent-disclosure`}>
    <div className="cb-row"><span className="cb-k">用途</span><span className="cb-v">起草中国实用新型中文权利要求书与说明书（草稿）</span></div>
    <div className="cb-row"><span className="cb-k">处理方</span><span className="cb-v">{known(processor?.name)}</span></div>
    <div className="cb-row"><span className="cb-k">区域</span><span className="cb-v">{known(processor?.region)}</span></div>
    <div className="cb-row"><span className="cb-k">保留</span><span className="cb-v">{known(processor?.retention)}</span></div>
    <div className="cb-row"><span className="cb-k">训练用途</span><span className="cb-v">{processor?.trainingPolicy === "no_training" ? "不用于训练" : processor?.trainingPolicy === "allowed" ? "处理方政策允许训练用途" : "未知"}</span></div>
    <div className="cb-row"><span className="cb-k">条款版本</span><span className="cb-v">{known(processor?.termsVersion)}</span></div>
    <div className="cb-row"><span className="cb-k">模型</span><span className="cb-v">{known(processor?.model)}</span></div>
    <div className="cb-row"><span className="cb-k">案件标题</span><div className="cb-v" data-testid={`${testIdPrefix}-consent-title`}>
      {manifest == null
        ? "未知；建立访问会话后读取本次外发清单。"
        : titleSent
          ? <><span data-testid={`${testIdPrefix}-consent-title-sent`}>{manifest.title}</span><span className="small muted">（可能作为主题背景随本次请求外发）</span></>
          : <span data-testid={`${testIdPrefix}-consent-title-local`}>{manifest.title === null ? "案件标题不外发。" : `不外发；标题仅留在本机：${manifest.title}`}</span>}
    </div></div>
    <div className="cb-row"><span className="cb-k">涉及材料</span><div className="cb-v" data-testid={`${testIdPrefix}-consent-materials`}>
      {manifest ? <>
        {manifest.files.length > 0 ? <ul>{manifest.files.map((file) => <li key={file.assetId}>
          {file.name} · {file.pageCount === null ? "页数未知" : `${file.pageCount} 页`}
        </li>)}</ul> : answer && answer.answered > 0
          ? <p data-testid={`${testIdPrefix}-consent-no-files`}>没有上传文档；本次内容来自你保存的回答与事实。</p>
          : <p>尚无已解析的材料来源。</p>}
        {manifest.files.length > 0 ? <p>{manifest.factCount} 条事实 · {manifest.chunkIds.length} 个材料片段 · {manifest.draftRevisionIds.length} 份草稿修订 · {manifest.figureRevisionIds.length} 份附图修订</p> : null}
      </> : "未知；建立访问会话后读取本次材料清单，当前不能确认外发。"}
    </div></div>
    {showAnswerSummary ? <div className="cb-row" data-testid={`${testIdPrefix}-consent-answers-row`}>
      <span className="cb-k">你的回答</span><div className="cb-v" data-testid={`${testIdPrefix}-consent-answers`}>
        {answer ? <>
          <p>已回答 {answer.answered}/{answer.total} 题；将外发其中 {answer.sentCount} 条技术回答。</p>
          {answer.items.filter((item) => item.sent).length > 0 ? <ul>{answer.items.filter((item) => item.sent).map((item) => (
            <li key={item.key}>第 {item.questionNo} 题 · {item.label} · 约 {item.characters ?? 0} 字</li>
          ))}</ul> : <p>目前没有直接回答内容会随本次请求发送。</p>}
          {!answer.complete && answer.missing.length > 0 ? <p data-testid={`${testIdPrefix}-consent-missing`}>还缺：{answer.missing.join("、")}</p> : null}
          <p>{LOCAL_ONLY_ANSWERS}</p>
        </> : <>
          <p>尚未完成全部回答；当前没有回答内容可以用于真实起草。</p>
          {missingFromReason ? <p data-testid={`${testIdPrefix}-consent-missing`}>还缺：{missingFromReason}</p> : null}
          <p>{LOCAL_ONLY_ANSWERS}</p>
        </>}
      </div>
    </div> : null}
    {blockedForAnswers ? <div className="cb-row" data-testid={`${testIdPrefix}-consent-answer-gate`}>
      <span className="cb-k">起草条件</span><div className="cb-v">
        <Callout tone="warn">没有已解析文档，五题答完后才能真实起草。当前不会启动真实生成。</Callout>
        {answerHref ? <Button to={answerHref} size="sm" data-testid={`${testIdPrefix}-consent-answer-link`}>去回答</Button> : null}
      </div>
    </div> : null}
    {error !== undefined ? error : null}
    <Callout tone="info" icon="shield">处理方、区域、保留政策或材料范围变化时，需要重新确认；每次调用会核对授权。</Callout>
  </div>;
}
