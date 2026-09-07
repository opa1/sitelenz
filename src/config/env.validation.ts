import * as Joi from 'joi';
import { DEFAULT_GROQ_MODEL } from './configuration';

// Deployment prep: only the ACTIVE network's core fields (node URL, payTo,
// USDC asset id) are required at boot - this is what lets NETWORK be the
// only thing that changes between a testnet and a mainnet deploy. The
// inactive network's fields stay optional so e.g. a mainnet deploy doesn't
// also need testnet values filled in.
const requiredForNetwork = (network: 'testnet' | 'mainnet') =>
  Joi.string().when('NETWORK', {
    is: network,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  });

export const envValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NETWORK: Joi.string().valid('testnet', 'mainnet').default('testnet'),

  TESTNET_ALGORAND_NODE_URL: requiredForNetwork('testnet'),
  TESTNET_X402_FACILITATOR_URL: Joi.string().allow('').optional(),
  TESTNET_PAY_TO_ADDRESS: requiredForNetwork('testnet'),
  TESTNET_USDC_ASSET_ID: requiredForNetwork('testnet'),

  MAINNET_ALGORAND_NODE_URL: requiredForNetwork('mainnet'),
  MAINNET_X402_FACILITATOR_URL: Joi.string().allow('').optional(),
  MAINNET_PAY_TO_ADDRESS: requiredForNetwork('mainnet'),
  MAINNET_USDC_ASSET_ID: requiredForNetwork('mainnet'),

  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),
  // Namespaces every BullMQ key this app writes - required when Redis is a
  // shared instance across multiple apps (see queue.module.ts), optional
  // for a dedicated Redis where BullMQ's own default prefix is fine.
  REDIS_KEY_PREFIX: Joi.string().allow('').default(''),

  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  GROQ_API_KEY: Joi.string().required(),
  GROQ_MODEL: Joi.string().default(DEFAULT_GROQ_MODEL),

  WEBHOOK_SECRET: Joi.string().required(),

  ANALYSIS_CACHE_TTL_HOURS: Joi.number().default(48),
  MAX_CONCURRENT_ANALYSES: Joi.number().default(3),
  ANALYSIS_TIMEOUT_MS: Joi.number().default(120000),

  X402_PRICE_STANDARD_USD: Joi.number().positive().default(1),
  X402_PRICE_DEEP_USD: Joi.number().positive().default(2),
});
