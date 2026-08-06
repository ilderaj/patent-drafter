// Spike D: 规则确定性检查原型（无 LLM）
// 用定稿的权利要求树验证：引用合法性 / 树结构 / 摘要字数 / 术语一致性 / 附图标记

// ---- 定稿权利要求（10 条，从 baseline 分析提取）----
const claims = [
  { n: 1, text: "一种基于三模通讯的共享热水表，包括热水表本体，其特征在于，所述热水表本体内设有控制主板，所述控制主板上集成有用于控制热水用水的控制器以及与所述控制器连接的射频通信模块、热水表蓝牙通信模块以及热水表470通信模块，所述控制器通过所述射频通信模块与射频卡片通信连接；多个所述热水表本体的所述控制器之间、所述控制器与用户的远程控制器之间、所述控制器与智能网关之间自组网形成蓝牙mesh网络，使得所述蓝牙mesh网络内的各个控制器、远程控制器之间蓝牙通讯连接；所述控制器还通过所述热水表470通信模块与智能网关连接，所述智能网关与云端服务器通信，所述云端服务器还与所述远程控制器无线通信连接。", refs: [] },
  { n: 2, text: "根据权利要求1所述的基于三模通讯的共享热水表，其特征在于，所述智能网关通过WiFi或4G网络与所述云端服务器无线通信，所述智能网关还与远程控制器无线连接。", refs: [1] },
  { n: 3, text: "根据权利要求1所述的基于三模通讯的共享热水表，其特征在于，所述智能网关包括网关本体，所述网关本体内设有网关控制器及与所述网关控制器连接的网关470通信模块、网关蓝牙mesh通信模块，所述网关470通信模块与所述热水表470通信模块连接并通信，所述网关蓝牙mesh通信模块与所述热水表蓝牙通信模块蓝牙连接并组网。", refs: [1] },
  { n: 4, text: "根据权利要求1-3任一项所述的基于三模通讯的共享热水表，其特征在于，所述控制主板竖向插接于所述热水表本体的壳体上，使得所述热水表本体的上壳与所述控制主板的上部分插接，所述热水表本体的下壳与所述控制主板的下部分插接。", refs: [1,2,3] },
  { n: 5, text: "根据权利要求1-3任一项所述的基于三模通讯的共享热水表，其特征在于，所述热水表本体的长度为87.9mm，其宽度为75.23mm。", refs: [1,2,3] },
  { n: 6, text: "根据权利要求1-3任一项所述的基于三模通讯的共享热水表，其特征在于，所述热水表本体的底部设有内凹的固定位，所述热水表本体通过所述固定位固定于安装位置。", refs: [1,2,3] },
  { n: 7, text: "根据权利要求6所述的基于三模通讯的共享热水表，其特征在于，所述固定位的宽度为35.6mm。", refs: [6] },
  { n: 8, text: "根据权利要求1-3任一项所述的基于三模通讯的共享热水表，其特征在于，所述热水表本体的侧面设有竖向分布的、用于插接所述射频卡片的插卡槽，所述射频通信模块朝向所述插卡槽。", refs: [1,2,3] },
  { n: 9, text: "根据权利要求8所述的基于三模通讯的共享热水表，其特征在于，所述插卡槽的上端开口，其下端设有水通路。", refs: [8] },
  { n: 10, text: "根据权利要求1-3任一项所述的基于三模通讯的共享热水表，其特征在于，所述热水表本体上还设有手动阀门，所述手动阀门位于所述热水表本体的水路上，且所述手动阀门位于所述水路的进水端。", refs: [1,2,3] },
];

const findings = [];
const rules = { passed: 0, failed: 0 };

