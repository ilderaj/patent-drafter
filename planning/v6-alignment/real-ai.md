# 真实 AI 运行时接口（2026-11-12）

## 2026-11-13 接口收紧交付

- 标题选用“披露并签入摘要”：`manifest.title: string|null`、`titleSent:boolean` 进入 version 2 摘要；上传与仅问答均测试改标题后旧授权失效、chat=0。
- tester 新调用顺序：POST session → GET status（含 sessionId/profileVersion）→ 用户明确确认后 POST consent（profileVersion/manifestHash）→ POST chat（stage/profileVersion/manifestHash/consentCredential 必填）。旧 chat 脚本不带凭证会被拒绝，这是预期行为。
- 浏览器 resolver 不申请凭证、不后台补发。`grant()` 是唯一申请入口；内存凭证不持久化。取消、刷新、换会话、退出、撤回或变更清单后不能继续使用旧 provider，需要再次明确同意。退出用导出的 `endGenerationSession()`。
- 服务端白名单与实际 STAGES 的 13 个 LLM 阶段一致；无凭证、过期、换会话、换 profile/摘要、未知 stage 均不发上游。ACCESS_CODE 至少 16 字符，SESSION_SECRET 至少 32 字符。复制的无状态 cookie/凭证并没有服务器逐条撤销，分别最长有效 2 小时/30 分钟；泄露时需轮换 secret。
- 上游 400 新增向后兼容错误码 `PROVIDER_REQUEST_INVALID`，中文为“请求内容或参数不符合模型要求，请减少材料或检查服务配置。” 英文码保留在技术详情。
- 验证：worker-v6 18/18（`/tmp/v6-proof-worker.log`）；针对测试 49/49（`/tmp/v6-proof-targeted.log`）；typecheck/build 通过（`/tmp/v6-proof-typecheck.log`、`/tmp/v6-proof-build.log`）；`node qa/v6/runner.mjs --all` 721/721、0 skip（`/tmp/v6-proof-all.log`）。均为合成上游响应，未调用真实供应商；本轮未修改 UI、安装依赖、提交或部署。

本文件是界面接入约定。实现位置：`apps/web/src/v6/features/generation/runtime.ts`。不改变本地测试修订的标记规则。

```ts
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import type { GenerationEngineOptions } from "./generation.ts";
import type { PayloadManifest } from "../ai/ai.ts";

export interface RuntimeProcessor {
  name: string; // 未配置为“未知”
  region: string; // 未配置为“未知”
  retention: string; // 未配置为“未知”
  trainingPolicy: "no_training" | "allowed" | "unknown";
  termsVersion: string | null;
  model: string | null;
}
export interface GenerationRuntime {
  mode: "real" | "test";
  engineOptions: Omit<GenerationEngineOptions, "repository" | "actor">;
  consent: {
    required: boolean; // 真实模式必须显式确认；本标签页已有匹配凭证且清单未变时 false
    manifest: PayloadManifest | null;
    grant(): Promise<GenerationRuntime>; // 仅显式确认按钮调用，写同意账本并返回更新后的运行时
  };
  processor: RuntimeProcessor;
  unavailableReason: string | null; // test 模式解释服务/会话/材料为何不可用
}
export function resolveGenerationRuntime(
  repository: LocalRepository, actor: Actor, matterId: string, targetId: string,
): Promise<GenerationRuntime>;
export function createGenerationSession(accessCode: string): Promise<void>;
export function endGenerationSession(): Promise<void>; // DELETE 当前浏览器 cookie；清本标签页凭证，永久失效已有 runtime；不吊销已复制的令牌
```

