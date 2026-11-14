/**
 * Acceptance-only entry for `wrangler dev --local`.
 *
 * It runs the unmodified apps/worker-v6 `createWorker` and changes exactly one thing:
 * the upstream fetch. The deployed worker requires an https MODEL_BASE_URL; locally
 * the synthetic upstream is plain http on loopback, so this wrapper maps the
 * placeholder https host to ACCEPT_UPSTREAM_ORIGIN and refuses every other host.
 * Never deployed; not part of the product.
 */
import { createWorker, type Env } from "../../../apps/worker-v6/src/index.ts";

const PLACEHOLDER_HOST = "fake-upstream.acceptance.invalid";

interface AcceptEnv extends Env { ACCEPT_UPSTREAM_ORIGIN?: string; ACCEPT_REDIRECT_WORKAROUND?: string }

export default {
  fetch(request: Request, env: AcceptEnv): Promise<Response> {
    const origin = env.ACCEPT_UPSTREAM_ORIGIN;
    const fetchImpl: typeof fetch = async (input, init) => {
      const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
      if (!origin || target.hostname !== PLACEHOLDER_HOST || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
        throw new TypeError("acceptance wrapper: unexpected upstream");
      }
      // DRY-RUN ONLY (accept-env.mjs --redirect-workaround): workerd rejects `redirect: "error"`.
      // Formal acceptance runs without it so the product code is exercised as shipped.
      const patched = env.ACCEPT_REDIRECT_WORKAROUND === "1" && init?.redirect === "error" ? { ...init, redirect: "manual" as const } : init;
      try {
        return await fetch(`${origin}${target.pathname}`, patched);
      } catch (error) {
        // Diagnostics only: error class/message, never request or response content.
        console.error(`acceptance wrapper: upstream fetch failed: ${(error as Error)?.name}: ${(error as Error)?.message}`);
        throw error;
      }
    };
    return createWorker(env, { fetchImpl, now: Date.now }).fetch(request);
  },
};
