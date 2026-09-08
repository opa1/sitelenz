# SiteLenz

SiteLenz is a pay-per-request Website Intelligence API. Ten `/v1/analyze/*` endpoints each accept a URL behind a single x402 micropayment on Algorand, then asynchronously crawl and analyze the target and return structured JSON - individually (technology, SEO, security, business, performance, UX/accessibility, screenshots, AI summary) or as a composite report (`standard`, `full`) covering technology stack, SEO, security headers, performance metrics, business signals, UX observations, and an AI-generated interpretation via Groq - delivered through a webhook or retrievable by polling.

Built for the [Algorand Global x402 Challenge](https://algorand.co/global-x402-challenge).

---

## How It Works

1. A client discovers what's available via `GET /v1/analyze` (or `GET /.well-known/x402` for the x402 Bazaar manifest) - both list all ten endpoints with their current price and description.
2. The client sends `POST /v1/analyze/{endpoint}` with `{ url, webhookUrl? }` - the same shape for all ten endpoints.
3. For a URL-crawling endpoint, the URL is validated first - protocol allowlist, DNS resolution, and rejection of private/reserved/loopback addresses (SSRF protection) - before any payment is enforced, so an invalid or unsafe URL never charges the caller.
4. The request must carry a `PAYMENT-SIGNATURE` header. If it is missing or invalid, the API responds `402 Payment Required` with the x402 payment requirements: an Algorand `exact`-scheme USDC transfer, priced per endpoint (`GET /v1/analyze/{endpoint}` returns the same 402 challenge with no side effects, for the x402 Doctor / Bazaar crawler to probe).
5. The client signs the required USDC transfer (via any x402-compatible Algorand client, such as `@x402/core` + `@x402/avm`) and retries the same request with the `PAYMENT-SIGNATURE` header attached.
6. The x402 guard verifies and settles the payment against the GoPlausible facilitator. Once settled, a job is enqueued on that endpoint's own BullMQ queue under a generated `sl_aj_*` analyze-job id, and the request returns `200` immediately with `status: "queued"`.
7. Before doing any work, the worker checks the crawl cache (`CrawlObservation`, keyed by normalized URL + crawl type, TTL-bound): lightweight endpoints (technology/seo/security/business) accept either a cached `lightweight` (plain HTTP fetch) or `full` (Playwright) observation; heavy endpoints (performance/ux-accessibility/screenshots/ai-summary/standard/full) require a `full` one. A prior heavy-endpoint crawl of the same URL therefore speeds up a subsequent lightweight call on it too, and repeat heavy/composite calls within the TTL skip re-launching a browser session entirely.
8. On a cache miss, a lightweight job does a plain HTTP fetch + Cheerio parse (no browser); a heavy job launches a shared Playwright browser context, runs a Lighthouse audit, and (for `screenshots`/`standard`/`full`) captures and uploads a desktop screenshot (plus a mobile screenshot for `screenshots`/`full`) to Cloudinary.
9. Individual endpoints run their one analyzer over the observations; `ai-summary`/`standard`/`full` run all six (Technology, SEO, Security, Performance, Business, UX) in sequence, `full` in deep mode.
10. `ai-summary`, `standard`, and `full` send the condensed analyzer output to Groq for AI interpretation (summary, strengths/weaknesses, notable findings, recommendations) - `ai-summary` returns just that interpretation, `standard`/`full` bundle it alongside the full analyzer output. If the AI call fails, a fallback stub is stored instead of failing the whole job.
11. The result is persisted on the job and its status flips to `completed`. If a `webhookUrl` was supplied, an HMAC-signed webhook is enqueued for delivery (with automatic retries); regardless, the result becomes retrievable via `GET /v1/analyze/{endpoint}/:id/result`. A `failed` job can be re-queued via `POST /v1/analyze/{endpoint}/:id/retry`.

---

## Endpoints & Pricing

| Endpoint | Price | Crawl | What it returns |
|---|---|---|---|
| `technology` | $0.01 | lightweight | Framework/CMS/CDN/analytics/payments/CSS-framework/font detection with confidence scores |
| `seo` | $0.01 | lightweight | Title, meta description, canonical, robots directives, Open Graph, Twitter Card, headings, image alt coverage, structured data, Lighthouse SEO score |
| `security` | $0.01 | lightweight | HTTPS/mixed-content check, security headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy), security score |
| `business` | $0.01 | lightweight | Business identity, contact/support/pricing signals, CTA detection, business model signals (SaaS/e-commerce/marketplace) |
| `performance` | $0.02 | heavy (Playwright + Lighthouse) | Core Web Vitals (LCP, CLS, FCP, TBT, TTFB), page weight, resource inventory, third-party domain analysis |
| `ux-accessibility` | $0.01 | heavy | Viewport config, navigation, forms, CTA presence, content/hero detection, mobile UX, reading experience, Lighthouse accessibility audit |
| `screenshots` | $0.01 | heavy | Desktop (1280x720) + mobile (390x844) viewport screenshots, uploaded to Cloudinary |
| `ai-summary` | $0.05 | heavy, all 6 analyzers | Crawls the URL, runs all six analyzers internally, and returns just the AI-generated summary/strengths/weaknesses/recommendations (not the analyzer sections themselves) |
| `standard` | $0.40 | heavy, all 6 analyzers | Full report: all six analyzers (non-deep), a desktop screenshot, and an AI interpretation |
| `full` | $0.80 | heavy, all 6 analyzers (deep) | Everything in `standard`, plus deep-mode signals on every analyzer (JS dependency tree, robots.txt/sitemap/hreflang, TLS/cookie audit, resource inventory/third-party analysis, nav/footer/pricing extraction), a mobile screenshot, and an expanded AI interpretation |

