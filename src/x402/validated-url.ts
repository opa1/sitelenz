import type { FastifyRequest } from 'fastify';

// X402Guard SSRF-validates the request URL before settling payment and stashes
// the normalized result here; the route handler (BaseAnalyzeController.createJob)
// reuses it instead of re-resolving DNS. A symbol key keeps it off the wire and
// out of the request's own typed surface.
const VALIDATED_NORMALIZED_URL = Symbol('validatedNormalizedUrl');

type RequestWithValidatedUrl = FastifyRequest & {
  [VALIDATED_NORMALIZED_URL]?: string;
};

export function setValidatedNormalizedUrl(
  request: FastifyRequest,
  normalizedUrl: string,
): void {
  (request as RequestWithValidatedUrl)[VALIDATED_NORMALIZED_URL] =
    normalizedUrl;
}

export function getValidatedNormalizedUrl(
  request: FastifyRequest,
): string | undefined {
  return (request as RequestWithValidatedUrl)[VALIDATED_NORMALIZED_URL];
}
