/**
 * V6-26 public interface.
 *
 * Domain (deep module):
 *   createRecoveryPackage(repository, actor, matterId, { passphrase, access })
 *   validateRecoveryPackage(repository, actor, bytes, passphrase)
 *   commitRecoveryImport(repository, actor, validationId)
 *   readRecoveryValidation(repository, actor, validationId)
 *   readRecoveredDraft(repository, actor, matterId, targetId)
 *
 * UI:
 *   <Recovery repository actor sourceMatterId? initialPassphrase? now? />
 *
 * The package is a `recovery.v1` JSON payload inside the authenticated
 * patentpack envelope. `access` is local_unmetered, preview (C10 PreviewDTO
 * scope) or full. `validateRecoveryPackage` is the only dry-run; it persists a
 * reusable validationId. `commitRecoveryImport` is the only write that creates
 * a case, is atomic across the matter, events, asset bytes and feature rows,
 * and replays the one committed matter for the same validationId.
 */
export * from "./recovery.ts";
export { Recovery, RecoveryReport, default } from "./Recovery.tsx";
export type { RecoveryProps } from "./Recovery.tsx";