界面接法：先 await resolveGenerationRuntime；显示 mode、processor、manifest 标题/文件/回答数量；真实模式 consent.required=true 时禁用启动并展示确认按钮；用户显式确认后 await runtime.consent.grant()，使用返回值的 engineOptions 构建 GenerationPanel。grant 不会调用模型，但会调用一次 POST /api/v6/consent 取得本标签页凭证。**不要在任何非用户点击路径调用 grant**（包括 resolve、重试、后台刷新、自动恢复）。刷新页面、重新登录、取消任务、改标题/材料或撤回授权后，consent.required 会回到 true，需要重新确认。真实服务不可用会返回 LOCAL_TEST_GENERATION_OPTIONS，但必须显示 unavailableReason 与测试模式标签，不能把测试结果写成真实稿。

访问码由界面临时输入给 createGenerationSession；不放入 localStorage/IndexedDB。会话由服务端 HttpOnly cookie 持有。会话失效时重新输入访问码；浏览器永远不接受或保存 MODEL_API_KEY。

退出按钮从 `features/generation/runtime.ts` 导入并 await `endGenerationSession(): Promise<void>`。该方法先清本标签页全部凭证内存并递增会话代数，再请求同源 `DELETE /api/v6/session`；已有 runtime 的后续 beforeCall 验证和 grant 永久失败，即使相同摘要后来重新 grant 也不会复活旧对象。DELETE 失败时仍已清除本机凭证，方法抛中文错误供 UI 展示，不能宣称服务器已退出；成功后 UI 刷新 status 并丢弃旧 runtime。此操作不删除本地案件、偏好或同意审计账本，也不宣称吊销已复制的 cookie。

退出接口追加验证：security-proof 9/9（成功/失败退出均清内存、旧对象无法复用）；real-ai 全部 50/50，typecheck/build 通过，`git diff --check` 通过。日志 `/tmp/v6-logout-runtime-test.log`、`/tmp/v6-logout-runtime-all.log`、`/tmp/v6-logout-typecheck.log`、`/tmp/v6-logout-build.log`。本次未重复执行全量 `--all`；前一轮全量为 721/721。

## 标题：manifest.title / titleSent（给确认弹层的字段）

真实链路的 `build_invention_model` 在没有 subject 事实时会用案件标题兜底，因此标题属于实际外发内容。`PayloadManifest` 必填：

```ts
title: string | null;   // 实际可用的标题原文；空标题为 null
titleSent: boolean;     // 目前等于 title !== null，表示该标题可能作为主题上下文发送
```

两者都进入 `payloadManifestHash`（hashInput version 2）。确认弹层应显示标题或"（未填写发明名称）"；**改标题会使旧同意与旧凭证失效**，必须重新确认。上传与仅问答两条路径一致。

## 仅问答路径：manifest.answers（给确认弹层的字段）

没有上传文档时，用户保存的五题回答本身就是可引用来源。`PayloadManifest` 新增必填字段（`features/ai/ai.ts`）：

```ts
interface AnswerItem {
  questionNo: number;              // 1–5，按五题固定顺序
  key: "problem" | "difference" | "inventorIds" | "disclosure" | "maturity";
  label: string;                   // 问题自身标签，如「问题」「区别」
  answered: boolean;
  sent: boolean;                   // 该答案是否进入外发清单
  characters: number | null;       // 外发文本的码点数；不外发为 null
  chunkId: string | null;          // 外发答案的内容寻址 chunk id
}
interface PayloadManifest {
  // …原有 files / factCount / chunkIds / scope / payloadManifestHash
  answers: {
    total: 5;
    answered: number;              // 已答题目数
    sentCount: number;             // 实际外发条数（正常为 0–2）
    complete: boolean;             // 五题是否全部作答
    missing: string[];             // 未答的「第 N 题（标签）」
    items: AnswerItem[];           // 只含计数与标签，不含回答正文
  };
}
```

界面用法建议（弹层）：显示「用户直接回答 N 条」及每条 `第 N 题 · label · 约 M 字`；不要展示正文。`complete=false` 时显示 `missing`，并说明缺题时不能真实起草。

