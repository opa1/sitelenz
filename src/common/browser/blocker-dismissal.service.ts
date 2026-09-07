import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { GroqService } from '../../ai/groq.service';

export type DismissalMethod = 'heuristic' | 'ai' | 'none';

export interface DismissalResult {
  dismissed: boolean;
  method: DismissalMethod;
}

/**
 * Known selectors for common cookie/consent-management platforms. Hiding
 * (not clicking "Accept") is deliberate: this tool never wants to be the one
 * "consenting" to anything on a site's behalf - it only needs the overlay
 * out of the way for a clean screenshot.
 */
const KNOWN_OVERLAY_SELECTORS = [
  // OneTrust
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '.onetrust-pc-dark-filter',
  // Cookiebot
  '#CybotCookiebotDialog',
  '#CybotCookiebotDialogBodyUnderlay',
  // Quantcast Choice
  '.qc-cmp2-container',
  // TrustArc
  '#truste-consent-track',
  '#trustarc-banner-overlay',
  // Osano
  '.osano-cm-window',
  '.osano-cm-dialog',
  // Didomi
  '#didomi-host',
  '.didomi-popup-container',
  // Generic cookie/consent/GDPR patterns
  '[id*="cookie-banner" i]',
  '[class*="cookie-banner" i]',
  '[id*="cookie-consent" i]',
  '[class*="cookie-consent" i]',
  '[id*="cookie-notice" i]',
  '[class*="cookie-notice" i]',
  '[id*="gdpr" i]',
  '[class*="gdpr" i]',
  '[aria-label*="cookie" i]',
  // Generic modal/newsletter overlay patterns
  '[class*="modal-overlay" i]',
  '[class*="popup-overlay" i]',
  '[id*="newsletter-popup" i]',
  '[class*="newsletter-popup" i]',
];

const MIN_OVERLAY_VIEWPORT_COVERAGE = 0.4;
const MIN_OVERLAY_Z_INDEX = 10;

@Injectable()
export class BlockerDismissalService {
  private readonly logger = new Logger(BlockerDismissalService.name);

  constructor(private readonly groqService: GroqService) {}

  /**
   * Hides anything obscuring the page (cookie banners, promo popups, age
   * gates, ...) before a screenshot is taken. Tries fast, deterministic
   * heuristics first; only calls out to a Groq vision model if those find
   * nothing, since that's the fallback path - not the primary mechanism.
   */
  async dismissBlockers(page: Page): Promise<DismissalResult> {
    const knownHidden = await this.hideKnownSelectors(page);
    const genericHidden = await this.hideGenericOverlays(page);
    if (knownHidden || genericHidden) {
      await page.waitForTimeout(200); // let layout settle after hiding
      return { dismissed: true, method: 'heuristic' };
    }
    return this.tryAiFallback(page);
  }

  private hideKnownSelectors(page: Page): Promise<boolean> {
    return page.evaluate((selectors) => {
      let hidden = false;
      for (const selector of selectors) {
        let elements: NodeListOf<Element>;
        try {
          elements = document.querySelectorAll(selector);
        } catch {
          continue;
        }
        elements.forEach((el) => {
          (el as HTMLElement).style.setProperty('display', 'none', 'important');
          hidden = true;
        });
      }
      // Consent banners commonly lock page scroll via overflow:hidden.
      document.documentElement.style.removeProperty('overflow');
      document.body.style.removeProperty('overflow');
      return hidden;
    }, KNOWN_OVERLAY_SELECTORS);
  }

