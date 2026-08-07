// Local DeepSeek stub for cloud-mode E2E (no network, no real key).
// Returns schema-valid canned outputs per pipeline stage so the browser
// pipeline can run end-to-end against the cloud worker.
// Usage: node qa/deepseek-stub.mjs   (listens on 127.0.0.1:8799)
import http from "node:http";

const STAGE_OUTPUTS = {
  extract_invention_facts: {
    facts: [
      {
        id: "f1",
        category: "subject",
        statement: "一种基于三模通讯的共享热水表，包括计量部件与通讯模块",
        status: "source_backed",
        refs: [{ chunkId: "c1", page: 1, quote: "共享热水表" }],
        patentTypeHint: "utility_model",
      },
      {
        id: "f2",
        category: "structure",
        statement: "表体、计量部件、控制单元、三模通讯模块",
        status: "source_backed",
        refs: [{ chunkId: "c1", page: 1 }],
      },
      {
        id: "f3",
        category: "comm_scheme",
        statement: "蓝牙mesh、470MHz 无线、NB-IoT 三种通讯方式",
        status: "source_backed",
        refs: [{ chunkId: "c2", page: 2 }],
      },
      {
        id: "f4",
        category: "effect",
        statement: "集中抄表效率提升、通讯可靠",
        status: "source_backed",
        refs: [{ chunkId: "c3", page: 3 }],
      },
    ],
  },
  detect_conflicts: {
    conflicts: [
      { id: "k1", factAId: "f2", factBId: "f3", kind: "term_mismatch", detail: "NB 与 NB-IoT 表述混杂", resolved: false },
    ],
  },
  assess_readiness: {
    readiness: "partial",
    coverage: 0.8,
    dimensions: [
      { name: "subject", status: "ok", reason: "保护主题明确" },
      { name: "scheme", status: "ok", reason: "三模通讯方案完整" },
      { name: "parameter", status: "gap", reason: "部分参数缺少来源" },
    ],
    gaps: [{ id: "g1", kind: "missing", description: "通讯模块供电与安装结构未描述" }],
  },
  generate_intake_questions: {
    questions: [
      { id: "q1", kind: "missing", factId: "f2", question: "请补充通讯模块与表体的连接安装结构", required: true },
      {
        id: "q2",
        kind: "contradiction",
        factId: "f3",
        question: "NB 与 NB-IoT 是否为同一通讯方式？",
        options: ["是，统一为 NB-IoT", "否，是两种方式"],
        required: true,
      },
    ],
  },
};

const STAGE_IDS = Object.keys(STAGE_OUTPUTS);

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const prompt = (payload.messages ?? []).map((m) => m.content).join("\n");
    const stage = STAGE_IDS.find((id) => prompt.includes(id)) ?? "extract_invention_facts";
    const output = STAGE_OUTPUTS[stage];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "stub-" + stage,
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});

server.listen(8799, "0.0.0.0", () => {
  console.log("[deepseek-stub] listening on http://127.0.0.1:8799");
});
