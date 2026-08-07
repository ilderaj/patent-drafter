import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { Button, Card, PageHeader, Switch } from "../components/ui";
import {
  cloudLogin,
  confirmPairing,
  deleteApiKey,
  fetchStatus,
  revokeSession,
  startPairing,
  storeApiKey,
  type BridgeStatus,
} from "../lib/bridge";

export function Settings() {
  const { deleteProject, setBridgeMode } = useStore();
  const [preview, setPreview] = useState(true);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [webResearch, setWebResearch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresInSecs: number } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void fetchStatus().then((s) => {
      setStatus(s);
      setBridgeMode(s.bridgeConnected && s.authenticated ? "connected" : s.bridgeConnected ? "pairing" : "none");
    });
  }, [setBridgeMode]);

  const refresh = async () => {
    const s = await fetchStatus();
    setStatus(s);
    setBridgeMode(s.bridgeConnected && s.authenticated ? "connected" : s.bridgeConnected ? "pairing" : "none");
  };

  const isCloud = status?.mode === "cloud";

  return (
    <>
      <PageHeader
        title="模型与隐私"
        sub={
          isCloud
            ? "云端模式：DeepSeek Key 托管于服务端加密存储；材料经加密通道转发至 DeepSeek，服务端不保存任何专利内容"
            : "本机模式：模型凭据保存在本机系统钥匙串，不经过任何服务器"
        }
      />
      <div className="stack-5" style={{ maxWidth: 640 }}>
        <Card>
          <div style={{ fontSize: 14, fontWeight: 600 }}>模型来源</div>
          <div className="card pad-4 mt-3" style={{ background: "var(--muted)" }}>
            <div className="row-between">
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>
                  {isCloud ? "DeepSeek（云端安全通道）" : "DeepSeek（经本机 Bridge）"}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {status === null
                    ? "正在检测模型通道…"
                    : !status.bridgeConnected
                      ? isCloud
                        ? "云端服务不可达——请稍后再试"
                        : "未检测到 Bridge——请先启动本机 Patent Bridge（127.0.0.1:7878）"
                      : status.authenticated
                        ? isCloud
                          ? "云端已连接 · 已解锁（会话 12 小时有效）"
                          : `Bridge 已连接${status.credentialConfigured ? " · Key 已配置（macOS 钥匙串）" : " · 尚未配置 API Key"}`
                        : isCloud
                          ? "云端已连接 · 尚未解锁"
                          : "Bridge 已连接 · 尚未配对"}
                </div>
              </div>
              {isCloud ? (
                status.authenticated ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      await revokeSession();
                      await refresh();
                    }}
                  >
                    锁定
                  </Button>
                ) : null
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!status?.bridgeConnected}
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
              )}
            </div>
            {isCloud && status && status.bridgeConnected && !status.authenticated ? (
              <div className="mt-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>输入访问密码解锁（由服务拥有者提供）</div>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && passwordInput) {
                        setBusy(true);
                        cloudLogin(passwordInput)
                          .then(async () => {
                            setPasswordInput("");
                            setMsg("已解锁");
                            await refresh();
                          })
                          .catch((err) => setMsg(`解锁失败：${(err as Error).message}`))
                          .finally(() => setBusy(false));
                      }
                    }}
                    placeholder="访问密码"
                    aria-label="访问密码"
                    style={{ flex: 1, fontSize: 13, padding: "6px 10px" }}
                  />
                  <Button
                    size="sm"
                    disabled={busy || !passwordInput}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await cloudLogin(passwordInput);
                        setPasswordInput("");
                        setMsg("已解锁");
                        await refresh();
                      } catch (e) {
                        setMsg(`解锁失败：${(e as Error).message}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    解锁
                  </Button>
                </div>
              </div>
            ) : null}
            {!isCloud && pairing ? (
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
            {!isCloud && status?.bridgeConnected && status.authenticated && !status.credentialConfigured ? (
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
            {!isCloud && status?.bridgeConnected && status.credentialConfigured ? (
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
            {isCloud && status?.authenticated ? (
              <div className="mt-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  DeepSeek Key 由服务拥有者在云端托管；你的浏览器只持有 12 小时有效的访问会话。
                </span>
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
