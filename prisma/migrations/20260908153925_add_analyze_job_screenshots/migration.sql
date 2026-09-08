-- AlterTable
ALTER TABLE "screenshots" ADD COLUMN     "analyzeJobId" TEXT,
ALTER COLUMN "analysisId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "screenshots_analyzeJobId_idx" ON "screenshots"("analyzeJobId");
