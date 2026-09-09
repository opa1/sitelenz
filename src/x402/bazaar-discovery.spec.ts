import {
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
} from '@x402/extensions/bazaar';
import { buildBazaarDiscoveryExtension } from './bazaar-discovery';

// The 10 /v1/analyze/* endpoints (see analyze-endpoint-catalog.ts). Listed
// inline to keep this spec free of the config-coupled import chain.
const ENDPOINTS = [
  'technology',
  'seo',
  'security',
  'business',
  'performance',
  'ux-accessibility',
  'screenshots',
  'ai-summary',
  'standard',
  'full',
];

describe('buildBazaarDiscoveryExtension', () => {
  it.each(ENDPOINTS)(
    'produces a facilitator-valid bazaar extension for "%s"',
    (endpoint) => {
      const ext = buildBazaarDiscoveryExtension(endpoint);
      const specArg = ext.bazaar as Parameters<
        typeof validateDiscoveryExtensionSpec
      >[0];
      const schemaArg = ext.bazaar as Parameters<
        typeof validateDiscoveryExtension
      >[0];

      // This is the exact check the GoPlausible facilitator runs to decide
      // whether to catalog the resource: compile `bazaar.schema` and validate
      // `bazaar.info` against it. It must pass, or the endpoint is silently
      // dropped from /discovery/resources despite settled payments.
      expect(validateDiscoveryExtensionSpec(specArg)).toEqual({ valid: true });
      expect(validateDiscoveryExtension(schemaArg)).toEqual({ valid: true });
    },
  );

  it('advertises the paid POST action with a json body containing url', () => {
    const bazaar = buildBazaarDiscoveryExtension('technology').bazaar as {
      info: { input: { type: string; method: string; bodyType: string } };
    };
    expect(bazaar.info.input.type).toBe('http');
    expect(bazaar.info.input.method).toBe('POST');
    expect(bazaar.info.input.bodyType).toBe('json');
  });

  it('reflects the endpoint name in the output example', () => {
    const bazaar = buildBazaarDiscoveryExtension('full').bazaar as {
      info: { output: { example: { endpoint: string } } };
    };
    expect(bazaar.info.output.example.endpoint).toBe('full');
  });
});
