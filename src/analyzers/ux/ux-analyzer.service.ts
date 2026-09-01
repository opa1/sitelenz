import { Injectable } from '@nestjs/common';
import type {
  LighthouseResult,
  RawObservations,
} from '../../common/browser/raw-observations.interface';
import type { Analyzer, AnalyzerOptions } from '../analyzer.interface';
import { loadHtml, type CheerioAPI } from '../../common/utils/html.util';
import { safe } from '../../common/utils/analyzer-safety.util';
import {
  getLighthouseAudit,
  getLighthouseCategoryScore,
} from '../../common/utils/lighthouse.util';
import type {
  AccessibilityAuditResult,
  AccessibilityInfo,
  ContentInfo,
  CtaInfo,
  FormsInfo,
  MobileUxInfo,
  NavigationInfo,
  ReadingExperienceInfo,
  UxResult,
  ViewportInfo,
} from './ux-result.interface';

const HAMBURGER_PATTERN = /hamburger|mobile-menu|nav-toggle|menu-toggle/i;
const CTA_CLASS_PATTERN = /\b(btn|cta)\b/i;
const ACCESSIBILITY_AUDIT_IDS = [
  'color-contrast',
  'image-alt',
  'label',
  'button-name',
];

function detectHamburgerSignal($: CheerioAPI): boolean {
  let found = false;
  $('[class], [id]').each((_, el) => {
    if (found) return false;
    const cls = $(el).attr('class') ?? '';
    const id = $(el).attr('id') ?? '';
    if (HAMBURGER_PATTERN.test(cls) || HAMBURGER_PATTERN.test(id)) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

function countCtas($: CheerioAPI): number {
  return $('a, button').filter((_, el) =>
    CTA_CLASS_PATTERN.test($(el).attr('class') ?? ''),
  ).length;
}

function buildViewport($: CheerioAPI): ViewportInfo {
  const tag = $('meta[name="viewport"]');
  return {
    hasViewportMeta: tag.length > 0,
    viewportContent: tag.attr('content') ?? null,
  };
}

function buildNavigation($: CheerioAPI): NavigationInfo {
  return {
    hasNav: $('nav').length > 0,
    navItemCount: $('nav a').length,
    hasHamburgerSignal: detectHamburgerSignal($),
  };
}

function buildForms($: CheerioAPI): FormsInfo {
  const formCount = $('form').length;
  const hasSearchForm =
    $('input[type="search"]').length > 0 ||
    $('form[class*="search" i], form[id*="search" i]').length > 0;
  const hasLoginForm = $('input[type="password"]').length > 0;

  let hasNewsletterSignal = false;
  $('form').each((_, form) => {
    if (hasNewsletterSignal) return false;
    const $form = $(form);
    if ($form.find('input[type="email"]').length === 0) return undefined;
    const text = $form.text().toLowerCase();
    const cls = ($form.attr('class') ?? '').toLowerCase();
    if (
      /subscribe|newsletter|updates/.test(text) ||
      /subscribe|newsletter|updates/.test(cls)
    ) {
      hasNewsletterSignal = true;
    }
    return undefined;
  });

  return { formCount, hasSearchForm, hasLoginForm, hasNewsletterSignal };
}

function buildCta($: CheerioAPI): CtaInfo {
  const count = countCtas($);
  return { present: count > 0, count };
}

function buildContent($: CheerioAPI): ContentInfo {
  const hasHeroClass = $('[class*="hero" i]').length > 0;
  const firstBlockHasHeroSignal =
    $('body').children().first().find('h1, img, [style*="background-image" i]')
      .length > 0;
  const hasHeroSection =
    hasHeroClass || ($('h1').length > 0 && firstBlockHasHeroSignal);

  const wordCount = $('body').text().trim().split(/\s+/).filter(Boolean).length;

  return { hasHeroSection, wordCount };
}

function buildAccessibility(lhr: LighthouseResult | null): AccessibilityInfo {
  const score = getLighthouseCategoryScore(lhr, 'accessibility');
  const audits: AccessibilityAuditResult[] = [];
  for (const id of ACCESSIBILITY_AUDIT_IDS) {
    const audit = getLighthouseAudit(lhr, id);
    if (audit) {
      audits.push({ id, score: audit.score, displayValue: audit.displayValue });
    }
  }
  return { score, audits };
}

function buildMobile(
  $: CheerioAPI,
  lhr: LighthouseResult | null,
  viewport: ViewportInfo,
  hasHamburger: boolean,
): MobileUxInfo {
  const mobileViewportConfigured =
    viewport.hasViewportMeta &&
    /width\s*=\s*device-width/i.test(viewport.viewportContent ?? '');
  const hasResponsiveImages = $('img[srcset], img[sizes]').length > 0;
  const tapTargetsAudit = getLighthouseAudit(lhr, 'tap-targets');
  const touchTargetIssues =
    typeof tapTargetsAudit?.score === 'number' && tapTargetsAudit.score < 0.9;

  return {
    mobileViewportConfigured,
    hasResponsiveImages,
    hasMobileMenu: hasHamburger,
    touchTargetIssues,
  };
}

function buildReadingExperience($: CheerioAPI): ReadingExperienceInfo {
  const paragraphs = $('p');
  const paragraphCount = paragraphs.length;
  let totalWords = 0;
  paragraphs.each((_, el) => {
    const text = $(el).text().trim();
    if (text) totalWords += text.split(/\s+/).filter(Boolean).length;
  });
  const avgWordsPerParagraph =
    paragraphCount > 0 ? Math.round(totalWords / paragraphCount) : 0;

  const hasMaxWidthStyle =
    $(
      '[class*="container" i], [class*="content" i], [class*="prose" i]',
    ).filter((_, el) => /max-width/i.test($(el).attr('style') ?? '')).length >
    0;
  const hasTailwindMaxWidthClass =
    /max-w-(prose|xl|2xl|3xl|4xl|screen|\d)/i.test(safe(() => $.html(), ''));
  const hasReadableLineLength = hasMaxWidthStyle || hasTailwindMaxWidthClass;

  return { paragraphCount, avgWordsPerParagraph, hasReadableLineLength };
}

@Injectable()
export class UxAnalyzerService implements Analyzer {
  analyze(
    observations: RawObservations,
    options: AnalyzerOptions,
  ): Promise<UxResult> {
    const $ = safe(() => loadHtml(observations.html), null);

    if (!$) {
      return Promise.resolve({
        viewport: { hasViewportMeta: false, viewportContent: null },
        navigation: {
          hasNav: false,
          navItemCount: 0,
          hasHamburgerSignal: false,
        },
        forms: {
          formCount: 0,
          hasSearchForm: false,
          hasLoginForm: false,
          hasNewsletterSignal: false,
        },
        cta: { present: false, count: 0 },
        content: { hasHeroSection: false, wordCount: 0 },
        accessibility: safe(
          () => buildAccessibility(observations.lighthouseResult),
          { score: null, audits: [] },
        ),
      });
    }

    const viewport = safe(() => buildViewport($), {
      hasViewportMeta: false,
      viewportContent: null,
    });
    const navigation = safe(() => buildNavigation($), {
      hasNav: false,
      navItemCount: 0,
      hasHamburgerSignal: false,
    });

    const result: UxResult = {
      viewport,
      navigation,
      forms: safe(() => buildForms($), {
        formCount: 0,
        hasSearchForm: false,
        hasLoginForm: false,
        hasNewsletterSignal: false,
      }),
      cta: safe(() => buildCta($), { present: false, count: 0 }),
      content: safe(() => buildContent($), {
        hasHeroSection: false,
        wordCount: 0,
      }),
      accessibility: safe(
        () => buildAccessibility(observations.lighthouseResult),
        { score: null, audits: [] },
      ),
    };

    if (options.deep) {
      result.mobile = safe(
        () =>
          buildMobile(
            $,
            observations.lighthouseResult,
            viewport,
            navigation.hasHamburgerSignal,
          ),
        {
          mobileViewportConfigured: false,
          hasResponsiveImages: false,
          hasMobileMenu: false,
          touchTargetIssues: false,
        },
      );
      result.readingExperience = safe(() => buildReadingExperience($), {
        paragraphCount: 0,
        avgWordsPerParagraph: 0,
        hasReadableLineLength: false,
      });
    }

    return Promise.resolve(result);
  }
}
