VERDICT: CHANGES_REQUIRED

# V6-10 round-3 independent review

Independent adversarial review, round 3. I did not write this code. The review was run against the isolated worktree `/private/tmp/patent-v6-worktree` (branch `codex/patent-saas-v6-foundation-origin`, base `cfabceed050930cd1c1d4df517b4f8b844577c70`). I kept the worktree read-only except for this file. All fixtures and probe scripts are under `/tmp/v6-10-r3-probe`; browser output is under `/tmp/v6-10-review3`. I did not run the build or the repository evidence script; I inspected their recorded output instead.

## Result in brief

- Both round-2 blockers are fixed and were independently reproduced as fixed: the 10,000-entry DOCX is accepted with arrayBuffers growth of 0.00-0.01 MiB under forced GC, and every round-2 `.rels` bypass (UTF-16LE/BE BOM, Unicode element prefix, DOCTYPE entity) is refused while genuine internal UTF-16 relationships are still accepted.
- `npm run test:v6 -- V6-10` passes 30/30, 0 skipped, exit 0. `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` exits 0. V6-08 (12/12) and V6-09 (21/21) also pass. The browser driver runs 7/7 steps with exit 0 and no console errors.
- `changedFiles` (26), the baseline manifest hash, the export inventory and the recorded evidence files all check out.
- A new must-fix defect remains: the macro refusal rule (S02 line 9, claimed in the receipt) is bypassed by a DOCX whose `[Content_Types].xml` hides the macro markers in XML character references and a comment. The file is accepted and stored as an available source asset. The receipt's macro claim is therefore overstated. Verdict: CHANGES_REQUIRED.

## Blocker B1: a macro-enabled DOCX is accepted and stored because `[Content_Types].xml` is matched as raw text, not as XML

### Rule and claim

S02 line 9: "按魔数判定类型，扩展名或声明 MIME 不一致返回 `MIME_MISMATCH`；宏、远程关系、路径穿越、加密文档拒绝并说明原因。" Macros must be refused with a reason.

The receipt (`qa/v6/evidence/V6-10/receipt.json` line 97) claims: "Macro markers (vbaProject/macroEnabled/template.macro), remote relationships and EncryptedPackage/EncryptionInfo are refused". The A02 row (line 126) claims "macro / remote-relationship / traversal / encrypted DOCX UNSUPPORTED_MEDIA". Neither the description nor the limitation list discloses that content-type macro detection is a raw-substring test.

### Root cause

`checkContentTypes` in `apps/web/src/v6/features/sources/ingest.ts` (lines 518-526) does:

```ts
if (!/PartName\s*=\s*"\/word\/document\.xml"/i.test(xml) || !xml.includes(DOCUMENT_CONTENT_TYPE)) { ... }
if (/(macroEnabled|vbaProject|ms-word\.template\.macro|ms-word\.document\.macro)/i.test(xml)) { ... }
```

`xml` is the raw decoded string of `[Content_Types].xml`. It is never parsed as XML: comments are not removed, character/predefined entities are not decoded, and the actual mapping for `/word/document.xml` is not inspected. The macro check over entry names and the content-types text is likewise raw. Relationship `Type` values (the standard `.../vbaProject` relationship) are never inspected. As a result, both the "main part carries the document content type" check and the macro check can be satisfied or evaded with standards-valid XML text that a conforming consumer decodes differently.

### Reproduction 1 (decisive, end-to-end)

Fixture `/tmp/v6-10-r3-probe/fixtures/macro-comment-ct.docx`, 1,393 bytes, ZIP entries:

- `[Content_Types].xml`:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<!-- <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/> -->
<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.docu&#109;ent.macro&#69;nabled.main+xml"/>
<Override PartName="/word/data1.bin" ContentType="application/vnd.ms-office.vba&#x50;roject"/>
</Types>
```

- `_rels/.rels`: one officeDocument relationship to `word/document.xml`.
- `word/document.xml`: a minimal `w:document`.
- `word/_rels/document.xml.rels`:

```xml
<Relationship Id="rId7" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="word/data1.bin"/>
```

- `word/data1.bin`: the OLE/CFB magic `d0 cf 11 e0 a1 b1 1a e1` plus 504 zero bytes.

A conforming XML parser ignores the comment and decodes the character references. `python3 -I` with `xml.etree.ElementTree` reads the package as:

```
content-type Overrides parsed from XML (comments ignored):
  /word/document.xml -> application/vnd.ms-word.document.macroEnabled.main+xml
  /word/data1.bin -> application/vnd.ms-office.vbaProject
