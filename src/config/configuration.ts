import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Network = 'testnet' | 'mainnet';

/**
 * `process.cwd()` rather than a `__dirname`-relative path: Procfile/platform
 * start commands (`node dist/src/main.js`) and `npm run start:dev` (ts-node
 * against `src/`) both run with the working directory set to the repo root,
 * but the two entry files sit at different depths from that root - a fixed
 * number of `../` segments can't reach package.json correctly from both.
 * `npm_package_version` isn't used because Procfile-style platforms invoke
 * the start command directly, not through `npm run`, so it wouldn't be set.
 */
function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// llama-3.3-70b-versatile has been removed from Groq's model catalog
// (confirmed via a live models.list() call - 404 model_not_found on every
// request). openai/gpt-oss-120b is Groq's current flagship large
// open-weight model and the closest replacement; override via GROQ_MODEL.
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

export interface NetworkConfig {
  algorandNodeUrl: string;
  x402FacilitatorUrl: string;
  payToAddress: string;
  usdcAssetId: string;
}

export interface AppConfiguration {
  version: string;
  network: Network;
  networks: Record<Network, NetworkConfig>;
  database: {
    url: string;
  };
  redis: {
    url: string;
    keyPrefix: string;
  };
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };
  groq: {
    apiKey: string;
    model: string;
  };
  webhook: {
    secret: string;
  };
  analysis: {
    cacheTtlHours: number;
    maxConcurrentAnalyses: number;
    timeoutMs: number;
  };
  /**
   * Fixed USD price per /v1/analyze/* endpoint, keyed by endpoint name
   * (matches AnalyzeEndpoint in src/analyze/analyze-job.interface.ts - kept
   * as a plain Record here rather than importing that type, so config stays
   * a leaf module with no dependency on feature code). Read by X402Guard via
   * the endpoint name each @SetAnalyzePrice-decorated route declares.
   */
  analyzePrices: Record<string, number>;
}

export default (): AppConfiguration => ({
  version: readPackageVersion(),
  network: (process.env.NETWORK as Network) ?? 'testnet',
  networks: {
    testnet: {
      algorandNodeUrl: process.env.TESTNET_ALGORAND_NODE_URL ?? '',
      x402FacilitatorUrl: process.env.TESTNET_X402_FACILITATOR_URL ?? '',
      payToAddress: process.env.TESTNET_PAY_TO_ADDRESS ?? '',
      usdcAssetId: process.env.TESTNET_USDC_ASSET_ID ?? '',
    },
    mainnet: {
      algorandNodeUrl: process.env.MAINNET_ALGORAND_NODE_URL ?? '',
      x402FacilitatorUrl: process.env.MAINNET_X402_FACILITATOR_URL ?? '',
      payToAddress: process.env.MAINNET_PAY_TO_ADDRESS ?? '',
      usdcAssetId: process.env.MAINNET_USDC_ASSET_ID ?? '',
    },
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? '',
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? '',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY ?? '',
    model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
  },
  webhook: {
    secret: process.env.WEBHOOK_SECRET ?? '',
  },
  analysis: {
    cacheTtlHours: Number(process.env.ANALYSIS_CACHE_TTL_HOURS ?? 48),
    maxConcurrentAnalyses: Number(process.env.MAX_CONCURRENT_ANALYSES ?? 3),
    timeoutMs: Number(process.env.ANALYSIS_TIMEOUT_MS ?? 120000),
  },
  analyzePrices: {
    technology: Number(process.env.ANALYZE_PRICE_TECHNOLOGY),
    seo: Number(process.env.ANALYZE_PRICE_SEO),
    security: Number(process.env.ANALYZE_PRICE_SECURITY),
    business: Number(process.env.ANALYZE_PRICE_BUSINESS),
    'ux-accessibility': Number(process.env.ANALYZE_PRICE_UX_ACCESSIBILITY),
    screenshots: Number(process.env.ANALYZE_PRICE_SCREENSHOTS),
    performance: Number(process.env.ANALYZE_PRICE_PERFORMANCE),
    'ai-summary': Number(process.env.ANALYZE_PRICE_AI_SUMMARY),
    standard: Number(process.env.ANALYZE_PRICE_STANDARD),
    full: Number(process.env.ANALYZE_PRICE_FULL),
  },
});
