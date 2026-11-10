import React from "react";
import { Callout } from "./ui/Feedback.tsx";

export function isTestOutputRevision(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).testOutput === true;
}

export function TestOutputNotice({ revision, testId = "test-output-notice" }: { revision: unknown; testId?: string }) {
  if (!isTestOutputRevision(revision)) return null;
  return <Callout tone="warn" icon="alert" testId={testId}>
    测试输出，仅用于验证流程，不能作为正式申请材料。
  </Callout>;
}