数据最小化：只外发第 1 题（问题）与第 2 题（区别）两段技术性文字。发明人、公开历史、成熟度三题必须答完才允许真实起草，但答案本身不离机——`sent=false`。
真实起草是否可用：有已解析文档，或五题全部作答（`answers.complete`）。都满足不了时 `resolveGenerationRuntime` 返回 `mode:"test"` 并在 `unavailableReason` 说明缺哪几题。

引用规则：外发事实与 AST 的 `SourceRef` 增加可选字段 `origin:"user_answer"` 与 `questionNo`；`page` 必须为 `null`，`start/end` 是回答原文（NFC）的码点半开区间，`quote` 即该段原文，`chunkHash` 为原文 SHA-256。不存在虚构文件、页码或 chunk。id 由回答文本派生：改答案即改 chunk id 与 `payloadManifestHash`，旧同意按既有规则失效。检查/支持映射与审阅定位显示为「用户直接回答 · 第 N 题」。导出时的来源可用性检查跳过此类引用（无 blob）；恢复包导入保留这些字段且 id 不变。未带新字段的旧 SourceRef 仍然合法。

## GET /api/v6/status（无正文和密钥）

```ts
interface GenerationStatus {
  available: boolean; // 配置、限流存储、处理方披露均满足时 true
  configured: boolean; // MODEL_API_KEY/BASE_URL/NAME/ACCESS_CODE/SESSION_SECRET + RATE_LIMIT 完整
  authenticated: boolean;
  model: string | null;
  processor: {
    name: string; // 原始配置值，缺失用“未知”
    region: string;
    retention: string;
    trainingPolicy: "no_training" | "allowed" | "unknown";
    termsVersion: string | null;
  };
  profileVersion: number; // 模型/处理方配置摘要派生的安全整数，变化使旧同意失效
  unavailableReason: string | null; // 用户可读中文，不含内部地址或敏感配置值
}
```

status 的 available 与 authenticated 分开。配置可用但会话未建立时 available=true、authenticated=false；runtime 仍回测试模式并解释需要访问码。上游当前是否在线由实际调用判断，status 不主动调用模型。

status 另含 `sessionId: string|null`：已登录时为当前会话令牌的 SHA-256（不是令牌本身），用于让浏览器识别"换了一个会话"。旧服务不返回该字段时 runtime 回测试模式并提示更新服务。

POST `/api/v6/session`：`{accessCode:string}` → `{authenticated:true, expiresAt:string}` + HttpOnly/Secure/SameSite=Strict cookie；错误仅返回 `{error:{code:string}}`。
DELETE `/api/v6/session`：同源；清当前浏览器 cookie，返回 `{authenticated:false}`。无服务端撤销表：**被复制的令牌在到期前仍然有效**，需要立即全量失效时轮换 SESSION_SECRET 或 ACCESS_CODE。
POST `/api/v6/consent`：`{profileVersion:number, manifestHash:64位小写hex}`，需当前会话；返回 `{credential:string, expiresAt:ISO, allowedStages:string[]}`。凭证签名绑定当前会话、profileVersion、manifestHash、13 个 LLM 阶段白名单与过期时间（30 分钟，且不超过会话到期）。**只证明该会话对这份摘要执行过明确同意动作**；服务端不保存材料，无法证明任意 prompt 与摘要逐字对应。
POST `/api/v6/chat`：`{requestId:string, prompt:string, stage:string, profileVersion:number, manifestHash:string, consentCredential:string, context?:unknown[], maxTokens?:number, temperature?:number}` → `{content:string}`。`stage` 必须是 13 个实际 LLM 阶段之一，未知/本地/确定性阶段一律 400。缺凭证、凭证过期、换会话、换 profile 或换 manifestHash 返回 409；请求体未知字段、非法类型/范围返回 400。非流式 JSON；模型由服务端配置决定。浏览器 provider 对 content JSON 做阶段 schema 校验。会话、凭证、配置、计数、正文预算或上游失败均不给假输出。上游 HTTP 失败仅附加数字 upstreamStatus，不回传 upstream body；上游 400 单独映射为 PROVIDER_REQUEST_INVALID。

