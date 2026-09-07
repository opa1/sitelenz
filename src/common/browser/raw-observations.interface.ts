export interface MetaTag {
  name?: string;
  property?: string;
  content?: string;
}

export interface ScriptRef {
  src?: string;
  inline: boolean;
  content?: string;
}

export interface NetworkRequestRecord {
  url: string;
  resourceType: string;
  status?: number;
}

export interface CookieRecord {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
}

export interface ConsoleLogRecord {
  type: string;
  text: string;
}

export interface TimingInfo {
  navigationStart: number;
  domContentLoaded: number;
  loadComplete: number;
}

export interface ResourceSummary {
  totalRequests: number;
  totalSize: number;
  byType: Record<string, number>;
}

/**
 * Loose passthrough for Lighthouse's LHR (Lighthouse Result) JSON - its real
 * type lives in an ESM-only package with an awkward type surface to consume
 * from a CJS build; the worker/report layer only stores this, it doesn't
 * inspect specific fields in this phase.
 */
export type LighthouseResult = Record<string, unknown>;

export interface RawObservations {
  url: string;
  statusCode: number;
  responseHeaders: Record<string, string>;
  html: string;
  title: string;
  metaTags: MetaTag[];
  scripts: ScriptRef[];
  networkRequests: NetworkRequestRecord[];
  cookies: CookieRecord[];
  consoleLogs: ConsoleLogRecord[];
  windowKeys: string[];
  timing: TimingInfo;
  resourceSummary: ResourceSummary;
  redirectChain: string[];
  lighthouseResult: LighthouseResult | null;
}
