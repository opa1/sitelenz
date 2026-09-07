# SiteLenz

SiteLenz is a pay-per-request Website Intelligence API that accepts a URL and a single x402 payment of $1 (standard) or $2 (deep) on Algorand, then asynchronously crawls and analyzes the target website using Playwright, returning a structured JSON report covering technology stack, SEO, security headers, performance metrics, business signals, UX observations, and an AI-generated interpretation via Groq, delivered through a webhook or retrievable by polling.

Built for the [Algorand Global x402 Challenge](https://algorand.co/global-x402-challenge).

---

## How It Works

1. A client sends `POST /v1/analyses` with `{ url, analysis, webhookUrl? }`.
2. The URL is validated first - protocol allowlist, DNS resolution, and rejection of private/reserved/loopback addresses (SSRF protection) - before any payment is enforced, so an invalid or unsafe URL never charges the caller.
3. If a completed analysis of the same URL and type already exists within the cache TTL, it is returned immediately with `cached: true` and no new payment or job is created.
4. Otherwise the request must carry a `PAYMENT-SIGNATURE` header. If it is missing or invalid, the API responds `402 Payment Required` with the x402 payment requirements: an Algorand `exact`-scheme USDC transfer, priced per analysis type.
5. The client signs the required USDC transfer (via any x402-compatible Algorand client, such as `@x402/core` + `@x402/avm`) and retries the same request with the `PAYMENT-SIGNATURE` header attached.
6. The x402 guard verifies and settles the payment against the GoPlausible facilitator. Once settled, a job is enqueued on a BullMQ queue under a generated `sl_an_*` analysis id, and the request returns `200` immediately with `status: "queued"`.
7. A worker process picks up the job: launches a Playwright browser context, crawls the page, runs a Lighthouse audit, captures a desktop screenshot (plus a mobile screenshot for deep analyses), and uploads screenshots to Cloudinary.
8. Six analyzers run in sequence over the collected observations: Technology, SEO, Security, Performance, Business, and UX.
9. The condensed analyzer output is sent to Groq for AI interpretation (summary, strengths/weaknesses, notable findings, recommendations). If the AI call fails, a fallback stub is stored instead of failing the whole analysis.
10. The full report is persisted and the analysis status flips to `completed`. If a `webhookUrl` was supplied, an HMAC-signed webhook is enqueued for delivery (with automatic retries); regardless, the report becomes retrievable via `GET /v1/analyses/:id/report`.

---

## Analysis Tiers

| Analyzer | Standard ($1) | Deep ($2) |
|---|---|---|
| Technology | Framework/CMS/infrastructure/analytics/payments/CSS-framework/font detection with confidence scores | Adds `additionalLibraries` - inline and externally-loaded JS library detection |
| SEO | Title, meta description, canonical, robots directives, Open Graph, Twitter Card, headings, image alt coverage, structured data, Lighthouse SEO score | Adds `robots.txt` audit, sitemap discovery, and hreflang detection |
| Security | HTTPS/mixed-content check, security headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy), security score | Adds cookie flag audit (`Secure`/`HttpOnly`/`SameSite`) and TLS certificate inspection |
| Performance | Lighthouse core metrics (LCP, CLS, FCP, TBT, TTFB, Speed Index), page weight, browser timing, image optimization, caching headers | Adds resource inventory (scripts/stylesheets/images/fonts) and third-party domain analysis |
| Business | Business identity, contact/support/pricing signals, CTA detection, business model signals (SaaS/e-commerce/marketplace) | Adds all CTA texts, pricing links, nav/footer link maps, and product name extraction |
| UX | Viewport config, navigation, forms, CTA presence, content/hero detection, accessibility audit | Adds mobile UX signals (responsive images, mobile menu, touch target issues) and reading experience metrics |
| Screenshots | Desktop viewport only | Desktop + mobile viewport |
| AI Interpretation | Groq-generated summary, strengths/weaknesses, recommendations within a standard token budget | Same fields with a larger token budget for a more detailed interpretation |

---

## API Reference

### POST /v1/analyses

Queues a new analysis. Requires x402 payment.

Request body:

```json
{
  "url": "https://example.com",
  "analysis": "standard",
  "webhookUrl": "https://myapp.com/webhooks/sitelenz"
}
```

- `url` - the website to analyze (required).
- `analysis` - `"standard"` or `"deep"` (required); determines the price charged.
- `webhookUrl` - HTTPS URL to notify on completion or failure (optional).

Response - `200 OK` (payment settled, job queued or cached result returned):

```json
{
  "analysisId": "sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2",
  "status": "queued",
  "analysis": "standard",
  "createdAt": "2026-09-03T12:00:00.000Z"
}
```