## 服务端配置

原定配置：MODEL_API_KEY、MODEL_BASE_URL、MODEL_NAME、ACCESS_CODE、SESSION_SECRET、PROCESSOR_NAME、PROCESSOR_REGION、PROCESSOR_RETENTION，RATE_LIMIT KV binding。为复用既有同意契约，还需 PROCESSOR_TRAINING_POLICY（no_training/allowed）与 PROCESSOR_TERMS_VERSION；未知时如实展示，真实外发保持不可用，不能替用户虚构训练/条款声明。MODEL_API_KEY、ACCESS_CODE、SESSION_SECRET 用部署 secret；其余为经核实的配置。status 不返回 key、访问码、会话 secret 或上游 URL。

## 实施记录

- 第 0 步：读取 handoff-runtime.md/test-provenance.md；锁定以上接口。
- 服务端：`apps/worker-v6/src/index.ts`；与旧 `apps/worker` 分离。512 KiB 实际字节请求上限，2 MiB 上游响应上限；会话 2 小时；同意凭证 30 分钟；每 IP 每小时最多 10 次访问码尝试；默认每日全局 60 次模型调用；每次最多 8192 输出 token（显式请求上限 16384），90 秒上游超时。**这些计数是 KV 读改写的 best effort 计数，不是原子或财务硬上限**（并发与边缘缓存可超发）；可靠背压应放在供应商余额/额度。KV 故障失败关闭。所有应用代码不写正文或密钥日志。
- ACCESS_CODE 至少 16 字符、SESSION_SECRET 至少 32 字符，否则配置视为不可用；访问码由部署者生成并作为 secret 注入，不写进仓库。
- 部署配置：两个 `wrangler.patent-v6*.jsonc` 指向新入口并绑定 ASSETS，`run_worker_first` 包含 `/api/v6/*` 和 `/`；`/` 保留到 `/v6` 的重定向。RATE_LIMIT 沿用现有 counter namespace，使用独立 `v6:session`/`v6:chat` 前缀避免与旧 worker 冲突；可在部署时换为专用 namespace。V6 `_headers` 的 connect-src 仅为 self。
- 浏览器：`remote-provider.ts` 实现 LLMProvider。会话用 HttpOnly cookie，访问码不持久化；每次模型请求前重读当前同意与服务状态；失效/撤销/范围改变/服务不可用均不发 chat。JSON 按传入的阶段 schema 校验；不把任意上游错误正文放入错误。`output-schema.ts` 为 Zod 3 阶段 schema 提供明确的输出字段描述，解决旧 runner 对 Zod 3 `toJSON` 得到空对象的问题。
- Runtime：`runtime.ts` 已实现约定。AI_RELEASE_GATE 按 runtime 的 status-backed config 解析，默认 synthetic 配置继续 closed。真实模式只开放中国实用新型中文、已有解析文本的材料路径；仅问答且没有解析文本时明确回测试模式。这是当前复用管线的边界：extract-facts 阶段要求可引用的材料 chunk，不能为运行成功捏造文件或来源。UI 仍可展示具体 unavailableReason。
- 提示词：`real-prompts.ts` 通过 ?raw 导入 packages/prompts 现有 14 个文件（system core + 13 个 LLM 阶段）；所有 STAGES 的 promptFile 均存在，没有缺失阶段文件。增加的系统补充仅限定中文实用新型准备稿、不得虚构事实、不得追加法律结论；未新写法律规则。现有提示词中的法规措辞未经本次法律核验，模型审查不代替确定性规则或专业审阅。
- 费用边界：上游接口未保证提供可信货币成本，不能伪造 costMinor=0。新增可选 `maxUnknownCostCalls`，仅真实 runtime 显式设为 16；所有 invocation 保持 costMinor=null/usageUnknown=true。默认旧引擎“未知成本消耗剩余预算”的规则不变。16 次调用、每次输出 token、任务时长和每日 KV 计数共同限制使用量；KV 计数是最终一致的 best effort，不是财务硬限额。供应商侧需另设余额/额度硬上限。
- 取消：先持久化取消与 fence，再 best-effort 调 provider.cancel；Remote provider 中止 fetch，已被上游执行的部分不能撤销。
- 修订来源：测试输出的编辑、恢复、采纳新输入继续继承 testOutput；完整 provider 重新生成不复制旧测试 AST，通过 generated + generationExecution=provider 建立无 testOutput 的新修订，旧历史测试稿仍保留标记。

