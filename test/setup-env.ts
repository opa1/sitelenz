/**
 * Jest setupFile (see the `jest.setupFiles` entry in package.json) - runs once
 * per test file, before that file's imports execute.
 *
 * Some units legitimately import config-coupled providers (e.g. the screenshot
 * capture service pulls in CloudinaryService/PrismaService, which import the
 * config module). Importing the config module evaluates
 * `ConfigModule.forRoot({ validationSchema })`, which validates the process
 * environment eagerly - so with no real env present (as in CI, which has no
 * `.env` file) that import throws a Joi "X is required" error and crashes the
 * jest worker before any test runs.
 *
 * Providing throwaway values here makes the env schema pass so those imports
 * load cleanly. Unit tests never touch the real DB/Redis/Cloudinary/Groq (they
 * inject mocks), so these values are never used for anything - they only need
 * to satisfy env.validation.ts. `??=` so a real value already in the
 * environment (e.g. a developer running with their own env) still wins.
 */
const TEST_ENV: Record<string, string> = {
  NETWORK: 'testnet',
  TESTNET_ALGORAND_NODE_URL: 'https://testnet-api.algonode.cloud',
  TESTNET_PAY_TO_ADDRESS: 'TESTNETADDRESSPLACEHOLDER',
  TESTNET_USDC_ASSET_ID: '10458941',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/sitelenz_test',
  REDIS_URL: 'redis://localhost:6379',
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'test-secret',
  GROQ_API_KEY: 'test-groq-key',
  WEBHOOK_SECRET: 'test-webhook-secret',
  ANALYZE_PRICE_TECHNOLOGY: '0.01',
  ANALYZE_PRICE_SEO: '0.01',
  ANALYZE_PRICE_SECURITY: '0.01',
  ANALYZE_PRICE_BUSINESS: '0.01',
  ANALYZE_PRICE_UX_ACCESSIBILITY: '0.01',
  ANALYZE_PRICE_SCREENSHOTS: '0.01',
  ANALYZE_PRICE_PERFORMANCE: '0.02',
  ANALYZE_PRICE_AI_SUMMARY: '0.05',
  ANALYZE_PRICE_STANDARD: '0.4',
  ANALYZE_PRICE_FULL: '0.8',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}
