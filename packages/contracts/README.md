# @patent/contracts

`contractVersion = "v6.1"` 的共享数据契约包：Zod schema、导出类型、请求/响应 fixture。实现来源为
[docs/implementation/patent-saas-v6/05-contracts.md](../../docs/implementation/patent-saas-v6/05-contracts.md)，
本包是该文档的可执行形式，不引入存储、网络或运行时副作用。

## 边界

- 只有 schema 与纯函数校验；没有数据库、文件、网络、时钟或随机数。
- 对象一律 strict：未知字段被拒绝，缺失字段不会被默认值填补。
- 跨字段约束只实现契约明文写出的规则（引用、编号、互斥、门禁原因等）；业务状态机由 `packages/domain` 的后续票实现。
- `ID` 为 UUID；`Sha256` 为小写 64 位十六进制；`ISODateTime` 为 UTC RFC3339；`LocalDate` 为真实日历日期。
- 持久对象版本从 1 开始；命令的 `expectedVersion` 允许 0（创建）。

## 运行环境

测试与下游票通过 Node 的类型擦除直接加载 `src/*.ts`（Node ≥ 22.18 或 ≥ 23.6），因此源码只用可擦除语法
（`erasableSyntaxOnly`），不使用 enum、namespace 或参数属性；类型检查统一走 `tsc --noEmit`。

## 出口
- `src/primitives.ts`：公共标量、枚举、`SnapshotRef`、命令/结果信封、`ApiError`、`ErrorCode` 与 HTTP 映射、`SessionDTO`、`Preference`。
- `src/matter.ts` … `src/privacy.ts`：05-contracts 第 3–8、11 节的实体。
- `src/fixtures.ts`：确定性的合成 fixture 与 `entitySchemas` 注册表，供下游票与测试复用。
- `src/index.ts`：包的唯一 barrel。

## 契约细化

- 05-contracts §10 的 `502/504` 一行同时列出多个错误码。本包固定 `PROVIDER_TIMEOUT` 为 504，其余该行错误码为 502，`httpStatusForErrorCode` 是唯一映射来源。
- `ApiError.reasons[].code` 按 §6 的说明取 `ErrorCode`（`reasons.code` 一律取自 §10），而不是任意字符串。
- V6-03 冻结 `Activity.metadata` 的逐 action 白名单。S06 §7 要求按 action 限定 key，但未列明矩阵；本票采用保守默认值，定义见 `src/records.ts` 的 `ACTIVITY_METADATA_KEYS_BY_ACTION`。每个 action 仅允许矩阵列出的键，空列表表示 metadata 必须为空。扩展某行须修改共享契约并补充拒绝越权键的测试。
- Activity metadata 只保存短小操作事实：非负整数版本/计数、受限字符集 stage、provider/model 标识和已登记 `ErrorCode`。`job.succeeded` 与 `job.adopted` 必须同时携带非空 provider/model 标识，以满足 S06-A06；其他 action 按矩阵逐键校验。禁止自由文本原因、错误消息、请求或内容正文、秘密、付款金额、联系信息、同意范围及清单。`privacy.export` 与 `privacy.delete` 不记录 metadata。
