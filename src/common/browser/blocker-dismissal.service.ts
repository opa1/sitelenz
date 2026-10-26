import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { GroqService } from '../../ai/groq.service';

export type DismissalMethod = 'heuristic' | 'ai' | 'none';

/**
 * `dismissed` is only true when the dismissal is confirmed and passed the
 * blank-page safety check. `reverted`: everything hidden was restored because
 * the page went blank. `unconfirmed`: the AI hid something but the element its
 * box pointed at is still visible, so the hides were restored.
 */
export type DismissalOutcome =
  'dismissed' | 'reverted' | 'unconfirmed' | 'none';

export interface DismissalResult {
  dismissed: boolean;
  method: DismissalMethod;
  outcome?: DismissalOutcome;
}

/** Cheap measure of how much real, visible content is in the viewport. */
export interface PageContent {
  /** Characters of text actually visible (not covered by another element). */
  textChars: number;
  /** Grid sample points that land on text, media, or a background image. */
  contentPoints: number;
  totalPoints: number;
}

const GRID_COLUMNS = 16;
const GRID_ROWS = 9;
/** Dismissal is undone if less than this share of the content survives... */
const MIN_CONTENT_RETENTION = 0.3;
/** ...or if the viewport is left with fewer content points / chars than this. */
const BLANK_POINT_FRACTION = 0.05;
const BLANK_TEXT_CHARS = 100;

/**
 * True when dismissing made the page worse than leaving it alone: most of the
 * visible content is gone (both text and content points under 30% of the
 * baseline) or the viewport is now mostly blank. A page that was already
 * (nearly) empty before dismissal is never reverted.
 */
export function shouldRevertDismissal(
  before: PageContent,
  after: PageContent,
): boolean {
  if (before.textChars === 0 && before.contentPoints === 0) return false;
  const beforeBlank =
    before.contentPoints / before.totalPoints < BLANK_POINT_FRACTION &&
    before.textChars < BLANK_TEXT_CHARS;
  const afterBlank =
    after.contentPoints / after.totalPoints < BLANK_POINT_FRACTION &&
    after.textChars < BLANK_TEXT_CHARS;
  const textRetained =
    before.textChars === 0 ? 1 : after.textChars / before.textChars;
  const pointsRetained =
    before.contentPoints === 0 ? 1 : after.contentPoints / before.contentPoints;
  const lostMost =
    textRetained < MIN_CONTENT_RETENTION &&
    pointsRetained < MIN_CONTENT_RETENTION;
  return (afterBlank && !beforeBlank) || lostMost;
}

interface HiddenEntry {
  el: HTMLElement;
  prop: string;
  value: string;
  priority: string;
}