Response - `402 Payment Required` (no or invalid `PAYMENT-SIGNATURE` header):

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "https://api.sitelenz.dev/v1/analyses",
    "description": "SiteLenz standard analysis",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
      "asset": "10458941",
      "amount": "1000000",
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

Full x402 flow with curl:

```bash
# 1. Initial request - no payment attached, gets 402 back
curl -i -X POST https://api.sitelenz.dev/v1/analyses \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","analysis":"standard"}'

# 2. Sign the payment described in the 402 response using an x402-compatible
#    Algorand client, then retry with the signed payload attached
curl -i -X POST https://api.sitelenz.dev/v1/analyses \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: <base64-encoded signed payment payload>" \
  -d '{"url":"https://example.com","analysis":"standard"}'
```

### GET /v1/analyses/:id

Returns current status and progress.

```json
{
  "analysisId": "sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2",
  "status": "running",
  "analysis": "standard",
  "progress": "analyzing",
  "createdAt": "2026-09-03T12:00:00.000Z",
  "completedAt": null
}
```

`status` is one of: `queued`, `running`, `completed`, `failed`, `expired`.
`progress` is a finer-grained stage string while `status` is `running`: `launching_browser`, `fetching_website`, `rendering`, `taking_screenshot`, `analyzing`, `ai_analysis`, `storing_results`, `sending_webhook`, `completed`, or `failed`.

### GET /v1/analyses/:id/report

No payment required - the analysis was already paid for at creation.

