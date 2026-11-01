# V6-10 independent review round 2 — 2026-10-31

VERDICT: CHANGES_REQUIRED

Independent read-only reviewer, second round on the fixed candidate. Verified independently: V6-10 28/28, V6-08 12/12, V6-09 21/21, `tsc --noEmit` exit 0; browser driver 7/7 exit 0, no console errors; receipt `changedFiles` 25/25 against scope minus node_modules and `.claude/launch.json`.

Round-1 fixes confirmed sound: the inflater no longer scales quadratically (zeros 1/4/16/32/64 MiB at 1.9/7.2/28.9/56.9/114.9 ms; literal-only 16 MiB 471 ms; exact-cap output passes, cap-1 throws; 100 MiB retained 128 MiB); single-quote and entity-encoded remote relationships are now refused.

## Blockers

1. **OOM from retained 64 KiB views.** `inflateRaw` (`ingest.ts:814`, `:892`, `:902-908`) starts every entry with a 64 KiB buffer and returns `output.subarray(0, length)` — a view that keeps the whole buffer alive — and `checkDocxPackage` stores every view in `inflated` (`:419`). Repro: DOCX with 3 base parts + 9,997 deflated 13-byte parts (10,000 entries, at the permitted limit), archive 1,159 KiB, inflated 127 KiB, is ACCEPTED while `process.memoryUsage().arrayBuffers` rises to ~782.7 MiB (baseline 0; +62.7 MiB per 1,000 entries; the same entries stored with method 0 add 0). That is far past the 200 MiB DOCX inflation budget, and it is reachable within the 50 MiB upload limit.

2. **Remote relationships still bypassed by standards-valid XML.** The `.rels` gate is ACCEPTED for all of:
   - `_rels/.rels` encoded UTF-16LE/BE with BOM and `encoding="UTF-16"`, containing `<Relationship Target="https://evil.invalid/document.xml" TargetMode="External"/>`;
   - `<é:Relationship xmlns:é="…/package/2006/relationships" Target="http://evil.invalid/x" TargetMode="External"/>` (Unicode NCName prefix);
   - `<!DOCTYPE Relationships [<!ENTITY ext "External">]>` with `TargetMode="&ext;"`.

   Python ElementTree parses all three as external relationships; S02 line 9 and 05-contracts line 114 require refusal. The current decoder is non-fatal UTF-8, element names are matched ASCII-only, and only predefined/numeric entities are decoded. Parse the XML properly or reject any part that cannot be fully decoded (DOCTYPE, non-UTF-8/UTF-16 encodings, non-ASCII names).

## Non-blocking notes

- Relationship `Target` values with traversal (`../../../etc/passwd`) and backslash UNC (`\\host\share`) are accepted.
- Triple-encoded schemes and whitespace inside the scheme are accepted (not standards-resolvable; low risk).
- `readBlob` (`ingest.ts:1036-1051`) never checks the abort signal, so cancellation only stops after the whole blob is read.

Fixes and updated evidence required before acceptance. Receipt stays candidate.
