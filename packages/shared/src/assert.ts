export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`invariant failed: ${message}`);
}

export function neverReachable(value: never, label = "unexpected value"): never {
  throw new Error(`${label}: ${String(value)}`);
}