Prices are set via env vars (see [Environment Variables](#environment-variables)) and can change without a code deploy - just update the var and restart.

---

## API Reference

Every `/v1/analyze/{endpoint}` route (all ten) follows the same four-route pattern:

- **`POST /v1/analyze/{endpoint}`** - queues a job. Requires x402 payment. Body: `{ "url": "https://example.com", "webhookUrl": "https://myapp.com/webhooks/sitelenz" }` (`webhookUrl` optional) - identical for all ten endpoints.
- **`GET /v1/analyze/{endpoint}`** - same x402 402 challenge as the `POST`, no side effects. Exists for the x402 Doctor / Bazaar discovery crawler, which always probes with `GET`.
- **`GET /v1/analyze/{endpoint}/:id`** - job status/progress. No payment required.
- **`GET /v1/analyze/{endpoint}/:id/result`** - the stored result once `status` is `completed`; `202` with a pending message otherwise. No payment required.
- **`POST /v1/analyze/{endpoint}/:id/retry`** - re-queues a `failed` job. No payment required.

### POST /v1/analyze/technology

Response - `200 OK` (payment settled, job queued):

```json
{
  "analyzeJobId": "sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2",
  "status": "queued",
  "endpoint": "technology",
  "createdAt": "2026-09-08T12:00:00.000Z"
}
```

Response - `402 Payment Required` (no or invalid `PAYMENT-SIGNATURE` header):

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "https://api.sitelenz.online/v1/analyze/technology",
    "description": "SiteLenz technology analysis",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
      "asset": "10458941",
      "amount": "10000",
      "payTo": "RECEIVER_ALGORAND_ADDRESS",
      "maxTimeoutSeconds": 60,
      "extra": {
        "asset": "10458941",
        "tag": "x402-global-challenge"
      }
    }
  ]
}
```

Full x402 flow with curl (same pattern for every endpoint - swap the path and, for `standard`/`full`/`performance`, expect a longer time-to-completion since those launch a browser):

```bash
# 1. Initial request - no payment attached, gets 402 back
curl -i -X POST https://api.sitelenz.online/v1/analyze/technology \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

# 2. Sign the payment described in the 402 response using an x402-compatible
#    Algorand client, then retry with the signed payload attached
curl -i -X POST https://api.sitelenz.online/v1/analyze/technology \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: <base64-encoded signed payment payload>" \
  -d '{"url":"https://example.com"}'
