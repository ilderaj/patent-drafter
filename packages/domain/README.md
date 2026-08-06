# @patent/domain

核心领域模型（与 `docs/data-model.md` 同步）。

- 实体：PatentProject / SourceAsset / SourceChunk / SourceRef / Fact / FactConflict / IntakeQuestion / UserAnswer / PatentStrategy / Claim / ClaimFeature / DraftSection / FigureSpec / ReferenceNumeral / AuditFinding / Snapshot / GenerationRun
- 事实状态机：source_backed → user_confirmed / external_context / unsupported
- 硬规则：unsupported 禁止导出；external_context 不自动成为发明特征

类型检查：

```bash
npx tsc --noEmit -p packages/domain
```