## 仅问答路径（2026-11-12 追加）

- `features/intake/answer-sources.ts`：把当前 `intake.snapshot` 的五题回答转成可引用来源。只外发第 1 题（问题）与第 2 题（区别）；发明人、公开历史、成熟度只用于判断完整性（`sent=false`，不离机）。chunk id 与事实 id 由回答文本 SHA-256 派生，`sourceId` 固定；改答案即改 id/hash。
- 外发清单：`PayloadManifest.answers`（见上文），并把外发回答的 chunkId / factId 并入 `chunkIds` / `factIds`；因此回答变化会改变 `payloadManifestHash`，旧同意按既有 `validateConsentForUse` 规则失效（已测）。
- 生成：provider 执行时把回答 chunk 追加到 `PipelineContext.chunks`（`assetId` 为回答来源 id、`page` 缺省），把回答事实并入 facts 与支持索引；在 `extract-facts.md` 与支持索引前缀中说明这些 chunk 是「用户直接回答（不是文件，没有页码）」。`bestFactMatch` 之后增加“同一回答 chunk”匹配，保证模型措辞不同也能映射回回答来源。
- `SourceRef` 契约：新增可选 `origin:"user_answer"` 与 `questionNo`（1–5）；`page` 必须为 null，有 `questionNo` 时不得带文件语义。旧 ref 不带字段仍合法。`SourceChunk`（领域类型）新增可选 `origin` / `label`（本次最终只保留领域类型的可选字段；prompt 侧改用文本说明，不依赖字段透传）。
- 门控：`resolveGenerationRuntime` 允许“有已解析文档”或“五题完整”进入真实模式；两者都不满足时回测试模式并说明缺哪几题。引擎侧 `currentInput.insufficientReason` 仅在使用 status-backed（`releaseGate=open`）配置时返回 `INVALID_INPUT`，兼容旧合成测试夹具。
- 呈现：审阅面板的段落来源按钮与「要素支持与来源定位」表对这类引用显示「用户直接回答 · 第 N 题」，页码/chunk 显示为「—」（`draft/Review.tsx`，未改 self-service/workbench/Ai.tsx）。
- 导出：来源可用性检查跳过 `origin=user_answer`（无 blob），不产生假的 MISSING_BYTES。恢复包导入保留这些字段；由于 id 由回答文本派生，导入后重建得到相同 chunk id/hash（已测往返）。

## 验证记录（本地合成数据，不含真实供应商请求）

