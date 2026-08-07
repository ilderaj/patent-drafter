// Vite browser shim: packages/pipeline imports node:fs/promises for the Node
// promptsDir mode; browsers always use the inline `prompts` map, so these
// imports are never called. This module keeps the bundle browser-safe.
// Stub exports so the browser bundle can link packages/pipeline's node-only
// imports. These are never called: browsers always use the inline `prompts` map.
export const readFile = async () => {
  throw new Error("node:fs/promises is not available in the browser; pass prompts via PipelineOptions.prompts");
};
export const join = (): string => {
  throw new Error("node:path is not available in the browser");
};