child relationships parsed from XML:
  rId7 http://schemas.microsoft.com/office/2006/relationships/vbaProject -> word/data1.bin None
```

That is a macro-enabled WordprocessingML main part plus a VBA project part joined by the standard vbaProject relationship. The only "ordinary" content-type strings the checker sees are inside an XML comment.

Results with the real module:

- `classifyFile({bytes, name:"macro-comment-ct.docx", declaredType: DOCX_MIME})` -> accepted.
- Full `ingestFiles` over the real `LocalRepository` and an in-memory `StorageBackend`: outcome `saved`; one asset `{purpose:"source", state:"available", originalName:"macro-comment-ct.docx", byteLength:1393}`; `blobs: 1`; stored bytes byte-identical to the input.

So a macro-enabled document is saved as usable material, with no refusal and no reason. This is exactly what S02 line 9 forbids.

### Reproduction 2 (decoy part, classifyFile only)

Fixture `macro-encoded-main-ct.docx` (1,649 bytes): the main Override is `application/vnd.ms-word.docu&#109;ent.macro&#69;nabled.main+xml`, a decoy `word/other.xml` carries the literal normal document content type, `word/data1.bin` carries `application/vnd.ms-office.vba&#x50;roject`, and the vbaProject relationship targets it. `classifyFile` accepts it. This variant does not rely on a comment, only on the decoy literal string.

### Reproduction 3 (normal main part plus an encoded VBA part)

Fixture `macro-entity-ct.docx` (1,356 bytes): normal main document content type, `word/data1.bin` with `application/vnd.ms-office.vba&#x50;roject`, and the vbaProject relationship. `classifyFile` accepts it. This case does not make the main part macro-enabled, but it shows that the VBA part and relationship are invisible to the checker whenever the content type is entity-encoded and the part name is benign.

### Controls

- `macro-literal-ct.docx` (same structure, literal `application/vnd.ms-office.vbaProject`): refused `UNSUPPORTED_MEDIA` "DOCX 含宏；含 VBA 的文档不能上传。"
- `macro-dup-main-ct.docx` (literal normal CT plus encoded macroEnabled main CT): refused because the raw text still contains `ms-word.document.macro`.
- The existing scenario only covers `word/vbaProject.bin` as an entry name; it does not cover encoded content types, comment decoys or relationship `Type`.

### Why this is a blocker and not a limitation

The rule is explicit in S02, the receipt claims it, and the bypass is the same class of defect as the round-2 `.rels` bypass: raw text matching against content that a conforming XML consumer decodes differently. XML comments and numeric character references are standards-valid; no DTD is involved. The result is a stored, available source asset that is a macro-enabled document. The receipt's "Macro markers ... are refused" and the A02 "macro ... UNSUPPORTED_MEDIA" statements are therefore not true in general, and the limitation list does not disclose the gap.

### Fix direction (no code was changed by this review)

Decode `[Content_Types].xml` as XML before any decision: remove comments/PIs, decode character and predefined entities, build the part-name -> content-type mapping, require the mapping for `/word/document.xml` to be exactly the allowed non-macro WordprocessingML main content type (reject macroEnabled), reject any part content type that decodes to a vbaProject/macro marker, and inspect relationship `Type` values for `/vbaProject`. Add scenario cases for char-ref-encoded content types, a comment-only decoy, and a vbaProject relationship with a benign part name.

## Round-2 blockers re-verified as fixed

### (a) 10,000-entry DOCX memory retention

Independent fixture `ten-thousand.docx` (1,188,311 bytes; 3 base parts plus 9,997 deflated 13-byte parts = 10,000 entries):

