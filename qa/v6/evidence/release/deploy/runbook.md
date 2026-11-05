# patent.paymond.me deployment runbook (R1 static Worker)

Status: prepared, not executed. Deploy only after every precondition below is true.

## Preconditions

1. V6-01–V6-26 all accepted: V6-01's receipt is `qa/v6/baseline/receipt.json`; V6-02–26 receipts are under `qa/v6/evidence/V6-xx/receipt.json`.
2. V6-47a release record exists and its R1 conclusion is candidate-ready; G-RELEASE evidence is recorded and the product owner has authorized this deployment.
3. The hostname decision is settled. `patent.paymond.me` currently resolves (CNAME) to `custom-domains.chatgpt.site`; attaching a Worker custom domain requires removing/replacing that record. Replacing it takes the existing site offline, so it needs explicit approval. Alternative: deploy on another `paymond.me` subdomain. A prepared non-destructive fallback is `wrangler.patent-v6.alt.jsonc`, which uses the new hostname `patent-v6.paymond.me` and leaves the existing record untouched (also requires approval to create the new hostname).
4. This checkout is clean and its HEAD commit is recorded in the deployment evidence.

## Build

```bash
cd apps/web
npm run build:v6-root
```

Expected: `dist/v6/index.html`, `dist/v6/assets/*`, `dist/v6/_headers`, `dist/v6/_redirects`.
The build uses `V6_WEB_BASE=/` and `V6_WEB_OUTDIR=dist/v6`; the router basename follows `BASE_URL`
(default stays `/patent` for the legacy worker).

Record: `git rev-parse HEAD`, sha256 of `dist/v6/index.html`, file count and total bytes of `dist/v6`.

## Deploy (separate Worker, free plan)

Wrangler 4.90 is available at
`/Users/jared/SuperpoweringWithFiles/homepage/node_modules/wrangler/bin/wrangler.js`
(this machine currently reaches Cloudflare only through the local proxy).

```bash
HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 \
node /Users/jared/SuperpoweringWithFiles/homepage/node_modules/wrangler/bin/wrangler.js \
  deploy --config wrangler.patent-v6.jsonc 2>&1 | tee qa/v6/evidence/release/deploy/deploy.log
```

The config deploys worker `patent-v6` (assets-only, no model proxy, no secrets) with
`custom_domain: true` for `patent.paymond.me`. It must not touch `patent-drafter`.

Record from the log: worker version id, upload size, route/custom-domain result.

## Smoke test

```bash
node /tmp/v6-deploy-check/prod-smoke.mjs https://patent.paymond.me qa/v6/evidence/release/deploy
```

Assertions: `/` redirects to `/v6` (302), the V6 entry screen renders, no console errors,
no requests outside `patent.paymond.me`/data:/blob:. Save the screenshot and JSON.

Then manually verify in the browser: create a matter, upload a synthetic DOCX, refresh and confirm
persistence; open matters/inbox; check that no network request carries document text.

## Rollback

- Worker: `wrangler rollback --name patent-v6` (or redeploy the previous recorded commit) restores
  the previous Worker version. A rollback does not change DNS.
- DNS: if the hostname was moved from the existing site, restore the previous record exactly as
  captured before the change; this is a separate manual step requiring the same approval.
- Never modify or roll back `patent-drafter`.

## Evidence to retain

`deploy.log`, `smoke.json`, screenshot, `git rev-parse HEAD`, build hashes, DNS record before/after,
and the V6-47a release record. Update `task_plan.md`/`progress.md` with the deployed version and the
actual result, including anything unverified.
