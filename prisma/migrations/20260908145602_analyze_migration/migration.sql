-- CreateEnum
CREATE TYPE "CrawlType" AS ENUM ('lightweight', 'full');

-- CreateEnum
CREATE TYPE "AnalyzeJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "crawl_observations" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "rawObservations" JSONB NOT NULL,
    "crawlType" "CrawlType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawl_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analyze_jobs" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "status" "AnalyzeJobStatus" NOT NULL DEFAULT 'queued',
    "progressStage" TEXT NOT NULL DEFAULT 'queued',
    "errorMessage" TEXT,
    "webhookUrl" TEXT,
    "crawlObservationId" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "analyze_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analyze_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "analyzeJobId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analyze_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crawl_observations_normalizedUrl_crawlType_createdAt_idx" ON "crawl_observations"("normalizedUrl", "crawlType", "createdAt");

-- CreateIndex
CREATE INDEX "analyze_jobs_normalizedUrl_endpoint_status_createdAt_idx" ON "analyze_jobs"("normalizedUrl", "endpoint", "status", "createdAt");

-- CreateIndex
CREATE INDEX "analyze_webhook_deliveries_analyzeJobId_idx" ON "analyze_webhook_deliveries"("analyzeJobId");

-- AddForeignKey
ALTER TABLE "analyze_webhook_deliveries" ADD CONSTRAINT "analyze_webhook_deliveries_analyzeJobId_fkey" FOREIGN KEY ("analyzeJobId") REFERENCES "analyze_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