- Accepted: `classifyFile` accepted, and 5/5 iterations with `--expose-gc` accepted.
- Memory: `arrayBuffers` 2.15 MiB before -> 2.16 MiB immediately (delta +0.01 MiB), 0.00 MiB after forced GC. Without forced GC a single run measured 3.46 MiB -> 2.16 MiB (delta -1.29 MiB). This is far below the 200 MiB blocker threshold.
- Ordinary small DOCX: `small-deflated.docx` (904 bytes) and the stored-method `small-stored.docx` (1,281 bytes) are accepted.
- Boundary: `ten-thousand-one.docx` (10,001 entries, 1,188,428 bytes) is refused `FILE_TOO_LARGE` "DOCX 含 10001 个条目，上限 10000。"
- Compression: a 20 MiB incompressible entry (`random-20mib.docx`, 20,978,838 bytes) is accepted in 170.1 ms; a 20 MiB zero entry (`big-20mib.docx`, 21,389 bytes) is refused `FILE_TOO_LARGE` "DOCX 压缩比超过 100。"

The round-2 retention defect is fixed: results are copied down to their exact length and only `[Content_Types].xml`/`.rels` parts are retained.

### (b) `.rels` encoding and XML bypasses

All fixtures use real ZIP plumbing written by hand with `zipfile`, not the scenario helpers:

| Fixture | Input | Result |
| --- | --- | --- |
| `rels-utf16le-bom.docx` | `.rels` UTF-16LE with BOM, `Target="https://evil.invalid/document.xml" TargetMode="External"` | refused `UNSUPPORTED_MEDIA` "_rels/.rels 含外部或远程关系。" |
| `rels-utf16be-bom.docx` | same in UTF-16BE with BOM | refused, same code/message |
| `rels-unicode-prefix.docx` | `<é:Relationship ... TargetMode="External">`, UTF-8 | refused, same code/message |
| `rels-doctype-entity.docx` | `<!DOCTYPE Relationships [<!ENTITY ext "External">]>` and `TargetMode="&ext;"` | refused `UNSUPPORTED_MEDIA` "_rels/.rels 含不允许的实体声明。" |
| `rels-utf16le-internal.docx` | UTF-16LE BOM, internal Target, `TargetMode="Internal"` | accepted |
| `rels-utf16be-internal.docx` | UTF-16BE BOM, same | accepted |
| `rels-utf16le-nobom.docx` / `rels-utf16be-nobom.docx` | UTF-16 without BOM | refused `INVALID_INPUT` "_rels/.rels 的编码无法识别。" |
| `rels-lowercase-element.docx` | `<relationship ... TargetMode="External">` lower-case, UTF-8 | accepted (control: XML names are case-sensitive; not the OPC element) |
| `rels-entity-targetmode.docx` | `TargetMode="&#x45;&#x78;ternal"` | refused, remote message |
| `rels-entity-quotes.docx` | `TargetMode=&quot;External&quot;` | refused, remote message |
| `rels-prefixed-attr.docx` | `r:TargetMode="External"` | refused, remote message |
| `rels-nested.docx` | external `https://evil.invalid/doc` in `word/_rels/document.xml.rels` | refused, message names `word/_rels/document.xml.rels` |
| `rels-comment-cdata.docx` | Relationship only inside `<!-- -->` and `<![CDATA[ ]]>` | refused (over-conservative; see N2) |
| `rels-nul.docx` | valid `.rels` plus U+0000 | refused `INVALID_INPUT` |
| `rels-utf32le-bom.docx` | UTF-32LE BOM | refused `INVALID_INPUT` |
| `rels-latin1-prefix.docx` | ISO-8859-1 with `<é:Relationship ... TargetMode="External">` | refused `INVALID_INPUT` |
| `rels-utf16le-declared-utf8.docx` | UTF-16LE BOM, declaration lies `UTF-8` | refused remote message |
| `rels-gt-in-attr.docx` | `Type="x&gt;&gt;y"` and `TargetMode="External"` | refused remote message |
| `rels-whitespace.docx` | element split over lines/tabs | refused remote message |
| `rels-percent-scheme.docx` | `Target="https%3A%2F%2Fevil.invalid%2Fx" TargetMode="External"` | refused remote message (refusal is attributable to TargetMode; it does not isolate percent-decoding) |
| `rels-attr-order.docx` | `TargetMode="External"` before `Target` | refused remote message |
| `rels-pi.docx` | `<?Relationship Target="https://evil.invalid/x" TargetMode="External"?>` | accepted (control: a processing instruction is not an element) |
| `target-no-mode-https.docx` | child rels, `Target="https://evil.invalid/t.dotm"`, no TargetMode | refused remote message |
| `child-parent-customxml.docx` | `word/_rels/document.xml.rels`, customXml Type, `Target="../customXml/item1.xml"` | refused remote message (disclosed limitation 209) |
| `target-no-mode-abs.docx` | child rels, `Target="/etc/passwd"`, no TargetMode | accepted (see N3) |
| `macro-type-benign-name.docx` | child rels, vbaProject Type, `Target="word/data1.bin"`, CFB-magic part, normal main CT | accepted (covered by B1) |