- `npm run test -w @patent/worker-v6`：9/9 通过；日志 `/tmp/v6-real-ai-worker-tests.log`。
- `node --test qa/v6/scenarios/real-ai/runtime.test.mjs`：独立运行时 11/11 通过，日志 `/tmp/v6-real-ai-runtime-tests.log`；随后增加未知费用调用上限用例，最终 --all 中 real-ai 12/12 通过。覆盖同源 provider、schema、错误映射、超时/取消、无授权/过期/撤销/范围变化/服务不可用不发送、grant 清单不能暗换、真实采纳无测试标记、测试稿后重新生成、无来源输入回退与调用次数预算。
- 最终 `node qa/v6/runner.mjs --all`：30 个场景目录，662 pass / 0 fail / 0 skip；完整日志 `/tmp/v6-real-ai-all-tests.log`。包含并行界面工作当时已落盘的测试。
- 已运行 `npm run typecheck` 和 `npm run build -w @patent/web`，通过；最终日志分别 `/tmp/v6-real-ai-typecheck.log`、`/tmp/v6-real-ai-build.log`。
- 仅问答路径验证：`node --test qa/v6/scenarios/real-ai/answers.test.mjs` 5/5；`answers-recovery.test.mjs` 1/1（加密 .patentpack 导出/导入后 `origin/questionNo` 保留、重建 chunk id/hash 相同）。
- 最终整轮：worker-v6 10/10（`/tmp/v6-ans-worker.log`）；`npm run typecheck` 通过（`/tmp/v6-ans-typecheck.log`）；`npm run build -w @patent/web` 通过（`/tmp/v6-ans-build.log`）；`node qa/v6/runner.mjs --all` 675/675、0 skip（`/tmp/v6-ans-all2.log`，real-ai 18/18）。
- 已知范围：仅在 `releaseGate=open` 的 status-backed 配置下启用“无材料则拒绝”；默认合成配置的既有测试行为不变。self-service/workbench/Ai.tsx 未由本 worker 改动；`QuestionsStep <-> SelfService` 的同 feature 循环来自并行 UI 工作，不在本 worker 写集。
- 没有安装依赖；package-lock 只手动登记无依赖的新 workspace；没有修改 node_modules 软链、提交或部署。真实供应商联通性/真实产出质量尚未验证，需配置经核实的服务端 secret 与处理方披露后另做一次合成材料 live smoke。

## 验收修复（2026-11-12）：调用记录单一来源 + 错误分类

- **调用记录**：AI 页不再读顶层 `ai.invocation` 行（仓库里本来没有写入方，已移除读取）。`ai.ts` 的 `readAiRows` 从当前用户的 `generation.job` 行派生，生成引擎是唯一写入方。`GenerationInvocation` 新增可选 `execution:"stub"|"provider"` 与 `errorCode`（失败调用在 `markFailed` 同一更新里写入）。投影仍是显式字段白名单，不含提示词、上下文、响应或密钥。
- **`SafeInvocationRow` 新增字段（给 Ai.tsx）**：`at`（ISO 时间，旧行为 null）、`execution`（`stub`=本机测试输出，`provider`=真实外发，旧行为 null）、`executionLocation`（处理方区域或 `device:stub`）、`errorCode`（失败码，否则 null）。建议：表格加「时间」「类型（测试/真实）」列，失败行在「状态」旁显示中文原因（`userMessageFor(errorCode)`），英文码只放技术详情；`InvocationSection` 里「合同没有调用时间字段，界面不臆造时间」「本构建没有真实调用」两句已过时，应删除。排序为时间升序。
- **错误分类**：Worker 把上游错误包成 502 `UPSTREAM_ERROR`+数字 `upstreamStatus`，浏览器此前没读该数字，所有上游失败都落到 PROVIDER_REJECTED。现在 `remote-provider.ts` 按 `upstreamStatus` 区分：5xx/网络/中继连不上 → `PROVIDER_UNAVAILABLE`；408/504/中继 504 → `PROVIDER_TIMEOUT`；429 → `RATE_LIMITED`；401/403（含会话失效）→ `PROVIDER_AUTH`；3xx/其他 4xx → `PROVIDER_REJECTED`；输出非 JSON/结构不符 → `PROVIDER_SCHEMA_INVALID`。`pipeline-adapter.ts` 的 `UPSTREAM_ERROR` 按 `retryable` 分 UNAVAILABLE / REJECTED。
- **文案**：`v6/lib/user-messages.ts` 新增各码的中文名与 `PROVIDER_RECOVERY`（下一步）及 `providerRecoveryFor`。`Generation.tsx`：失败标题与阶段行用中文，英文码与 `job.errorMessage` 放进「技术详情」折叠；`recoveryFor` 未知码的兜底句不再提「错误码」。
- 验证：`real-ai/invocations.test.mjs` 22 条（记录数=chat 次数、无正文、失败调用有记录、stub/真实可区分、跨用户不可见、17 种错误场景映射）；worker-v6 10/10；typecheck、build 通过；`--all` 707/707、0 skip。日志 `/tmp/v6-inv-*.log`。

