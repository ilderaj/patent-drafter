import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useStore } from "../lib/store";
import { Badge, Button, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui";

const TABS = ["支持矩阵", "一致性", "形式规则"];

export function AuditScreen() {
  const { id } = useParams();
  const { projects, confirmAuditFeature } = useStore();
  const [tab, setTab] = useState("支持矩阵");
  const project = projects.find((p) => p.id === id) ?? null;
  if (!project) return null;
  const audit = project.audit;

  return (
    <>
      <PageHeader title="审校与支持矩阵" sub="三条审校链路：来源支持 · 一致性 · 形式规则" />
      {audit ? (
        <div className="row" style={{ gap: 32, marginBottom: 24 }}>
          <div className="audit-stat"><b>{audit.passed}</b><span>通过检查</span></div>
          <div className="audit-stat"><b>{audit.warnings}</b><span>需关注</span></div>
          <div className="audit-stat"><b>{audit.errors}</b><span>必须处理</span></div>
        </div>
      ) : (
        <div className="card mt-4" style={{ maxWidth: 560, padding: 20 }}>
          <div style={{ fontWeight: 600 }}>暂无审校结果</div>
          <div className="muted mt-2" style={{ fontSize: 13, lineHeight: 1.7 }}>
            该项目尚未生成审校数据。完成起草并运行审校后，此处将生成支持矩阵、一致性检查与形式规则结果；存在无来源特征时，导出门禁会要求先在工作台确认来源。
          </div>
        </div>
      )}
      {audit ? (
        <>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="支持矩阵">
              <table className="matrix-table mt-4">
                <thead>
                  <tr>
                    <th>权利要求特征</th><th>状态</th><th>来源</th><th>位置</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{r.feature}</td>
                      <td>
                        <Badge variant={r.status === "source" ? "ok" : r.status === "user" ? "default" : "err"}>
                          {r.status === "source" ? "材料原文" : r.status === "user" ? "用户确认" : "无来源"}
                        </Badge>
                      </td>
                      <td className="muted">{r.source}</td>
                      <td className="muted">{r.position}</td>
                      <td>
                        {r.status === "none" ? (
                          <Button size="sm" variant="secondary" onClick={() => confirmAuditFeature(project.id, r.feature)}>
                            确认来源
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabsContent>
            <TabsContent value="一致性">
              <AuditChecks checks={audit.checks} projectId={project.id} onConfirm={confirmAuditFeature} />
            </TabsContent>
            <TabsContent value="形式规则">
              <AuditChecks checks={audit.checks} projectId={project.id} onConfirm={confirmAuditFeature} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
      <div className="mt-5 row">
        <Link to={`/projects/${project.id}`} className="btn btn-outline btn-sm">回到工作台</Link>
        <Link to={`/projects/${project.id}/export`} className="btn btn-default btn-sm">去导出</Link>
      </div>
    </>
  );
}

function AuditChecks({
  checks,
  projectId,
  onConfirm,
}: {
  checks: Array<{ icon: "ok" | "warn" | "err"; text: string }>;
  projectId: string;
  onConfirm: (id: string, text: string) => void;
}) {
  return (
    <div className="card mt-4" style={{ maxWidth: 560 }}>
      {checks.map((c, i) => (
        <div className="check-item" key={i} style={{ alignItems: "flex-start" }}>
          <span className={c.icon === "ok" ? "ok" : c.icon === "warn" ? "warn" : "err"} style={{ display: "inline-flex", marginTop: 2 }}>
            {c.icon === "ok" ? <CheckCircle2 size={13} /> : c.icon === "warn" ? <AlertTriangle size={13} /> : <AlertCircle size={13} />}
          </span>
          <span className="grow" style={{ flex: 1 }}>{c.text}</span>
          {c.icon === "err" ? (
            <Button size="sm" variant="secondary" onClick={() => onConfirm(projectId, c.text)}>
              确认已处理
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