/** In-page state shared between the evaluate() calls of one dismissal. */
interface DismissalHooks {
  __slHidden?: HiddenEntry[];
  __slHide?: (
    el: HTMLElement,
    prop: string,
    value: string,
    priority: string,
  ) => void;
  __slProbe?: Element | null;
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
    await this.installHooks(page);
    // Baseline before touching anything: dismissal must never leave the
    // screenshot worse than not dismissing at all.
    const before = await this.measureContent(page);
    const knownHidden = await this.hideKnownSelectors(page);
    const genericHidden = await this.hideGenericOverlays(page);
    if (knownHidden || genericHidden) {
      await page.waitForTimeout(200); // let layout settle after hiding
      if (await this.passesSafetyCheck(page, before)) {
        return { dismissed: true, method: 'heuristic', outcome: 'dismissed' };
      }
      await this.revertHidden(page);
      this.logger.warn(`dismissal reverted: page went blank (${page.url()})`);
      return { dismissed: false, method: 'none', outcome: 'reverted' };
    }
    return this.tryAiFallback(page, before);
  }

  /** Resets the per-dismissal hide log and installs the recording helper. */
  private installHooks(page: Page): Promise<void> {
    return page.evaluate(() => {
      const w = window as unknown as DismissalHooks;
      const log: HiddenEntry[] = [];
      w.__slHidden = log;
      w.__slProbe = null;
      // Every style change a dismissal makes goes through here so it can be
      // undone exactly (original value and priority) by revertHidden.
      w.__slHide = (el, prop, value, priority) => {
        log.push({
          el,
          prop,
          value: el.style.getPropertyValue(prop),
          priority: el.style.getPropertyPriority(prop),
        });
        if (value === '') el.style.removeProperty(prop);
        else el.style.setProperty(prop, value, priority);
      };
    });
  }

  private revertHidden(page: Page): Promise<void> {
    return page.evaluate(() => {
      const w = window as unknown as DismissalHooks;
      const log = w.__slHidden ?? [];
      for (let i = log.length - 1; i >= 0; i--) {
        const { el, prop, value, priority } = log[i];
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
      w.__slHidden = [];
    });
  }

  private async passesSafetyCheck(
    page: Page,
    before: PageContent,
  ): Promise<boolean> {
    const after = await this.measureContent(page);
    return !shouldRevertDismissal(before, after);
  }

  /**
   * Visible-content measure used as the before/after baseline. Text only
   * counts when no opaque element covers it (a cookie wall's own text counts;
   * the page hidden behind it does not), plus a coarse grid of points that
   * land on text / media / background images so an image-only page isn't
   * "blank". Translucent or empty overlays (e.g. a dimming backdrop) are
   * looked through: the page is still visible beneath them.
   */
  private measureContent(page: Page): Promise<PageContent> {
    return page.evaluate(
      ({ columns, rows }) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const clampX = (x: number) => Math.min(Math.max(x, 0), vw - 1);
        const clampY = (y: number) => Math.min(Math.max(y, 0), vh - 1);

        // Top-to-bottom stack at a point, descending into open shadow roots.
        const stackAt = (
          x: number,
          y: number,
          root: Document | ShadowRoot = document,
        ): Element[] => {
          const out: Element[] = [];
          for (const el of root.elementsFromPoint(x, y)) {
            if (el.shadowRoot && el.shadowRoot !== root) {
              out.push(...stackAt(x, y, el.shadowRoot));
            }
            if (!out.includes(el)) out.push(el);
          }
          return out;
        };

        const mediaTags = [
          'img',
          'video',
          'canvas',
          'svg',
          'picture',
          'iframe',
          'input',
          'textarea',
          'select',
          'button',
        ];
        const isContent = (el: Element): boolean =>
          mediaTags.includes(el.tagName.toLowerCase()) ||
          el.closest('svg') !== null ||
          window.getComputedStyle(el).backgroundImage !== 'none' ||
          Array.from(el.childNodes).some(
            (n) =>
              n.nodeType === Node.TEXT_NODE &&
              (n.textContent ?? '').trim() !== '',
          );
        // An element that visually replaces what is beneath it.
        const isOpaque = (el: Element): boolean => {
          const style = window.getComputedStyle(el);
          if (parseFloat(style.opacity) < 0.9) return false;
          const m = /rgba?\(([^)]+)\)/.exec(style.backgroundColor);
          if (!m) return false;
          const parts = m[1].split(/[ ,/]+/).filter(Boolean);
          const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
          return alpha >= 0.9;
        };

        const roots: Node[] = [document.body];
        document.body.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) roots.push(el.shadowRoot);
        });

        let textChars = 0;
        let scanned = 0;
        let inViewport = 0;
        for (const root of roots) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (
            let node = walker.nextNode();
            node && scanned < 6000 && inViewport < 1500;
            node = walker.nextNode()
          ) {
            scanned++;
            const text = (node.textContent ?? '').trim();
            const parent = node.parentElement;
            if (!text || !parent) continue;
            if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
              continue;
            }
            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            if (
              rect.width <= 0 ||
              rect.height <= 0 ||
              rect.bottom <= 0 ||
              rect.top >= vh ||
              rect.right <= 0 ||
              rect.left >= vw
            ) {
              continue;
            }
            inViewport++;
            const stack = stackAt(
              clampX(rect.left + rect.width / 2),
              clampY(rect.top + rect.height / 2),
            );
            for (const el of stack) {
              if (el === parent || parent.contains(el) || el.contains(parent)) {
                textChars += text.length;
                break;
              }
              if (isOpaque(el)) break; // covered by something solid
            }
          }
        }

        let contentPoints = 0;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < columns; c++) {
            const stack = stackAt(
              clampX(((c + 0.5) * vw) / columns),
              clampY(((r + 0.5) * vh) / rows),
            );
            for (const el of stack) {
              if (isContent(el)) {
                contentPoints++;
                break;
              }
              if (isOpaque(el)) break; // a solid blank area
            }
          }
        }
        return { textChars, contentPoints, totalPoints: columns * rows };
      },
      { columns: GRID_COLUMNS, rows: GRID_ROWS },
    );
  }

  /** Whether the element the AI's box pointed at is no longer visible. */
  private probeHidden(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const probe = (window as unknown as DismissalHooks).__slProbe;
      if (!probe) return false;
      if (!probe.isConnected) return true;
      return !probe.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      });
    });
  }

  private hideKnownSelectors(page: Page): Promise<boolean> {
    return page.evaluate((selectors) => {
      const hide = (window as unknown as DismissalHooks).__slHide!;
      let hidden = false;
      for (const selector of selectors) {
        let elements: NodeListOf<Element>;
        try {
          elements = document.querySelectorAll(selector);
        } catch {
          continue;
        }
        elements.forEach((el) => {
          hide(el as HTMLElement, 'display', 'none', 'important');
          hidden = true;
        });
      }
      // Consent banners commonly lock page scroll via overflow:hidden.
      hide(document.documentElement, 'overflow', '', '');
      hide(document.body, 'overflow', '', '');
      return hidden;
    }, KNOWN_OVERLAY_SELECTORS);
  }

  private hideGenericOverlays(page: Page): Promise<boolean> {
    return page.evaluate(
      ({ minCoverage, minZIndex }) => {
        const hide = (window as unknown as DismissalHooks).__slHide!;
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
          hide(el as HTMLElement, 'display', 'none', 'important');
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

  private async tryAiFallback(
    page: Page,
    baseline?: PageContent,
  ): Promise<DismissalResult> {
    if (!baseline) {
      await this.installHooks(page);
    }
    const before = baseline ?? (await this.measureContent(page));
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
        const w = window as unknown as DismissalHooks;
        const hide = w.__slHide!;
        const viewportArea = viewportWidth * viewportHeight;
        const minCoverage = 0.03;
        // A full-screen consent dialog (common on mobile) is itself the
        // blocker, so when the AI's own box covers most of the viewport the
        // size cap that guards against hiding full-page backgrounds is lifted.
        const boxCoverage = (box.width * box.height) / viewportArea;
        const maxCoverage = boxCoverage >= 0.6 ? 1.01 : 0.6;
        const maxCenterDistanceFraction = 0.35; // of viewport diagonal
        const boxCenterX = box.x + box.width / 2;
        const boxCenterY = box.y + box.height / 2;
        const viewportDiagonal = Math.hypot(viewportWidth, viewportHeight);

        // The element the model's box points at; checked afterwards so
        // "dismissed" is only reported when that element is really gone.
        let probe = document.elementFromPoint(
          Math.min(Math.max(boxCenterX, 0), viewportWidth - 1),
          Math.min(Math.max(boxCenterY, 0), viewportHeight - 1),
        );
        while (probe?.shadowRoot) {
          const inner = probe.shadowRoot.elementFromPoint(
            Math.min(Math.max(boxCenterX, 0), viewportWidth - 1),
            Math.min(Math.max(boxCenterY, 0), viewportHeight - 1),
          );
          if (!inner || inner === probe) break;
          probe = inner;
        }
        w.__slProbe = probe;

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

        // Consent managers often render inside an open shadow root, which
        // querySelectorAll('body *') does not enter - without descending into
        // them the real banner is invisible here and an unrelated sticky
        // header ends up nearest the AI's box and gets hidden instead.
        const candidates: Element[] = [];
        const collect = (root: ParentNode) => {
          root.querySelectorAll('*').forEach((el) => {
            candidates.push(el);
            if (el.shadowRoot) collect(el.shadowRoot);
          });
        };
        collect(document.body);
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
            // Intersection over union, not over the smaller area: a small
            // sticky header sitting wholly inside a large AI box would
            // otherwise score a perfect 1 and beat the real overlay.
            const score = inter / (rectArea + boxArea - inter);
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
        hide(target as HTMLElement, 'display', 'none', 'important');
        return true;
      },
      {
        box: result.box,
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
      },
    );

    if (!hidden) {
      return { dismissed: false, method: 'none', outcome: 'none' };
    }
    await page.waitForTimeout(200);

    const confirmed = await this.probeHidden(page);
    const safe = await this.passesSafetyCheck(page, before);
    if (confirmed && safe) {
      return { dismissed: true, method: 'ai', outcome: 'dismissed' };
    }

    // Hiding something that isn't the blocker (or blanking the page) can only
    // make the screenshot worse, so put everything back.
    await this.revertHidden(page);
    if (!safe) {
      this.logger.warn(`dismissal reverted: page went blank (${page.url()})`);
      return { dismissed: false, method: 'none', outcome: 'reverted' };
    }
    this.logger.warn(
      `dismissal attempted, not confirmed (${page.url()}) - hidden elements restored`,
    );
    return { dismissed: false, method: 'none', outcome: 'unconfirmed' };
  }
}
