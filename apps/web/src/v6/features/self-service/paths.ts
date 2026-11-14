import { v6Path, type SelfServiceStep } from "../../routes/navigation.ts";

export function selfServicePath(matterId: string, step: SelfServiceStep): string {
  return v6Path({ kind: "self_service", matterId, step });
}
