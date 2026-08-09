import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";
import { Button, Card, Field, Input, PageHeader, RadioCardItem, RadioGroup } from "../components/ui";
import { TYPE_HINT, TYPE_LABEL } from "../lib/data";
import type { PatentType } from "../lib/types";

const TYPES: Array<{ id: PatentType; name: string; note: string; disabled?: boolean }> = [
  { id: "utility_model", name: "实用新型", note: TYPE_HINT.utility_model },
  { id: "invention", name: "发明专利", note: TYPE_HINT.invention },
  { id: "other", name: "外观设计等", note: TYPE_HINT.other, disabled: true },
];

export function NewProject() {
  const { createProject } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [type, setType] = useState<PatentType>("utility_model");
  const [domain, setDomain] = useState("");

  const canCreate = name.trim().length > 0;

  return (
    <>
      <PageHeader title="新建项目" sub="先填写基本信息，下一步再上传交底材料" />
      <Card className="stack-5" style={{ maxWidth: 640 }}>
        <Field label="项目名称">
          <Input
            placeholder="例如：一种基于三模通讯的共享热水表"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <div>
          <div className="field-label">专利类型</div>
          <RadioGroup value={type} onValueChange={(v) => setType(v as PatentType)}>
            {TYPES.map((t) => (
              <RadioCardItem
                key={t.id}
                value={t.id}
                disabled={t.disabled}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t.note}</div>
              </RadioCardItem>
            ))}
          </RadioGroup>
        </div>
        <Field label="技术领域（可选，帮助选择规则包）">
          <Input
            placeholder="例如：智慧水表 / 物联网通信"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
        </Field>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => navigate("/projects")}>取消</Button>
          <Button
            disabled={!canCreate}
            onClick={() => {
              const id = createProject(name.trim(), type);
              navigate(`/projects/${id}/upload`);
            }}
          >
            下一步：上传交底材料
          </Button>
        </div>
      </Card>
    </>
  );
}