## 安全返修 · 界面（2026-11-13）：案件标题披露 + 访问码长度

- **标题披露**：`PayloadManifest.title` / `titleSent`（runtime 与 `ai.ts` 已落地）在两处共用弹层 `v6/components/GenerationConsentDetails.tsx` 显示为「案件标题」一行，位于处理方信息之后、「涉及材料」之前。
  - `titleSent=true` 且标题非空：以文本节点原样显示标题，并注明「可能作为主题背景随本次请求外发」。React 转义，不按 HTML 渲染；合成测试用 `<b>` 标题验证转义。
  - `titleSent=false`：显示「不外发；标题仅留在本机：<标题>」；标题为 null 时显示「案件标题不外发。」。不用长度或摘要代替具体内容。
  - 无 manifest（尚未建立会话）：显示「未知；建立访问会话后读取本次外发清单。」。
  - 标题变化会使 `payloadManifestHash` 变化，runtime 依既有规则要求重新确认；界面复用同一 `Sheet`，没有新增确认流程。
- **访问码**：服务端 `ACCESS_CODE` 最低 16 字符；两处弹层提示改为「至少 16 个字符」。合成测试使用 16 字符以上的固定假值，不读取或填写真实访问码。
- **退出起草会话**：使用 runtime 已导出的 `endGenerationSession()`（`DELETE /api/v6/session`，同时清空本标签页内存中的授权凭证），未自行实现 runtime client。AI 页服务状态块在 `authenticated === true` 时显示「退出起草会话」，忙碌时禁用并显示「正在退出…」；成功后写提示并 `reload()` 重读 status 与当前视图，失败在块内显示错误，不静默。
  - 文案明确范围：只清除当前浏览器中的起草会话，不删除案件、草稿或授权记录；已复制到其他位置的访问凭证无法在这里吊销（不使用「已吊销/已注销」措辞）。
  - 退出后其他页面的起草面板需在下次挂载或刷新时重新 `resolve` 才能再次真实起草；案件数据不受影响。
- 验证：`alignment-self/generation-consent.test.mjs` 与 `alignment-workbench/generation-consent.test.mjs` 共 17 项通过（含标题外发、标题不外发、空标题、HTML 转义、无 manifest 五种分支）。

## 2026-11-14 G1/G2 修复（run-3 follow-up）

- **新 prop（供 UI 使用）**：`GenerationPanelProps.onConsentRequired?: () => void`。仅在 `start`/`retry` 返回 `CONSENT_REQUIRED` 或 `CONSENT_REVOKED` 时调用；其他错误不调用，`error` 照常显示。导出纯函数 `requiresConsentRecovery(code)` 便于测试。它**不会**申请凭证、不会重发请求。
- **父层接线**：`WorkbenchGeneration`（workbench/GenerationRuntime.tsx）与 `SelfGeneration`（self-service/SelfGeneration.tsx）收到回调后执行 `setRuntime(null); void refresh(true)`：丢弃旧 runtime、重新读取 status/清单并打开外发确认弹层。用户必须再次明确 grant；grant 之后面板以新 runtime 挂载，可对仍为 failed 的原作业重试。若不满足（材料变化）则按 G2 明确提示新建任务。不会强制复用失效授权。
- **G2 retry 分支**（generation.ts `retry`）：处理方 id/版本不同 → `CONSENT_REQUIRED`「处理方配置已变化」；consentId 不同且 `sourceVersion`/`targetConfigVersion`/`figureRevisionId`/`baseDraftRevisionId` 任一变化 → `INPUT_STALE`「材料已变化，请开始新任务。」；仅授权变化 → `CONSENT_REQUIRED`「外发授权已变化，请重新确认后再重试。」
- 测试：`qa/v6/scenarios/real-ai/retry-recovery.test.mjs` 5 条（信号映射、无凭证重试 0 调用后重新授权成功、材料变化 INPUT_STALE、仅授权变化 CONSENT_REQUIRED、处理方变化 CONSENT_REQUIRED）；原有 `V6-17/generation-recovery.test.mjs` A03 仍通过。
- 定向验证：`node --test qa/v6/scenarios/real-ai/*.test.mjs qa/v6/scenarios/V6-17/*.test.mjs qa/v6/scenarios/V6-15/*.test.mjs` = 138/138；typecheck/build 通过。日志 `/tmp/v6-g1g2-targeted.log`、`/tmp/v6-g1g2-typecheck.log`、`/tmp/v6-g1g2-build.log`。未跑全量、未调真实供应商、未改 worker-v6。

