import React from "react";

export function isTestOutputRevision(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).testOutput === true;
}

export function TestOutputNotice({ revision, testId = "test-output-notice" }: { revision: unknown; testId?: string }) {
  if (!isTestOutputRevision(revision)) return null;
  return <div className="notice v6-test-output" role="status" data-testid={testId}>
    测试输出，仅用于验证流程，不能作为正式申请材料。
  </div>;
}