Response - `200 OK` once the analysis has completed: the full report object (see [Report Structure](#report-structure)).

Response - `202 Accepted` while queued, running, or if it failed:

```json
{
  "analysisId": "sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2",
  "status": "running",
  "message": "Analysis is not yet complete"
}
```

Response - `404 Not Found` if the id does not exist.

### GET /health

```json
{
  "status": "ok",
  "network": "testnet",
  "version": "0.0.1",
  "timestamp": "2026-09-03T12:00:00.000Z"
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
  const body = JSON.stringify({ url, analysis: 'standard' });
  const headers = { 'Content-Type': 'application/json' };

  let res = await fetch('https://api.sitelenz.dev/v1/analyses', {
    method: 'POST',
    headers,
    body,
  });

  if (res.status === 402) {
    const paymentRequired = http.getPaymentRequiredResponse(
      (name) => res.headers.get(name),
      await res.json(),
    );
    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    const paymentHeaders = http.encodePaymentSignatureHeader(paymentPayload);

    res = await fetch('https://api.sitelenz.dev/v1/analyses', {
      method: 'POST',
      headers: { ...headers, ...paymentHeaders },
      body,
    });
  }

  return res.json();
}
```

An AI agent integrating against SiteLenz follows the same pattern: attempt the request, catch the `402`, sign and attach payment, retry once. No manual wallet interaction is required once a signer is configured.

---

## Report Structure

```json
{
  "analysisId": "sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2",
  "url": "https://example.com",
  "analysisType": "standard",
  "website": {
    "finalUrl": "https://example.com/",
    "statusCode": 200,
    "redirectChain": []
  },
  "technology": {
    "technologies": [
      {
        "name": "Nginx",
        "category": "infrastructure",
        "confidence": 0.9,
        "evidence": ["Server response header: nginx"]
      },
      {
        "name": "IANA static hosting",
        "category": "infrastructure",
        "confidence": 0.4,
        "evidence": ["Minimal boilerplate HTML with no framework markers"]
      }
    ]
  },
  "seo": {
    "title": {
      "present": true,
      "value": "Example Domain",
      "length": 14,
      "issues": ["too_short"]
    },
    "metaDescription": {
      "present": false,
      "value": null,
      "length": 0,
      "issues": ["missing"]
    },
    "canonical": { "present": false, "value": null, "matchesCurrentUrl": false },
    "robots": {
      "meta": null,
      "header": null,
      "indexable": true
    },
    "headings": {
      "h1Count": 1,
      "h2Count": 0,
      "h1Values": ["Example Domain"],
      "issues": []
    },
    "images": {
      "total": 0,
      "withAlt": 0,
      "withEmptyAlt": 0,
      "missingAlt": 0,
      "altCoveragePercent": 100
    },
    "lighthouseSeoScore": 82
  },
  "security": {
    "https": { "enabled": true, "mixedContent": false },
    "headers": {
      "strictTransportSecurity": {
        "present": false,
        "maxAge": null,
        "includeSubDomains": false,
        "preload": false,
        "score": "missing"
      },
      "contentSecurityPolicy": {
        "present": false,
        "value": null,
        "hasUnsafeInline": false,
        "hasUnsafeEval": false,
        "score": "missing"
      },
      "xFrameOptions": { "present": false, "value": null, "score": "missing" }
    },
    "securityScore": 45
  },
  "performance": {
    "lighthouse": {
      "performanceScore": 97,
      "accessibilityScore": 88,
      "lcp": { "value": 820, "score": "good" },
      "cls": { "value": 0.01, "score": "good" },
      "ttfb": { "value": 210, "score": "good" }
    },
    "pageWeight": {
      "totalRequests": 3,
      "totalSizeBytes": 6482,
      "totalSizeKb": 6.3,
      "byType": { "document": 1, "stylesheet": 1, "image": 1 }
    },
    "timing": { "domContentLoadedMs": 180, "loadCompleteMs": 240 },
    "caching": { "present": true, "value": "max-age=604800", "hasMaxAge": true }
  },
  "business": {
    "businessName": { "value": "Example", "source": "inferred" },
    "pageTitle": "Example Domain",
    "description": { "value": null, "source": "unknown" },
    "language": "en",
    "email": [],
    "phone": [],
    "socialLinks": [],
    "hasContactPage": false,
    "hasSupportPage": false,
    "hasPricing": false,
    "hasFreeTrialSignal": false,
    "hasEnterpriseSignal": false,
    "primaryCta": "More information...",
    "ctaUrl": "https://www.iana.org/domains/example",
    "businessModel": {
      "hasSaasSignals": { "value": false, "source": "inferred" },
      "hasEcommerceSignals": { "value": false, "source": "inferred" },
      "hasMarketplaceSignals": { "value": false, "source": "inferred" }
    }
  },
  "ux": {
    "viewport": { "hasViewportMeta": true, "viewportContent": "width=device-width, initial-scale=1" },
    "navigation": { "hasNav": false, "navItemCount": 0, "hasHamburgerSignal": false },
    "forms": { "formCount": 0, "hasSearchForm": false, "hasLoginForm": false, "hasNewsletterSignal": false },
    "cta": { "present": true, "count": 1 },
    "content": { "hasHeroSection": false, "wordCount": 28 },
    "accessibility": { "score": 88, "audits": [] }
  },
  "ai": {
    "summary": "A minimal static placeholder page with no framework, tracking, or business functionality - suitable as a documentation example but not representative of a production site.",
    "strengths": ["Fast load time", "Valid HTTPS with no mixed content"],
    "weaknesses": ["No security headers configured", "No meta description for search snippets"],
    "notableFindings": ["Page is IANA's example.com placeholder domain"],
    "technicalInterpretation": "Server responds with minimal headers and no CSP/HSTS; page weight is negligible at under 7KB.",
    "businessInterpretation": "No discoverable business signals - appears to be a reference/test domain rather than a live business site.",
    "recommendations": [
      {
        "priority": "medium",
        "category": "security",
        "finding": "Add a Content-Security-Policy and Strict-Transport-Security header."
      },
      {
        "priority": "low",
        "category": "seo",
        "finding": "Add a meta description to improve search result snippets."
      }
    ],
    "modelUsed": "openai/gpt-oss-120b",
    "interpretedAt": "2026-09-03T12:00:42.000Z"
  },
  "screenshots": [
    {
      "type": "desktop",
      "url": "https://res.cloudinary.com/demo/image/upload/v1/sitelenz/sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2/desktop.png",
      "blockerDismissed": false
    }
  ],
  "metadata": {
    "analysisCompletedAt": "2026-09-03T12:00:45.000Z",
    "analysisDurationMs": 18234
  }
}
```

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
| `REDIS_URL` | Redis connection string used by BullMQ for the analysis and webhook queues |

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
| `ANALYSIS_CACHE_TTL_HOURS` | How long a completed analysis is served from cache before it expires (default `48`) |
| `MAX_CONCURRENT_ANALYSES` | Max analyses processed concurrently by the worker (default `3`) |
| `ANALYSIS_TIMEOUT_MS` | Per-analysis timeout in milliseconds (default `120000`) |
| `X402_PRICE_STANDARD_USD` | Price in USD charged for a standard analysis (default `1`) |
| `X402_PRICE_DEEP_USD` | Price in USD charged for a deep analysis (default `2`) |

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

5. Open `http://localhost:3000/docs` for the interactive Swagger UI.

---

## Deployment

SiteLenz ships with a `Procfile` (`web: node dist/src/main.js`) for platforms like Railway or Render that build from a standard Node buildpack - run `npm run build` then deploy, with `npm run start:prod` as the local equivalent of the Procfile's command. All configuration is environment-driven, so moving from testnet to a live mainnet deployment only requires setting `NETWORK=mainnet` along with the corresponding `MAINNET_*` variables (node URL, facilitator URL, payout address, and USDC asset id); no code changes are needed to switch networks.

---

## License

MIT