```

### GET /v1/analyze/{endpoint}/:id

```json
{
  "analyzeJobId": "sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2",
  "endpoint": "technology",
  "status": "running",
  "progressStage": "analyzing",
  "createdAt": "2026-09-08T12:00:00.000Z",
  "completedAt": null
}
```

`status` is one of: `queued`, `running`, `completed`, `failed`. `progressStage` is a finer-grained stage string while `status` is `running` - stage names vary by endpoint (e.g. `resolving_observations`, `analyzing`, `taking_screenshots`, `ai_analysis`, `storing_results`, `sending_webhook`).

### GET /v1/analyze/{endpoint}/:id/result

No payment required - the job was already paid for at creation.

Response - `200 OK` once the job has completed: the endpoint's result object (see [Result Shapes](#result-shapes)).

Response - `202 Accepted` while queued, running, or if it failed:

```json
{
  "analyzeJobId": "sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2",
  "status": "running",
  "message": "Analysis not yet complete"
}
```

Response - `404 Not Found` if the id does not exist.

### GET /v1/analyze

Catalog of all ten endpoints - no payment required. Lets an agent discover what's available without reading Swagger.

```json
{
  "endpoints": [
    {
      "path": "/v1/analyze/technology",
      "method": "POST",
      "price": "$0.01",
      "description": "Detects frontend frameworks, CMS, CDN, analytics, payment providers, CSS libraries, and fonts from HTTP headers, DOM markers, and script analysis.",
      "async": true,
      "resultPath": "/v1/analyze/technology/:id/result"
    }
  ]
}
```

### GET /health

```json
{
  "status": "ok",
  "network": "testnet",
  "version": "0.0.1",
  "timestamp": "2026-09-08T12:00:00.000Z",
  "architecture": "v2",
  "endpoints": 10
}
```

---

## x402 Payment Flow

SiteLenz speaks x402 protocol v2 over Algorand. On the client side, the same ecosystem libraries this backend uses on the server (`@x402/core` and `@x402/avm`) can drive the payment automatically - there is no separate `@x402/client` package; the client-side pieces live at the `@x402/core/client` and `@x402/avm/exact/client` subpaths.

A minimal automated client:

```javascript
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactAvmScheme } from '@x402/avm/exact/client';

// Any signer implementing { address, signTransactions() } works - a
// Pera/Lute wallet adapter in a browser, or an Algorand SDK account in a
// script or agent.
const signer = {
  address: process.env.ALGO_ADDRESS,
  async signTransactions(txns, indexesToSign) {
    // sign the given transactions with your Algorand account/wallet
  },
};

const client = new x402Client();
client.register(
  'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=', // testnet CAIP-2 id
  new ExactAvmScheme(signer),
);
const http = new x402HTTPClient(client);

