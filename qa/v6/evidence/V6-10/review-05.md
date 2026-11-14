VERDICT: ACCEPT

# V6-10 independent review, round 5

Reviewer scope: read-only review of the candidate at
`/private/tmp/patent-v6-worktree` (base `cfabceed050930cd1c1d4df517b4f8b844577c70`).
All probe scripts, fixtures and outputs are under `/tmp/v6-10-r5/`. This file
is the only file the reviewer wrote in the worktree. No network or model calls.

## Blockers

None.

I found no reproducible way to get a file that S02 says must be refused
(wrong type, too large, macro, remote relationship, traversal, encrypted)
accepted and persisted. I found no material false claim in the receipt.

## Round-4 blockers: verification

### B1 (DOCX XML-name prefix bypass): fixed

- Generator: `python3 /tmp/v6-10-r5/scripts/gen_docx.py` and
  `python3 /tmp/v6-10-r5/scripts/gen_docx2.py`. These write independent
  `zipfile` fixtures to `/tmp/v6-10-r5/fixtures/` and record how Python
  ElementTree reads each one.
- Probe: `node /tmp/v6-10-r5/scripts/probe_docx.mjs`. It runs the real
  `classifyFile` and, for anything accepted, the full `ingestFiles` path
  against `LocalRepository` on an in-memory backend. Results are in
  `/tmp/v6-10-r5/results-docx.json`.
- Round-4 decisive shapes rebuilt independently (`remote-child-middot`,
  `macro-carrier-middot`, `macro-default-middot`, prefixes using U+00B7,
  U+0387, combining marks, ZWNJ, U+2040 and astral characters): all refused
  `UNSUPPORTED_MEDIA`. Nothing was persisted (matter version unchanged,
  0 assets, 0 blobs).
- Adjacent attack surface I tried, all refused or failed closed:
  namespace-URI tricks; newlines and tabs inside tags; attributes with no
  value; duplicate attributes (`INVALID_INPUT`); unclosed tags and comments;
  `>` inside quoted values; entity and character references in names (fail
  closed) and in values (decoded twice, then checked); `DOCTYPE`, with or
  without entities; external relationships on customXml, oleObject,
  attachedTemplate and hyperlink; UTF-16LE and UTF-16BE external
  relationships.
- Legitimate shapes I tried were accepted: unusual but valid prefixes,
  internal relationships, UTF-16 internal relationships, ordinary DOCX.
- Result: 52 cases matched the expected outcome. One case was over-refused
  (see N1).

### B2 (encrypted PDF accepted): fixed

- Generators: `python3 /tmp/v6-10-r5/scripts/gen_pdf.py` (pypdf RC4-40 and
  RC4-128, a plain Ghostscript PDF, and synthetic `/Encrypt` spellings), then
  `python3 /tmp/v6-10-r5/scripts/gen_pdf_extra.py`. I also made a genuine
  Ghostscript encrypted PDF with
  `gs -dEncryptionR=3 -dKeyLength=128 -dCompatibilityLevel=1.7`. It uses an
  object stream and an xref stream, and its `/Encrypt 9 0 R` sits in the
  xref-stream dictionary.
- Probe: `node /tmp/v6-10-r5/scripts/probe_pdf.mjs`. Results are in
  `/tmp/v6-10-r5/results-pdf.json`.
- Refused with `UNSUPPORTED_MEDIA`:
  - the repo `encrypted.pdf`
  - pypdf RC4-40 and RC4-128
  - Ghostscript R3-128 (object stream plus xref stream)
  - genuine encrypted files whose only `/Encrypt` token is written as
    `/#45#6e#63#72#79#70#74` or `/Encr#79pt` (pypdf confirms these are still
    encrypted; see `/tmp/v6-10-r5/manifest-pdf-extra.json`)
  - an incremental update that adds `/Encrypt` late in the file, written
    literally or escaped
- Accepted: `normal-text.pdf`, and lowercase `/encrypt` (this is not the
  encryption key).
- One case was accepted: `/tmp/v6-10-r5/fixtures/pdf-syn-encrypt-in-objstm.pdf`,
  where `/Encrypt` appears only inside a Flate-compressed object stream. This
  is not a valid encrypted PDF. The PDF spec requires the encryption
  dictionary reference in the trailer or the xref-stream dictionary, and
  neither can be compressed. The receipt discloses this case, so it is not a
  blocker.

## Rounds 1-3: no regression

`node --expose-gc /tmp/v6-10-r5/scripts/probe_regression.mjs`:

