import { useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button } from "../components/ui";

export function NoBridge() {
  const { setBridgeMode } = useStore();
  const navigate = useNavigate();
  return (
    <div className="state-screen">
      <div className="state-card">
        <div className="big-ic">⌁</div>
        <h2>需要本机安全服务才能继续</h2>
        <p>
          Patent Bridge 用于安全保存模型凭据、在本机解析专利材料并调用 DeepSeek。
          未安装时，上传、生成与导出功能不可用。
        </p>
        <div className="steps">
          <div className="step"><span className="no">1</span>下载并安装 Patent Bridge（macOS / Windows / Linux）</div>
          <div className="step"><span className="no">2</span>在 Bridge 中录入你的 DeepSeek API Key（存入系统钥匙串）</div>
          <div className="step"><span className="no">3</span>输入配对码完成连接，即可开始使用</div>
        </div>
        <div className="row mt-5" style={{ justifyContent: "center" }}>
          <Button onClick={() => { setBridgeMode("pairing"); navigate("/pairing"); }}>开始配对</Button>
          <Button variant="ghost" onClick={() => navigate("/projects")}>先浏览示例项目</Button>
        </div>
      </div>
    </div>
  );
}

export function ModelError() {
  const { setBridgeMode } = useStore();
  const navigate = useNavigate();
  return (
    <div className="state-screen">
      <div className="state-card">
        <div className="big-ic" style={{ color: "var(--destructive)" }}>!</div>
        <h2>模型调用失败</h2>
        <p>
          DeepSeek 返回错误：额度不足或网络不可达（错误码 402）。
          你的本地草稿与历史未受影响，可以继续编辑。
        </p>
        <div className="row mt-5" style={{ justifyContent: "center" }}>
          <Button variant="secondary" onClick={() => navigate("/projects")}>继续本地编辑</Button>
          <Button
            onClick={() => {
              setBridgeMode("pairing");
              navigate("/pairing");
            }}
          >
            检查 Bridge 连接
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Pairing() {
  const { setBridgeMode } = useStore();
  const navigate = useNavigate();
  const digits = ["8", "2", "6", "4", "1", "9"];
  return (
    <div className="state-screen">
      <div className="state-card">
        <h2>连接本机 Bridge</h2>
        <p>打开本机 Patent Bridge，在其中输入以下一次性配对码，或点击「打开 Bridge」自动配对。</p>
        <div className="pair-code">
          {digits.map((d, i) => (
            <span className="digit" key={i}>{d}</span>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>配对码 10 分钟内有效，仅用于本次连接</p>
        <div className="row mt-5" style={{ justifyContent: "center" }}>
          <Button onClick={() => { setBridgeMode("connected"); navigate("/projects"); }}>
            我已输入配对码
          </Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>取消</Button>
        </div>
      </div>
    </div>
  );
}