## 2026-11-14 安全单测补强

- 新增 `apps/worker-v6/test/security.test.mjs`（5 条）：凭证签名/payload 篡改均 409 且上游 0；凭证过期边界 `exp-1` 有效、`exp` 拒绝；会话 cookie 篡改/改 exp/乱码/过期 → status 未认证、chat 401 且不回显原因或密文；请求 512 KiB / 响应 2 MiB 上限拒绝且不穿透；RATE_LIMIT KV 抛错时 session 与 chat 均 503、上游 0。
- 结果：`npm run test -w @patent/worker-v6` 23/23（`/tmp/v6-sec-worker.log`）；定向 client 回归 138/138（`/tmp/v6-sec-targeted.log`）；typecheck/build/diff-check 通过（`/tmp/v6-sec-typecheck.log`、`/tmp/v6-sec-build.log`）。

## 2026-11-14 G3 UX 收尾（仅呈现/共享面板）

- 只改 `Generation.tsx` 的共享面板，引擎绑定不变：新增 `shouldOfferNewAuthorization(job, engineOptions)` —— 仅当 `job.state==="failed"`、真实模式、当前 `engineOptions.consentId` 非空且与失败作业的 `consentId` 不同时返回 true。
- 该分支：隐藏 `generation-retry`，显示提示 `generation-consent-updated`「授权已更新，请以新授权开始新任务。」与主按钮 `generation-start-new-authorization`「以新授权开始任务」；按钮调用 `actions.start()`（不是 retry），不自动触发；旧失败记录保留。不渲染任何 consent/job id。
- 同授权 429 仍显示 `generation-retry` 并可成功；无 grant（consentId=null）与 stub 模式不出现新授权按钮；材料变化（INPUT_STALE）仍显示 `generation-action-error[data-code=INPUT_STALE]` 与 `generation-start`。
- `WorkbenchGeneration` 与 `SelfGeneration` 无需改：两者已传 `engineOptions={runtime.engineOptions}`，共享面板据此判断。
- 测试：`qa/v6/scenarios/real-ai/consent-updated-ui.test.mjs` 5 条（判定矩阵、授权更新分支无 retry 且无 id、同授权保留 retry、无 grant/stub 不出现、INPUT_STALE 保留新建入口）。定向 real-ai+V6-17+V6-15+V6-16 = 161/161；typecheck/build/diff-check 通过（`/tmp/v6-g3-targeted.log`、`/tmp/v6-g3-typecheck.log`、`/tmp/v6-g3-build.log`）。

### tester 三个分支的 testid

| 分支 | 期望 |
|---|---|
| A 同授权 429 后 | 有 `generation-retry`；无 `generation-consent-updated`；点击后 chat 增加 |
| B 重新授权产生新 consent id | 有 `generation-consent-updated` 与 `generation-start-new-authorization`；**无** `generation-retry`、无 `generation-start`；点击后新作业 chat>0，旧失败记录仍在列表 |
| C 同授权下材料变化后 retry | 点 `generation-retry` 后出现 `generation-action-error[data-code="INPUT_STALE"]` 与 `generation-start`；无 `generation-consent-updated` |
