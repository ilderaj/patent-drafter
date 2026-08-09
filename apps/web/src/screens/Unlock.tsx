import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { cloudLogin } from "../lib/bridge";
import { Button, Input } from "../components/ui";

export function Unlock() {
  const { setBridgeMode } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = params.get("next") ?? "/projects";

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await cloudLogin(password);
      setBridgeMode("connected");
      navigate(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="state-screen">
      <div className="state-card">
        <h2>输入访问密码</h2>
        <p>本服务仅向受邀用户开放。密码由服务拥有者提供，解锁后 12 小时内无需重复输入。</p>
        <div className="row mt-4" style={{ gap: 8 }}>
          <Input
            type="password"
            value={password}
            autoFocus
            aria-label="访问密码"
            placeholder="访问密码"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            style={{ flex: 1 }}
          />
          <Button disabled={!password || busy} onClick={() => void submit()}>
            {busy ? "验证中…" : "解锁"}
          </Button>
        </div>
        {error ? (
          <p style={{ color: "var(--destructive)", fontSize: 13, marginTop: 8 }}>{error}</p>
        ) : null}
        <p className="muted" style={{ fontSize: 12, marginTop: 16, lineHeight: 1.7 }}>
          你的交底材料只在本机浏览器中解析；起草时经加密通道发送至模型服务，服务端不保存任何专利内容。
        </p>
      </div>
    </div>
  );
}
