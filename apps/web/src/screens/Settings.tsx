import { useState } from "react";
import { useStore } from "../lib/store";
import { Button, Card, PageHeader, Switch } from "../components/ui";

export function Settings() {
  const { deleteProject, setBridgeMode } = useStore();
  const [preview, setPreview] = useState(true);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [webResearch, setWebResearch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
                  Key 存于 macOS 钥匙串 · 每次调用前可预览将发送内容
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setBridgeMode("pairing")}>
                重新配对
              </Button>
            </div>
            <div className="row-between mt-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <span style={{ fontSize: 13 }}>API Key</span>
              <span className="mono muted" style={{ fontSize: 12 }}>sk-••••••••••••4f2a（已配置）</span>
            </div>
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
