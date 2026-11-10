# Test provenance decision (2026-11-10)

Lead decision for acceptance A08: a local test result may become a real draft revision only when it stays identifiable as test output. It is never treated as an ordinary draft.

## Decision

- `DraftRevision.testOutput?: boolean` is optional. A missing field means an ordinary revision; older rows stay valid without migration.
- New revisions created by `saveRevision`, `restoreRevision` and `adoptInputs` inherit `true` when the base or restored revision carries it. Editing, restoring or adopting new inputs cannot clear the marker.
- The generation revision store (`saveEditedRevision`) reads the base revision and carries the marker forward.
- `GenerationEngineOptions.allowTestAdoption` defaults to `false`. Without it, adopting stub output still returns `CAPABILITY_UNAVAILABLE`.
- Setting `allowTestAdoption: true` with `execution: "provider"` throws, so a real provider path cannot adopt test output.
- Only `LOCAL_TEST_GENERATION_OPTIONS` enables it; it is the same constant the professional workbench and self-service flow pass to the generation engine.
- Test-output revisions keep normal version, snapshot and confirmation-invalidation behaviour. Their check runs, confirmations and approvals bind to the real revision id.

## User-visible marking

- Delivery workspace and Done show a warning that the result is test output, not a formal application draft.
- Export manifests carry `testOutput: true`; generated artifact names are prefixed `测试输出-`; the checklist PDF and its title state that it is test output and not a formal application draft.
- Ordinary exports omit the field instead of writing `false`.

## Recovery

- Encrypted `.patentpack` import re-creates the head revision with `reason: "imported"` and preserves `testOutput: true` when present.
- A malformed `testOutput` value fails validation (`INVALID_RECORD`) instead of importing silently as an ordinary revision.
