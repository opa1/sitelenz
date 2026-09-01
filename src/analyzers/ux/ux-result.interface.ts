export interface ViewportInfo {
  hasViewportMeta: boolean;
  viewportContent: string | null;
}

export interface NavigationInfo {
  hasNav: boolean;
  navItemCount: number;
  hasHamburgerSignal: boolean;
}

export interface FormsInfo {
  formCount: number;
  hasSearchForm: boolean;
  hasLoginForm: boolean;
  hasNewsletterSignal: boolean;
}

export interface CtaInfo {
  present: boolean;
  count: number;
}

export interface ContentInfo {
  hasHeroSection: boolean;
  wordCount: number;
}

export interface AccessibilityAuditResult {
  id: string;
  score: number | null;
  displayValue?: string;
}

export interface AccessibilityInfo {
  score: number | null;
  audits: AccessibilityAuditResult[];
}

export interface MobileUxInfo {
  mobileViewportConfigured: boolean;
  hasResponsiveImages: boolean;
  hasMobileMenu: boolean;
  touchTargetIssues: boolean;
}

export interface ReadingExperienceInfo {
  paragraphCount: number;
  avgWordsPerParagraph: number;
  hasReadableLineLength: boolean;
}

export interface UxResult {
  viewport: ViewportInfo;
  navigation: NavigationInfo;
  forms: FormsInfo;
  cta: CtaInfo;
  content: ContentInfo;
  accessibility: AccessibilityInfo;
  mobile?: MobileUxInfo;
  readingExperience?: ReadingExperienceInfo;
}
