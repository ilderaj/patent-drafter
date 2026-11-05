import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();

const [React, ReactDomServer, doneUi, v624] = await Promise.all([
  import("react"),
  import("react-dom/server"),
  import("../../../../apps/web/src/v6/features/delivery/Done.tsx"),
  import("../V6-24/harness.mjs"),
]);

const PNG_1PX = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

function render(route, extra = {}) {
  return ReactDomServer.renderToStaticMarkup(React.createElement(doneUi.DoneHeader, { route, ...extra }));
}

test("S08-A08: CN completion copy points to official client and never claims submission", () => {
  const markup = render("cn_um");
  assert.match(markup, /官方客户端/);
  assert.match(markup, /产品不代为提交/);
  assert.match(markup, /申请准备材料/);
  assert.doesNotMatch(markup, /已提交/);
});

test("S08-A08: PCT completion copy offers translation and qualified-person next steps without CN XML copy", () => {
  const markup = render("pct");
  assert.match(markup, /专业翻译/);
  assert.match(markup, /适格人员/);
  assert.match(markup, /产品不代为提交/);
  assert.doesNotMatch(markup, /中国实用新型|官方客户端|已提交/);
});

test("done page renders real file metadata and XML unavailability without placeholders", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const loading = ReactDomServer.renderToStaticMarkup(React.createElement(doneUi.Done, {
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    initialPassphrase: "synthetic-v6-25-passphrase",
    now: () => v624.T0,
    renderReport: async () => [PNG_1PX],
  }));
  assert.match(loading, /正在读取当前案件/);
  assert.doesNotMatch(loading, /将生成/);
  assert.doesNotMatch(loading, /已提交/);
});

test("DoneView renders real file size, hash prefix and unavailable reason without fake files", () => {
  const hash = "0123456789abcdef".repeat(4);
  const state = {
    phase: "ready",
    snapshot: null,
    inputStale: false,
    gate: { action: "export", allowed: true, evaluatedAt: v624.T0, reasons: [] },
    record: null,
    files: [
      {
        id: "file-1",
        name: "权利要求书.docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: 4096,
        sha256: hash,
        status: "ready",
        unavailableReasons: [],
      },
      {
        id: "file-2",
        name: "提交检查清单.pdf",
        mime: "application/pdf",
        bytes: 0,
        sha256: "",
        status: "unavailable",
        unavailableReasons: [{ code: "MISSING_BYTES", resourceId: "合成附图" }],
      },
    ],
    unavailableFormats: [{ format: "xml", code: "FORMAT_UNAVAILABLE", reason: "G-XML closed; no XML file exists." }],
    error: null,
  };
  const markup = ReactDomServer.renderToStaticMarkup(React.createElement(doneUi.DoneView, {
    route: "cn_invention",
    state,
    passphrase: "",
    busy: false,
    actionError: null,
    onPassphrase() {},
    onRefresh() {},
    onCreate() {},
    onDownload() {},
  }));
  assert.match(markup, /权利要求书.docx/);
  assert.match(markup, /4096 bytes · SHA-256 0123456789ab · 可下载/);
  assert.match(markup, /MISSING_BYTES · 合成附图/);
  assert.match(markup, /FORMAT_UNAVAILABLE/);
  assert.match(markup, /xml/i);
  assert.doesNotMatch(markup, /将生成/);
  assert.doesNotMatch(markup, /已提交/);
  assert.equal((markup.match(/>下载<\/button>/g) ?? []).length, 1, "only the ready file offers a download");
});

test("gate reasons link to the tab that resolves them", () => {
  const snapshot = {
    matterId: "33333333-3333-4333-8333-333333333333",
    targetId: "44444444-4444-4444-8444-444444444444",
    sourceVersion: 1,
    targetConfigVersion: 1,
    draftRevisionId: "55555555-5555-4555-8555-555555555555",
    figureRevisionId: "66666666-6666-4666-8666-666666666666",
  };
  const markup = ReactDomServer.renderToStaticMarkup(React.createElement(doneUi.DoneView, {
    route: "cn_invention",
    state: {
      phase: "blocked",
      snapshot,
      inputStale: false,
      gate: { action: "export", allowed: false, evaluatedAt: v624.T0, reasons: [{ code: "CHECK_REQUIRED", resourceId: "check-1" }] },
      record: null,
      files: [],
      unavailableFormats: [{ format: "xml", code: "FORMAT_UNAVAILABLE", reason: "G-XML closed." }],
      error: null,
    },
    passphrase: "",
    busy: false,
    actionError: null,
    onPassphrase() {},
    onRefresh() {},
    onCreate() {},
    onDownload() {},
  }));
  assert.match(markup, /CHECK_REQUIRED/);
  assert.match(markup, new RegExp(`/v6/matters/${snapshot.matterId}/targets/${snapshot.targetId}/check`));
  assert.match(markup, /去处理/);
});
