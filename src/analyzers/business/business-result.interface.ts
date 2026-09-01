export type FieldSource = 'observed' | 'inferred' | 'unknown';

export interface SourcedValue<T> {
  value: T;
  source: FieldSource;
}

export interface SocialLink {
  platform: string;
  url: string;
}

export interface NavLink {
  text: string;
  href: string;
}

export interface BusinessModelSignals {
  hasSaasSignals: SourcedValue<boolean>;
  hasEcommerceSignals: SourcedValue<boolean>;
  hasMarketplaceSignals: SourcedValue<boolean>;
}

export interface BusinessResult {
  businessName: SourcedValue<string | null>;
  pageTitle: string;
  description: SourcedValue<string | null>;
  language: string | null;
  email: string[];
  phone: string[];
  socialLinks: SocialLink[];
  hasContactPage: boolean;
  hasSupportPage: boolean;
  hasPricing: boolean;
  hasFreeTrialSignal: boolean;
  hasEnterpriseSignal: boolean;
  primaryCta: string | null;
  ctaUrl: string | null;
  allCtaTexts?: string[];
  pricingLinks?: string[];
  navLinks?: NavLink[];
  footerLinks?: NavLink[];
  productNames?: SourcedValue<string[]>;
  businessModel: BusinessModelSignals;
}