async function analyzeUrl(url) {
  const endpoint = 'https://api.sitelenz.online/v1/analyze/technology';
  const body = JSON.stringify({ url });
  const headers = { 'Content-Type': 'application/json' };

  let res = await fetch(endpoint, { method: 'POST', headers, body });

  if (res.status === 402) {
    const paymentRequired = http.getPaymentRequiredResponse(
      (name) => res.headers.get(name),
      await res.json(),
    );
    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    const paymentHeaders = http.encodePaymentSignatureHeader(paymentPayload);

    res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, ...paymentHeaders },
      body,
    });
  }

  return res.json();
}
```

An AI agent integrating against SiteLenz follows the same pattern: attempt the request, catch the `402`, sign and attach payment, retry once. No manual wallet interaction is required once a signer is configured. An agent that wants to discover endpoints and prices programmatically first can hit `GET /v1/analyze` or `GET /.well-known/x402` rather than reading this document.

---

## Result Shapes

Each single-analyzer endpoint (`technology`, `seo`, `security`, `business`, `performance`, `ux-accessibility`) returns just that analyzer's own object - e.g. `GET /v1/analyze/technology/:id/result`:

```json
{
  "technologies": [
    {
      "name": "Nginx",
      "category": "infrastructure",
      "confidence": 0.9,
      "evidence": ["Server response header: nginx"]
    }
  ]
}
```

`screenshots` returns:

```json
{
  "desktop": {
    "url": "https://res.cloudinary.com/demo/image/upload/v1/sitelenz/screenshots/sl_aj_xxx/sl_aj_xxx-desktop.png",
    "cloudinaryPublicId": "sitelenz/screenshots/sl_aj_xxx/sl_aj_xxx-desktop",
    "takenAt": "2026-09-08T12:00:45.000Z"
  },
  "mobile": {
    "url": "https://res.cloudinary.com/demo/image/upload/v1/sitelenz/screenshots/sl_aj_xxx/sl_aj_xxx-mobile.png",
    "cloudinaryPublicId": "sitelenz/screenshots/sl_aj_xxx/sl_aj_xxx-mobile",
    "takenAt": "2026-09-08T12:00:47.000Z"
  }
}
```

`ai-summary` crawls and analyzes the URL internally like `standard`/`full`, but returns only the AI section (not the six analyzer sections):

```json
{
  "url": "https://example.com",
  "ai": {
    "summary": "...",
    "strengths": ["..."],
    "weaknesses": ["..."],
    "notableFindings": ["..."],
    "technicalInterpretation": "...",
    "businessInterpretation": "...",
    "recommendations": [{ "priority": "medium", "category": "security", "finding": "..." }],
    "modelUsed": "openai/gpt-oss-120b",
    "interpretedAt": "2026-09-08T12:00:42.000Z"
  },
  "metadata": {
    "completedAt": "2026-09-08T12:00:45.000Z",
    "durationMs": 18234,
    "cacheHit": false
  }
}
```

`standard` and `full` return the composite report - every analyzer section, `screenshots` (desktop only for `standard`; desktop + mobile for `full`), `ai`, and `metadata`:

```json
{
  "analyzeJobId": "sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2",
  "url": "https://example.com",
  "endpoint": "full",
  "website": {
    "finalUrl": "https://example.com/",
    "statusCode": 200,
    "redirectChain": []
  },
  "technology": { "technologies": [], "additionalLibraries": [] },
  "seo": { "title": { "present": true, "value": "Example Domain", "length": 14, "issues": ["too_short"] }, "robotsTxt": { "present": true, "allowsIndexing": true } },
  "security": { "https": { "enabled": true, "mixedContent": false }, "securityScore": 65, "tlsCertificate": { "valid": true, "daysUntilExpiry": 72 } },
  "performance": { "lighthouse": { "performanceScore": 97, "accessibilityScore": 88 }, "resourceInventory": {}, "thirdParty": { "domains": [], "percent": 0 } },
  "business": { "businessName": { "value": "Example", "source": "inferred" }, "pricingLinks": [] },
  "ux": { "viewport": { "hasViewportMeta": true }, "mobile": { "mobileViewportConfigured": true } },
  "ai": {
    "summary": "...",
    "strengths": ["..."],
    "weaknesses": ["..."],
    "recommendations": [],
    "modelUsed": "openai/gpt-oss-120b",
    "interpretedAt": "2026-09-08T12:00:42.000Z"
  },
  "screenshots": {
    "desktop": { "url": "https://res.cloudinary.com/...", "cloudinaryPublicId": "...", "takenAt": "..." },
    "mobile": { "url": "https://res.cloudinary.com/...", "cloudinaryPublicId": "...", "takenAt": "..." }
  },
  "metadata": {
    "completedAt": "2026-09-08T12:00:45.000Z",
    "durationMs": 18234,
    "cacheHit": false
  }
}
```

`additionalLibraries` (technology), `robotsTxt`/`sitemap`/`hreflang` (seo), `tlsCertificate`/cookie audit (security), `resourceInventory`/`thirdParty` (performance), pricing/nav/footer links (business), and `mobile`/reading-experience signals (ux) are only populated in deep mode, i.e. by `full` - `standard` omits them.

---

## Stack

- NestJS
- Fastify
- TypeScript
- PostgreSQL
- Prisma
- Redis
- BullMQ
- Playwright
- Lighthouse
- Cheerio
- Groq
- Cloudinary
- x402
- Algorand

---

## Environment Variables

### App

| Variable | Description |
|---|---|
| `PORT` | HTTP port the server listens on (default `3000`) |
| `NETWORK` | Active Algorand network: `testnet` or `mainnet` (default `testnet`) |

### Database

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by Prisma |

### Redis

| Variable | Description |
|---|---|
| `REDIS_URL` | Redis connection string used by BullMQ for the per-endpoint analyze queues, the analyze-webhook queue, and the legacy analysis/webhook queues |

### Algorand / x402 (Testnet)

| Variable | Description |
|---|---|
| `TESTNET_ALGORAND_NODE_URL` | Algod node URL for testnet (required when `NETWORK=testnet`) |
| `TESTNET_X402_FACILITATOR_URL` | x402 facilitator URL used to verify/settle testnet payments |
| `TESTNET_PAY_TO_ADDRESS` | Algorand address that receives testnet payments (required when `NETWORK=testnet`) |
| `TESTNET_USDC_ASSET_ID` | Testnet USDC ASA id (required when `NETWORK=testnet`) |

### Algorand / x402 (Mainnet)

| Variable | Description |
|---|---|
| `MAINNET_ALGORAND_NODE_URL` | Algod node URL for mainnet (required when `NETWORK=mainnet`) |
| `MAINNET_X402_FACILITATOR_URL` | x402 facilitator URL used to verify/settle mainnet payments |
| `MAINNET_PAY_TO_ADDRESS` | Algorand address that receives mainnet payments (required when `NETWORK=mainnet`) |
| `MAINNET_USDC_ASSET_ID` | Mainnet USDC ASA id (required when `NETWORK=mainnet`) |

### Cloudinary

| Variable | Description |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name used to store analysis screenshots |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

### Groq

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | API key for Groq, used for AI report interpretation |
| `GROQ_MODEL` | Groq chat model id (default `openai/gpt-oss-120b`) |

### Analysis Config

| Variable | Description |
|---|---|
| `WEBHOOK_SECRET` | Secret used to HMAC-sign outgoing webhook deliveries |
| `ANALYSIS_CACHE_TTL_HOURS` | How long a crawl observation is served from cache before it expires (default `48`) |
| `MAX_CONCURRENT_ANALYSES` | Max heavy (Playwright) jobs processed concurrently across all browser-backed endpoints (default `3`) |
| `ANALYSIS_TIMEOUT_MS` | Per-crawl timeout in milliseconds (default `120000`) |

### Endpoint Pricing (USD)

One var per `/v1/analyze/*` endpoint. Change the value and restart to reprice an endpoint - no code change needed.

| Variable | Description |
|---|---|
| `ANALYZE_PRICE_TECHNOLOGY` | Price for `POST /v1/analyze/technology` (suggested `0.01`) |
| `ANALYZE_PRICE_SEO` | Price for `POST /v1/analyze/seo` (suggested `0.01`) |
| `ANALYZE_PRICE_SECURITY` | Price for `POST /v1/analyze/security` (suggested `0.01`) |
| `ANALYZE_PRICE_BUSINESS` | Price for `POST /v1/analyze/business` (suggested `0.01`) |
| `ANALYZE_PRICE_UX_ACCESSIBILITY` | Price for `POST /v1/analyze/ux-accessibility` (suggested `0.01`) |
| `ANALYZE_PRICE_SCREENSHOTS` | Price for `POST /v1/analyze/screenshots` (suggested `0.01`) |
| `ANALYZE_PRICE_PERFORMANCE` | Price for `POST /v1/analyze/performance` (suggested `0.02`) |
| `ANALYZE_PRICE_AI_SUMMARY` | Price for `POST /v1/analyze/ai-summary` (suggested `0.05`) |
| `ANALYZE_PRICE_STANDARD` | Price for `POST /v1/analyze/standard` (suggested `0.40`) |
| `ANALYZE_PRICE_FULL` | Price for `POST /v1/analyze/full` (suggested `0.80`) |

---

## Running Locally

1. Clone the repository and install dependencies:

   ```bash
   git clone <repository-url>
   cd sitelenz
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the required values (database, Redis, Cloudinary, Groq, and a testnet `PAY_TO` address at minimum):

   ```bash
   cp .env.example .env
   ```

3. Apply database migrations:

   ```bash
   npx prisma migrate dev
   ```

4. Start the API in watch mode:

   ```bash
   npm run start:dev
   ```

5. Open `http://localhost:3000/docs` for the interactive Swagger UI, or `http://localhost:3000/v1/analyze` for the plain-JSON endpoint catalog.

---

## Deployment

SiteLenz ships with a `Procfile` (`web: node dist/src/main.js`) for platforms like Railway or Render that build from a standard Node buildpack - run `npm run build` then deploy, with `npm run start:prod` as the local equivalent of the Procfile's command. All configuration is environment-driven, so moving from testnet to a live mainnet deployment only requires setting `NETWORK=mainnet` along with the corresponding `MAINNET_*` variables (node URL, facilitator URL, payout address, and USDC asset id); no code changes are needed to switch networks.

---

## License

MIT
