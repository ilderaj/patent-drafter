# V6-10 independent review — 2026-10-31

VERDICT: CHANGES_REQUIRED

Independent read-only reviewer. Verified independently: V6-10 23/23, V6-08 12/12, V6-09 21/21, `tsc --noEmit` exit 0; browser driver 7/7, exit 0, no console errors; persistence invariants sound (one transaction for metadata+bytes, dedupe by sha256+byteLength, four concurrent writers saved, same-bytes race produced one saved + one duplicate, mid-batch abort at 0/1/5/20 ms never left a mismatched state); 已保存 only for committed outcomes; no-document action writes nothing.

## Blockers

1. **Quadratic inflater (time blowup).** `ingest.ts` `inflateRaw`/`ensureCapacity` (~693-786) allocates exactly the needed size and copies the whole buffer per literal/match. Reproduced on valid DOCX fixtures: 64 KiB 9 ms, 128 KiB 797 ms, 256 KiB 3806 ms; deflate zeros 2 MiB 722 ms, 4 MiB 4658 ms (~4.8x per doubling). A permitted 50 MiB upload would freeze the tab for hours, synchronously.
2. **Remote-relationship bypass.** The `_rels` check (~453-466) only matches double-quoted literal attributes. `TargetMode='External' Target='https://evil.invalid/document.xml'`, `TargetMode="&amp;#69;xternal"` and `Target="https&amp;#58;//..."` all pass as docx; only the plain double-quoted form is rejected. S02 requires remote relationships to be rejected.

## Non-blocking notes

- ZIP hardening: `C:/evil.xml`, entry names with NUL and Unix symlink entries are accepted; only `../` is rejected. The receipt says absolute paths are refused — inaccurate.
- Receipt `changedFiles` omits the modified `.planning` progress/task files present in scope.
- A03 claims mid-batch cancellation evidence; scenarios only cover a pre-aborted signal (reviewer's probe confirms the invariant).
- Limitation 3 understates the browser evidence: step 03 performs a real reload with IndexedDB dedupe.
- PDF ≤200-page limit is deferred to parsing; after refresh the UI has no material list, so A01 refresh is repository-level plus reload dedupe.
- A password-protected OLE/CFB DOCX is rejected as MIME_MISMATCH rather than with the encrypted-document reason.
- Bytes are `Uint8Array`, not Blob (inherited V6-06 design, not introduced here).

Fixes and updated evidence required before acceptance. Receipt stays candidate.
