import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { Button, Card, PageHeader, Switch } from "../components/ui";
import { confirmPairing, deleteApiKey, fetchStatus, startPairing, storeApiKey } from "../lib/bridge";

export function Settings() {
  const { deleteProject, setBridgeMode } = useStore();
  const [preview, setPreview] = useState(true);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [webResearch, setWebResearch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; configured: boolean } | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresInSecs: number } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void fetchStatus().then((s) => {
      setStatus({ ok: s.bridgeConnected, configured: s.credentialConfigured });
      setBridgeMode(s.bridgeConnected ? "connected" : "none");
    });
  }, [setBridgeMode]);

  const refresh = async () => {
    const s = await fetchStatus();
    setStatus({ ok: s.bridgeConnected, configured: s.credentialConfigured });
    setBridgeMode(s.bridgeConnected ? "connected" : "none");
  };

  return (
    <>
      <PageHeader title="模型与隐私" sub="模型凭据保存在本机系统钥匙串，不经过任何服务器" />
      <div className="stack-5" style={{ maxWidth: 640 }}>
        <Card>
          <div style={{ fontSize: 14, fontWeight: 600 }}>模型来源</div>
          <div className="card pad-4 mt-3" style={{ background: "var(--muted)" }}>
            <div className="row-between">
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>DeepSeek（经本机 Bridge）</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {status === null
                    ? "正在检测本机 Bridge…"
                    : status.ok
                      ? `Bridge 已连接${status.configured ? " · Key 已配置（macOS 钥匙串）" : " · 尚未配置 API Key"}`
                      : "未检测到 Bridge——请先启动本机 Patent Bridge（127.0.0.1:7878）"}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={!status?.ok}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const p = await startPairing();
                    setPairing({ code: p.pairingCode, expiresInSecs: p.expiresInSecs });
                    setBridgeMode("pairing");
                  } catch (e) {
                    setMsg(`配对失败：${(e as Error).message}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "请求中…" : "重新配对"}
              </Button>
            </div>
            {pairing ? (
              <div className="mt-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div style={{ fontSize: 13 }}>
                  配对码：<span className="mono" style={{ letterSpacing: 2, fontWeight: 600 }}>{pairing.code}</span>
                  <span className="muted" style={{ fontSize: 12 }}>（{pairing.expiresInSecs}s 内有效，一次性）</span>
                </div>
                <div className="row mt-2" style={{ justifyContent: "flex-end" }}>
                  <Button
                    size="sm"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await confirmPairing(pairing.code);
                        setPairing(null);
                        setBridgeMode("connected");
                        await refresh();
                      } catch (e) {
                        setMsg(`配对失败：${(e as Error).message}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    确认配对
                  </Button>
                </div>
              </div>
            ) : null}
            {status?.ok && !status.configured ? (
              <div className="mt-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>配置 DeepSeek API Key（仅写入本机钥匙串）</div>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="sk-…"
                    aria-label="DeepSeek API Key"
                    style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                  />
                  <Button
                    size="sm"
                    disabled={busy || keyInput.trim().length < 8}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await storeApiKey(keyInput.trim());
                        setKeyInput("");
                        await refresh();
                        setMsg("Key 已保存到本机钥匙串");
                      } catch (e) {
                        setMsg(`保存失败：${(e as Error).message}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    保存
                  </Button>
                </div>
              </div>
            ) : null}
            {status?.ok && status.configured ? (
              <div className="row-between mt-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <span style={{ fontSize: 13 }}>API Key</span>
                <div className="row" style={{ gap: 12 }}>
                  <span className="mono muted" style={{ fontSize: 12 }}>sk-••••••••••••（已配置）</span>
                  <button
                    className="link-button"
                    style={{ fontSize: 12 }}
                    onClick={async () => {
                      await deleteApiKey();
                      await refresh();
                    }}
                  >
                    删除 Key
                  </button>
                </div>
              </div>
            ) : null}
            {msg ? <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{msg}</div> : null}
          </div>
        </Card>
        <Card>
          <div style={{ fontSize: 14, fontWeight: 600 }}>隐私与数据</div>
          <div className="mt-2">
            <Switch checked={preview} onChange={setPreview} label="每次模型调用前预览将发送内容" />
            <Switch checked={sessionOnly} onChange={setSessionOnly} label="临时会话模式（不保存 Key，关闭后清除）" />
            <Switch checked={webResearch} onChange={setWebResearch} label="互联网补充研究（默认关闭，逐次批准检索词）" />
          </div>
        </Card>
        <Card style={{ borderColor: "var(--destructive)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--destructive)" }}>删除本机数据（不可恢复）</div>
          <p className="muted" style={{ fontSize: 12, margin: "8px 0 16px", lineHeight: 1.7 }}>
            删除全部项目、材料与快照。API Key 需在钥匙串中单独删除。建议先导出 .patentpack 备份。
          </p>
          <Button
            variant="destructive"
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              deleteProject("demo-hot-water-meter");
              localStorage.removeItem("patent-drafter.v1");
              window.location.pathname = "/patent/projects";
              location.reload();
            }}
          >
            {confirmDelete ? "再次点击确认清空全部数据" : "删除本机数据"}
          </Button>
        </Card>
      </div>
    </>
  );
}