Conclusion for the required round-3 question: no probe let a remote relationship through. Every standards-valid encoding/quoting/prefix variant of an external relationship was refused; the accepted cases are not OPC relationship elements, are package-internal absolute part names, or are the macro gap in B1.

## Other trained invariants re-checked

Probe `probe4.mjs` over the real `LocalRepository`, an in-memory backend with the documented transaction semantics, and the real `ingestFiles`:

- Three-file concurrency: five instrumented files read at once; `maxInFlight: 3`, all five `saved`, five assets.
- Dedupe: two identical picks in one batch -> `saved` + `duplicate`, one asset.
- Atomicity under an injected blob-store put fault: outcome `failed/STORAGE_UNAVAILABLE`, 0 assets, 0 blobs; retry with the fault cleared -> `saved`, 1 asset, 1 blob.
- Refresh: a new repository over the same backend reads the blob back `readOk: true`, `byteIdentical: true`, `digestMatches: true`, and zero activity events.

Also confirmed from the fresh test run and the scenario source:

- No-document action writes nothing (browser step 06 and the scenario; facts placeholder shown).
- The 15-file hostile batch rejects every case with the claimed code and leaves version 1, zero assets, zero blobs, `sourceVersion: 1`; re-picking the same files gives identical codes and still nothing stored.
- The 3-file cap, 50 MiB/8 MiB/16 MP limits, 200 MiB/10,000-entry/ratio-100 archive limits, macro/remote/traversal/encryption refusals (except B1), duplicate detection, `已保存` only for committed outcomes, and retry/cancel behaviour are covered and pass.

## Receipt accuracy checks

- `changedFiles`: `scope.txt` has 28 entries; minus `node_modules` and `.claude/launch.json` is exactly the receipt's 26 entries, with no missing, extra or duplicate paths; every listed file exists. The route and planning files outside the literal ticket write set are the disclosed orchestrator-written sources-tab registration; `git diff cfabcee` shows they mount `Upload`, enable the sources capability and add the layout styles.
- `baselineManifestSha256`: `qa/v6/baseline/manifest.json` hashes to `d7a3fc337285b2ed63e1d6d6d9893e7f5a39da580a871516b1578c0905ccccf4`, matching the receipt.
- Export inventory: the receipt lists 48 exports. The modules expose 29 runtime exports and 19 type-only exports (`export type`/`export interface`), and all 48 exist; no unclaimed runtime export.
- Recorded evidence: `runner.tap` 30 pass; my fresh run matched. `typecheck.txt` claims exit 0; my fresh `tsc` run exited 0 with no output. `build.txt` shows a successful Vite 6.4.3 build (2,179 modules, 2.21 s) with only the pre-existing chunk-size warning; I did not run the build. `regression.txt` shows 15 worker tests and 44 export tests passing with `exit=0`. `browser-log.json` shows 7 steps, `consoleErrors: []`, final blob count 1, matching my fresh browser run.
- Acceptance rows spot-checked: A01's refresh read-back, asset fields and `sourceVersion: 1`; A02's 15-case hostile batch, 10,001-entry and 200 MiB declared-size refusals, and repeat-pick stability; A03's duplicate at the same asset id (`ingest.test.mjs` lines 973-974, 1020-1021), storage-fault version 1/0 assets/0 blobs, retry, partial-batch version 3, and mid-batch cancellation at version 1 - all match the receipt.
- The one overstatement found is the macro claim described in B1; the limitation list does not disclose raw-text content-types validation.

