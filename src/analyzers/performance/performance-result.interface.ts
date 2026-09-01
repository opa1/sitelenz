export type MetricScore = 'good' | 'needs-improvement' | 'poor';

export interface MetricValue {
  value: number;
  score: MetricScore;
}

export interface SpeedIndexValue {
  value: number;
}

export interface PerformanceLighthouse {
  performanceScore: number | null;
  accessibilityScore: number | null;
  lcp: MetricValue | null;
  cls: MetricValue | null;
  fcp: MetricValue | null;
  tbt: MetricValue | null;
  ttfb: MetricValue | null;
  speedIndex: SpeedIndexValue | null;
}

export interface PageWeight {
  totalRequests: number;
  totalSizeBytes: number;
  totalSizeKb: number;
  byType: Record<string, number>;
}

export interface BrowserTiming {
  domContentLoadedMs: number;
  loadCompleteMs: number;
}

export interface ImageOptimization {
  optimized: boolean;
  webp: boolean;
  responsive: boolean;
}

export interface CachingResult {
  present: boolean;
  value: string | null;
  hasMaxAge: boolean;
}

export interface ResourceInventoryEntry {
  count: number;
  totalUrls: string[];
}

export interface ResourceInventory {
  scripts: ResourceInventoryEntry;
  stylesheets: ResourceInventoryEntry;
  images: ResourceInventoryEntry;
  fonts: ResourceInventoryEntry;
}

export interface ThirdPartyAnalysis {
  domains: string[];
  requestCount: number;
  percent: number;
}

export interface PerformanceResult {
  lighthouse: PerformanceLighthouse;
  pageWeight: PageWeight;
  timing: BrowserTiming;
  imageOptimization: ImageOptimization | null;
  caching: CachingResult;
  resourceInventory?: ResourceInventory;
  thirdParty?: ThirdPartyAnalysis;
}
