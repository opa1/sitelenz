import { SetMetadata } from '@nestjs/common';

export const ANALYZE_ENDPOINT_KEY = 'x402:analyzeEndpoint';

/**
 * Marks a route as belonging to a given /v1/analyze/* endpoint. X402Guard
 * reads this and looks the current price up from
 * AppConfigService.analyzePrices[endpoint] at request time - not baked in
 * as a raw number here, since a decorator argument is evaluated once at
 * class-declaration time (long before Nest's DI container, and therefore
 * AppConfigService, exists) and couldn't reflect an env var changed after a
 * restart otherwise.
 */
export const SetAnalyzePrice = (endpoint: string) =>
  SetMetadata(ANALYZE_ENDPOINT_KEY, endpoint);