## Non-blocking notes

- N1. A legitimate package-internal sibling reference is refused: `word/_rels/document.xml.rels` with `customXml` Type and `Target="../customXml/item1.xml"` (a real Word customXml pattern) is refused `UNSUPPORTED_MEDIA`. This is disclosed in limitation 209 and is fail-closed, not a bypass. A follow-up could resolve the target relative to its source part and refuse only when it escapes the package.
- N2. A Relationship that exists only in a comment or CDATA causes a refusal (`rels-comment-mention.docx`, `rels-comment-cdata.docx`). Conservative over-refusal, no security effect; stripping comments/CDATA before scanning would avoid it.
- N3. `Target="/etc/passwd"` without TargetMode is accepted. In OPC this is a package-absolute part name, not a URL and not traversal, so it is correct for this ticket; later extractors must still resolve absolute targets inside the package.
- N4. `[Content_Types].xml` in UTF-16LE with BOM is refused as "不是 Word 文档" (`content-types-utf16.docx`). XML/OPC can encode that stream as UTF-16; this is a fail-closed over-refusal not listed in the limitations.
- N5. The compression-ratio test is aggregate (total inflated vs total compressed). The receipt says only "above ratio 100"; a package with one highly compressible part plus stored parts can hit the limit. Conservative and consistent with the S02 limit, but the wording could be more precise.
- N6. The receipt's memory figures (for example "-1.8 MiB") are standalone-probe values that vary with GC; my independent measurement was +0.00 to +0.01 MiB with forced GC. Limitation 211 already caveats the metric, and the direction of the fix is confirmed.
- N7. `interface.exports` mixes runtime and type exports; all 48 claimed exports exist, so this is only a presentation nit.
- N8. Browser step 07 asserts the sources tab starts with an empty upload area, then re-picks the same DOCX and gets `已保存` with one blob. The receipt's "The same holds on the matter's 材料 tab" is accurate in that sense; limitation 206 already discloses that there is no stored-material list after refresh.

## What was independently run

- `npm run test:v6 -- V6-10` -> TAP `1..30`, tests 30, pass 30, fail 0, cancelled 0, skipped 0, todo 0; exit 0.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` -> exit 0, no output.
- `npm run test:v6 -- V6-08` -> tests 12, pass 12, fail 0, skipped 0; exit 0.
- `npm run test:v6 -- V6-09` -> tests 21, suites 1, pass 21, fail 0, skipped 0; exit 0.
- `curl http://127.0.0.1:5174/patent/` -> HTTP 200. `node qa/v6/evidence/V6-10/browser-drive.mjs /tmp/v6-10-review3 http://127.0.0.1:5174` -> `{"ok":true,"failed":[],"errors":[]}`, final state on `/sources` with one saved row and `blobs: 1`.
- Independent fixtures/probes under `/tmp/v6-10-r3-probe` using `zipfile`, `tsx` and the real modules; a Python `zipfile` + `ElementTree` check of the B1 package; scope/baseline/export scripts under the same directory.
- Inspected (not executed): `build.txt`, `typecheck.txt`, `regression.txt`, `runner.tap`, `browser-log.json`, `receipt.json`, `scope.txt`, `browser-drive.mjs`, the scenario tests, `ingest.ts`, `Upload.tsx`, and the ticket/spec/contract text in the main checkout (read-only).

The candidate cannot be accepted while B1 stands: the ticket and the receipt claim macro refusal, but a macro-enabled DOCX is saved. After the content-types check is made XML-aware and the macro/relationship-type cases are added as scenarios, a round 4 review is required.