  private hideGenericOverlays(page: Page): Promise<boolean> {
    return page.evaluate(
      ({ minCoverage, minZIndex }) => {
        const viewportArea = window.innerWidth * window.innerHeight;
        let hidden = false;
        const candidates = document.querySelectorAll('body *');
        candidates.forEach((el) => {
          const style = window.getComputedStyle(el);
          if (style.position !== 'fixed' && style.position !== 'sticky') {
            return;
          }
          const zIndex = parseInt(style.zIndex, 10);
          if (Number.isNaN(zIndex) || zIndex < minZIndex) {
            return;
          }
          const rect = el.getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area < viewportArea * minCoverage) {
            return;
          }
          (el as HTMLElement).style.setProperty('display', 'none', 'important');
          hidden = true;
        });
        return hidden;
      },
      {
        minCoverage: MIN_OVERLAY_VIEWPORT_COVERAGE,
        minZIndex: MIN_OVERLAY_Z_INDEX,
      },
    );
  }

  private async tryAiFallback(page: Page): Promise<DismissalResult> {
    const viewportSize = page.viewportSize();
    if (!viewportSize) {
      return { dismissed: false, method: 'none' };
    }

    let screenshot: Buffer;
    try {
      screenshot = await page.screenshot({ type: 'png' });
    } catch (error) {
      this.logger.warn(
        `Could not capture viewport screenshot for AI blocker detection: ${(error as Error).message}`,
      );
      return { dismissed: false, method: 'none' };
    }

    const result = await this.groqService.detectBlocker(
      screenshot,
      viewportSize,
    );
    if (!result?.hasBlocker || !result.box) {
      return { dismissed: false, method: 'none' };
    }

    // Vision-model coordinates are approximate, sometimes badly so - matching
    // a single point via elementFromPoint() can land on a full-page
    // background element instead of the actual overlay. Instead:
    // 1. Only consider fixed/sticky candidates within a plausible overlay
    //    size range (3%-60% of viewport) - this alone excludes full-page
    //    backgrounds structurally, regardless of how imprecise the AI's box
    //    is, which is what actually matters for safety.
    // 2. Prefer whichever candidate the AI's box overlaps most; if it
    //    overlaps none (coordinates were off), fall back to the
    //    size-plausible candidate whose center is nearest the AI box's
    //    center, bounded to a reasonable distance.
    const hidden = await page.evaluate(
      ({ box, viewportWidth, viewportHeight }) => {
        const viewportArea = viewportWidth * viewportHeight;
        const minCoverage = 0.03;
        const maxCoverage = 0.6;
        const maxCenterDistanceFraction = 0.35; // of viewport diagonal
        const boxCenterX = box.x + box.width / 2;
        const boxCenterY = box.y + box.height / 2;
        const viewportDiagonal = Math.hypot(viewportWidth, viewportHeight);

        function intersectionArea(rect: DOMRect): number {
          const x1 = Math.max(rect.left, box.x);
          const y1 = Math.max(rect.top, box.y);
          const x2 = Math.min(rect.right, box.x + box.width);
          const y2 = Math.min(rect.bottom, box.y + box.height);
          if (x2 <= x1 || y2 <= y1) return 0;
          return (x2 - x1) * (y2 - y1);
        }

        let bestOverlap: { el: Element; score: number } | null = null;
        let bestByDistance: { el: Element; distance: number } | null = null;

        const candidates = document.querySelectorAll('body *');
        candidates.forEach((el) => {
          const style = window.getComputedStyle(el);
          if (style.position !== 'fixed' && style.position !== 'sticky') {
            return;
          }
          const rect = el.getBoundingClientRect();
          const rectArea = rect.width * rect.height;
          const coverage = rectArea / viewportArea;
          if (coverage < minCoverage || coverage > maxCoverage) {
            return;
          }

          const boxArea = box.width * box.height;
          const inter = intersectionArea(rect);
          if (inter > 0) {
            const score = inter / Math.min(rectArea, boxArea || rectArea);
            if (!bestOverlap || score > bestOverlap.score) {
              bestOverlap = { el, score };
            }
          }

          const rectCenterX = rect.left + rect.width / 2;
          const rectCenterY = rect.top + rect.height / 2;
          const distance = Math.hypot(
            rectCenterX - boxCenterX,
            rectCenterY - boxCenterY,
          );
          if (!bestByDistance || distance < bestByDistance.distance) {
            bestByDistance = { el, distance };
          }
        });

        let target: Element | null = null;
        if (bestOverlap) {
          target = (bestOverlap as { el: Element; score: number }).el;
        } else if (
          bestByDistance &&
          (bestByDistance as { el: Element; distance: number }).distance <
            viewportDiagonal * maxCenterDistanceFraction
        ) {
          target = (bestByDistance as { el: Element; distance: number }).el;
        }
        if (!target) {
          return false;
        }
        (target as HTMLElement).style.setProperty(
          'display',
          'none',
          'important',
        );
        return true;
      },
      {
        box: result.box,
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
      },
    );

    if (hidden) {
      await page.waitForTimeout(200);
    }
    return { dismissed: hidden, method: hidden ? 'ai' : 'none' };
  }
}