- Inflater: 1, 4 and 16 MiB took 1.91, 6.98 and 26.75 ms. Output was
  byte-correct. A cap one byte short raised `InflateCapError`.
- Archive limits: 10,000 entries accepted; 10,001 entries refused
  `FILE_TOO_LARGE`; a 20 MiB zero-filled part (compression ratio bomb)
  refused `FILE_TOO_LARGE`.
- Memory: `arrayBuffers` grew by 0.00 MiB around `classifyFile`, both right
  after the call and after GC.
- Save and reload: asset `purpose: source`, `state: available`; stored bytes
  identical to the input; sha256 matches; a reopened repository reads the
  asset back; a second upload returns `duplicate` with the same asset id and
  adds no asset or blob.
- Atomicity: an injected blob-put failure gives `STORAGE_UNAVAILABLE`. After
  the failure the matter is still version 1 with 0 assets and 0 blobs. A
  retry saves exactly once.
- Earlier-round DOCX fixtures (`gen_docx2.py`):
  - refused: TargetMode via entity and quote tricks; prefixed TargetMode;
    attribute-order variants; percent-encoded scheme; traversal; invalid
    UTF-8; NUL; UTF-32 BOM; all round-3 macro content-type fixtures (comment
    decoy, encoded macro main part, encoded and literal VBA part, duplicate
    main Overrides, VBA relationship type)
  - accepted: UTF-16LE content types

## Ticket, spec and receipt checks

- `TMPDIR=/tmp/v6-10-r5/tmp npm run test:v6 -- V6-10` (output in /tmp):
  exit 0, 36 tests, 36 pass, 0 fail, 0 skipped, 0 todo. This matches the
  recorded `runner.tap`.
- `node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false`:
  exit 0 (`/tmp/v6-10-r5/typecheck.txt`).
- Scope: `node /tmp/v6-10-r5/scripts/scope.mjs` compares
  `/usr/bin/git status --porcelain --untracked-files=all`, minus
  `node_modules` and `.claude/launch.json`, with the receipt. Result: 30 of 30
  match, nothing missing, nothing extra, no duplicates. The five files outside
  the ticket write set are the three orchestrator-owned route registration
  files (`V6App.tsx`, `navigation.ts`, `v6.css`) and two `.planning/` files.
  Both kinds are permitted.
- `node /tmp/v6-10-r5/scripts/receipt-check.mjs`: the baseline manifest
  sha256 matches `d7a3fc33...ccccf4`. All 48 declared exports exist, and
  there are no undeclared exports. The browser log has 7 steps and no console
  errors.
- Acceptance criteria:
  - V6-10-A01 (valid DOCX saved and still readable after refresh): met.
  - V6-10-A02 (over-limit, fake extension and duplicate clicks leave no
    usable fake material): met.
  - V6-10-A03 (refresh and retry stay consistent, no duplicate side effects):
    met.
  - The S02 coverage claims (A01 covered, A02 partial, A03 covered, A04-A10
    not applicable) are honest. Page-count limits and the Blob storage form
    are disclosed as deferred or differing.

## Non-blocking notes

- N1. A DOCX that declares the normal main-part content type only through
  `<Default Extension="xml">` (no Override) is refused
  (`/tmp/v6-10-r5/fixtures/main-default-only.docx`). This is valid OPC, so it
  is an over-refusal. It was disclosed in round 3.
- N2. Other conservative refusals: a `Relationship` element in a foreign
  namespace, `DOCTYPE` with no entity (disclosed), and `.RELS` in uppercase
  (scanned anyway). None of these lets a hostile file through.
- N3. The PDF check is a raw token scan. A comment-only `/Encrypt` is refused
  (a disclosed false positive). `/Encrypt` placed only inside a compressed
  object stream is not seen, but that placement is not real encryption
  (disclosed).
- N4. Embedded OLE payloads are not inspected for macros. The receipt makes
  no claim that they are. External OLE relationships are refused.
- N5. The receipt wording about U+0387 is loose, but the file is refused as
  required.
- N6. The receipt says the reviewer's eight review-04 DOCX fixtures were
  re-run. Those fixtures are not in the repo, so I cannot reproduce that
  exact claim. My independent rebuilds of the decisive cases are all refused,
  and the suite's 18 prefix variants cover the same shapes. I do not treat
  this as a material claim.
- N7. I did not rerun the browser flow. I checked the recorded
  `browser-log.json` (7 steps, no console errors) for plausibility only.