function check(name, ok, detail) {
  if (ok) rules.passed++; else { rules.failed++; findings.push({ rule: name, detail }); }
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ? "| " + detail : ""}`);
}

// R1: 有且仅有一条独立权利要求（实用新型）
const independents = claims.filter((c) => c.refs.length === 0);
check("UM-CLAIM-IND-001 独立权利要求仅一条且为产品型", independents.length === 1 && !/方法|系统$/.test(independents[0].text.split("，")[0]), `independents=${independents.length}`);

// R2: 引用合法性 —— 引用编号必须存在且在前
for (const c of claims) {
  for (const r of c.refs) {
    const ok = claims.some((p) => p.n === r) && r < c.n;
    check(`CLAIM-REF-001 引用 ${c.n}->${r} 合法`, ok);
  }
}

// R3: 多项从属权利要求不得作为另一项多项从属权利要求的引用基础
// （引用多项的从属权利要求，引用它的权利要求必须单项引用它）
const multiRef = new Set(claims.filter((c) => c.refs.length > 1).map((c) => c.n));
const violations = [];
for (const c of claims) {
  if (c.refs.some((r) => multiRef.has(r)) && c.refs.length !== 1) {
    violations.push(`${c.n}->[${c.refs}]`);
  }
}
check("CLAIM-REF-002 多项从属不得作为另一项多项从属的引用基础", violations.length === 0, violations.join(",") || "ok");

// R4: 摘要字数 ≤ 300
const abstract = "本实用新型公开了智慧共享热水用水领域中的一种基于三模通讯的共享热水表，热水表本体内设有控制主板，控制主板上集成有控制器以及与控制器连接的射频通信模块、热水表蓝牙通信模块以及热水表470通信模块，控制器通过射频通信模块与射频卡片通信连接；多个热水表本体的控制器之间、控制器与用户的远程控制器之间、控制器与智能网关之间自组网；控制器还通过热水表470通信模块与智能网关连接，智能网关与云端服务器通信，云端服务器还与远程控制器无线通信连接。本实用新型通过三种模式实现共享热水表与远程控制终端、智能网关以及其他共享热水表之间的通信，避免出现无法使用、数据传输实时性差等缺陷，数据传输的准确性更高。";
check("COM-SECT-002 摘要 ≤ 300 字", abstract.length <= 300, `len=${abstract.length}`);

// R5: 术语一致性 —— 权利要求与摘要中同一概念用词一致
const termMap = { "热水表470通信模块": ["热水表470通信模块"], "智能网关": ["智能网关"] };
for (const [term, alts] of Object.entries(termMap)) {
  for (const c of claims) {
    if (alts.some((a) => c.text.includes(a))) check(`COM-TERM-001 术语「${term}」在权利要求 ${c.n} 中一致`, c.text.includes(term));
  }
}
check("COM-TERM-001 摘要术语一致", abstract.includes("热水表470通信模块") && abstract.includes("智能网关"));

// R6: 附图标记双向一致（说明书 ↔ 附图）
const specNumerals = ["1"]; // 定稿：热水表本体 1
const figureNumerals = ["1"];
check("COM-REF-001 附图标记双向一致", JSON.stringify(specNumerals) === JSON.stringify(figureNumerals), `spec=${specNumerals} fig=${figureNumerals}`);

// R7: 图号连续
const figures = [1, 2, 3, 4, 5, 6];
check("COM-REF-002 图号连续无缺号", figures.every((f, i) => f === i + 1), `figures=${figures}`);

// R8: 噪声检测（宣传语/页脚模板）
const noisePatterns = [/尽显/, /彻底解决/, /流行时尚/, /100004/, /2011\.2/];
const draftText = claims.map((c) => c.text).join("") + abstract;
const noiseHits = noisePatterns.filter((p) => p.test(draftText));
check("COM-NOISE-001 正文无宣传语/页脚噪声", noiseHits.length === 0, `hits=${noiseHits}`);

// R9: 摘要不得含附图说明与噪声
check("COM-SECT-003 摘要无宣传语", !/尽显|彻底/.test(abstract));

console.log("\n=== SPIKE_D RESULT ===");
console.log(JSON.stringify(rules));
console.log(findings.length ? "FINDINGS: " + JSON.stringify(findings) : "ALL PASS");
