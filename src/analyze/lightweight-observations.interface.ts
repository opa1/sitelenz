import type { MetaTag } from '../common/browser/raw-observations.interface';

/**
 * Plain HTTP(S)-fetched equivalent of RawObservations - no Playwright, so no
 * script/network/window/timing/Lighthouse data. LightweightFetchService
 * produces this; toRawObservationsShape() adapts it into a RawObservations
 * shape (with those fields defaulted) for the existing analyzers to consume.
 */
export interface LightweightObservations {
  url: string;
  statusCode: number;
  responseHeaders: Record<string, string>;
  html: string;
  title: string;
  metaTags: MetaTag[];
  cookies: string[];
  redirectChain: string[];
  fetchedAt: string;
}
