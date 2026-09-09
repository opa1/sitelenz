-- Remove the legacy v1 surface (Analysis / AnalysisReport / WebhookDelivery)
-- and two never-read/written AnalyzeJob columns. The live v2 tables
-- (screenshots, crawl_observations, analyze_jobs, analyze_webhook_deliveries)
-- are kept.

-- Detach the screenshots table from the v1 analyses table (screenshots itself
-- stays, keyed by analyzeJobId for v2).
ALTER TABLE "screenshots" DROP CONSTRAINT IF EXISTS "screenshots_analysisId_fkey";
DROP INDEX IF EXISTS "screenshots_analysisId_idx";
ALTER TABLE "screenshots" DROP COLUMN IF EXISTS "analysisId";

-- Drop the v1 tables. analysis_reports and webhook_deliveries carry the only
-- foreign keys into "analyses", so they go first.
DROP TABLE IF EXISTS "analysis_reports";
DROP TABLE IF EXISTS "webhook_deliveries";
DROP TABLE IF EXISTS "analyses";

-- Drop the enum types only the v1 tables referenced. WebhookDeliveryStatus is
-- still used by analyze_webhook_deliveries and ScreenshotType by screenshots,
-- so both are kept.
DROP TYPE IF EXISTS "AnalysisStatus";
DROP TYPE IF EXISTS "AnalysisType";

-- Drop the AnalyzeJob columns nothing in the codebase ever read or wrote.
ALTER TABLE "analyze_jobs" DROP COLUMN IF EXISTS "findings";
ALTER TABLE "analyze_jobs" DROP COLUMN IF EXISTS "crawlObservationId";
