import { Injectable, Logger } from '@nestjs/common';
import type { BrowserContext } from 'playwright';
import { ScreenshotType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlockerDismissalService } from '../common/browser/blocker-dismissal.service';
import { CloudinaryService } from './cloudinary.service';

export interface CapturedScreenshot {
  url: string;
  cloudinaryPublicId: string;
  takenAt: string;
}

/**
 * Captures a single viewport screenshot from an already-open browser context,
 * uploads it to Cloudinary, and records it against the analyze job. Extracted
 * from the screenshots and standard/full composite processors, which both
 * implemented this identical capture->upload->persist sequence - keeping it in
 * one place means a change to capture options, blocker handling, or the
 * persistence rule (see the retry idempotency note below) applies everywhere
 * at once.
 *
 * Deps are all globally or same-module provided (Prisma + BlockerDismissal are
 * global, Cloudinary is this module), so this lives in StorageModule with no
 * new cross-module imports.
 */
@Injectable()
export class ScreenshotCaptureService {
  private readonly logger = new Logger(ScreenshotCaptureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockerDismissalService: BlockerDismissalService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async capture(
    context: BrowserContext,
    url: string,
    analyzeJobId: string,
    type: 'desktop' | 'mobile',
  ): Promise<CapturedScreenshot> {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load' });

      const dismissal = await this.blockerDismissalService
        .dismissBlockers(page)
        .catch((error: Error) => {
          this.logger.warn(
            `Blocker dismissal failed for analyze job ${analyzeJobId} (${type}): ${error.message}`,
          );
          return { dismissed: false, method: 'none' as const };
        });
      if (dismissal.dismissed) {
        this.logger.log(
          `Dismissed a page blocker for analyze job ${analyzeJobId} (${type}) via ${dismissal.method}`,
        );
      }

      // Viewport-only, not the full scrolled page. animations: 'disabled'
      // freezes CSS animations/transitions before capture - Playwright's
      // screenshot always waits for a visually "stable" frame first regardless
      // of this option, and that wait never converges on a page with
      // continuously-running animations/video backgrounds (observed live: a
      // 120s timeout on stripe.com). Freezing animations first lets the
      // stability check succeed immediately.
      const buffer = await page.screenshot({
        fullPage: false,
        type: 'png',
        animations: 'disabled',
      });
      const uploaded = await this.cloudinaryService.uploadScreenshot(
        buffer,
        analyzeJobId,
        type,
      );
      const takenAt = new Date().toISOString();

      const screenshotType =
        type === 'desktop' ? ScreenshotType.desktop : ScreenshotType.mobile;

      // Idempotent on retry: a failed job re-run (the only way process() runs
      // twice for one id) re-captures and re-uploads. Cloudinary's public_id
      // is deterministic (`${jobId}-${type}`, overwrite: true) so the asset is
      // replaced in place, but a bare create() would still leave a duplicate
      // row each retry. Clear any prior row for this (job, type) first so the
      // screenshots table holds exactly one row per captured viewport.
      await this.prisma.screenshot.deleteMany({
        where: { analyzeJobId, type: screenshotType },
      });
      await this.prisma.screenshot.create({
        data: {
          analyzeJobId,
          type: screenshotType,
          cloudinaryUrl: uploaded.url,
          cloudinaryPublicId: uploaded.publicId,
        },
      });

      return {
        url: uploaded.url,
        cloudinaryPublicId: uploaded.publicId,
        takenAt,
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
