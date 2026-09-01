import * as Joi from 'joi';
import { DEFAULT_GROQ_MODEL } from './configuration';

export const envValidationSchema = Joi.object({
  NETWORK: Joi.string().valid('testnet', 'mainnet').default('testnet'),

  TESTNET_ALGORAND_NODE_URL: Joi.string().allow('').optional(),
  TESTNET_X402_FACILITATOR_URL: Joi.string().allow('').optional(),
  TESTNET_PAY_TO_ADDRESS: Joi.string().allow('').optional(),
  TESTNET_USDC_ASSET_ID: Joi.string().allow('').optional(),

  MAINNET_ALGORAND_NODE_URL: Joi.string().allow('').optional(),
  MAINNET_X402_FACILITATOR_URL: Joi.string().allow('').optional(),
  MAINNET_PAY_TO_ADDRESS: Joi.string().allow('').optional(),
  MAINNET_USDC_ASSET_ID: Joi.string().allow('').optional(),

  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),

  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').optional(),
  CLOUDINARY_API_KEY: Joi.string().allow('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().allow('').optional(),

  GROQ_API_KEY: Joi.string().required(),
  GROQ_MODEL: Joi.string().default(DEFAULT_GROQ_MODEL),
  WEBHOOK_SECRET: Joi.string().allow('').optional(),

  ANALYSIS_CACHE_TTL_HOURS: Joi.number().default(48),
  MAX_CONCURRENT_ANALYSES: Joi.number().default(3),
  ANALYSIS_TIMEOUT_MS: Joi.number().default(120000),

  X402_PRICE_STANDARD_USD: Joi.number().positive().default(1),
  X402_PRICE_DEEP_USD: Joi.number().positive().default(2),

  PORT: Joi.number().default(3000),
});
