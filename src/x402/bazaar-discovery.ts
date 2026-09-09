import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from '@x402/extensions/bazaar';

/**
 * Builds the x402 Bazaar `bazaar` discovery extension for one /v1/analyze/*
 * endpoint, as an `extensions`-map fragment ready to spread into the object
 * passed to `createPaymentRequiredResponse`.
 *
 * Why the official @x402/extensions/bazaar helper and not a hand-built object:
 * the facilitator decides whether to catalog a resource by compiling
 * `bazaar.schema` and validating `bazaar.info` against it
 * (validateDiscoveryExtension). An earlier hand-built shape put the
 * request-body schema directly under `schema.properties.input`
 * (required: ['url']), which fails that check - the discovery `info.input` is
 * `{ type, method, bodyType, body }`, so validation errored "/input: must have
 * required property 'url'" and every settled payment was silently dropped from
 * /discovery/resources (the endpoint was never listed despite real payments).
 * declareDiscoveryExtension nests the request body under `input.body` and emits
 * the exact shape the validator - and thus the facilitator - accepts. See
 * bazaar-discovery.spec.ts, which asserts this against the real validator.
 *
 * The paid action is always POST; it is advertised on the GET decoy route too
 * (the x402 Doctor / Bazaar crawler only ever probes with GET).
 * declareDiscoveryExtension omits `method` from its public input by design - it
 * is injected at request time by bazaarResourceServerExtension.enrichDeclaration
 * (what the x402 paymentMiddleware does internally). This guard drives the
 * resource server directly, so we invoke that enrichment explicitly, forcing
 * POST.
 */
export function buildBazaarDiscoveryExtension(
  endpoint: string,
): Record<string, unknown> {
  const base = declareDiscoveryExtension({
    bodyType: 'json',
    input: { url: 'https://example.com' },
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          description: 'The website URL to analyze',
        },
        webhookUrl: {
          type: 'string',
          format: 'uri',
          description: 'HTTPS URL to notify when the job completes',
        },
      },
    },
    output: {
      example: {
        analyzeJobId: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2',
        status: 'queued',
        endpoint,
        createdAt: '2026-09-08T12:00:00.000Z',
      },
    },
  });

  // enrichDeclaration only reads `method` and (when a routePattern is given)
  // `adapter.getPath()`. We pass no routePattern, so getPath is never called -
  // the adapter stub only needs to exist for the HTTP-context type guard.
  const bazaar =
    bazaarResourceServerExtension.enrichDeclaration?.(base.bazaar, {
      method: 'POST',
      adapter: { getPath: () => '' },
    }) ?? base.bazaar;

  return { bazaar };
}
