export interface HttpsInfo {
  enabled: boolean;
  mixedContent: boolean;
}

export type HstsScore = 'strong' | 'moderate' | 'weak' | 'missing';

export interface HstsResult {
  present: boolean;
  maxAge: number | null;
  includeSubDomains: boolean;
  preload: boolean;
  score: HstsScore;
}

export type CspScore = 'present_strict' | 'present_loose' | 'missing';

export interface CspResult {
  present: boolean;
  value: string | null;
  hasUnsafeInline: boolean;
  hasUnsafeEval: boolean;
  score: CspScore;
}

export interface XContentTypeOptionsResult {
  present: boolean;
  value: string | null;
  correct: boolean;
}

export type XFrameOptionsScore = 'strong' | 'moderate' | 'missing';

export interface XFrameOptionsResult {
  present: boolean;
  value: string | null;
  score: XFrameOptionsScore;
}

export type ReferrerPolicyScore = 'strict' | 'moderate' | 'missing';

export interface ReferrerPolicyResult {
  present: boolean;
  value: string | null;
  score: ReferrerPolicyScore;
}

export interface PermissionsPolicyResult {
  present: boolean;
  value: string | null;
}

export interface SecurityHeaders {
  strictTransportSecurity: HstsResult;
  contentSecurityPolicy: CspResult;
  xContentTypeOptions: XContentTypeOptionsResult;
  xFrameOptions: XFrameOptionsResult;
  referrerPolicy: ReferrerPolicyResult;
  permissionsPolicy: PermissionsPolicyResult;
}

export interface CookieFlagSummary {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  domain: string;
}

export type CookieIssue =
  | 'missing_secure_on_https'
  | 'missing_httponly'
  | 'samesite_none_without_secure';

export interface CookiesSummary {
  total: number;
  withSecure: number;
  withHttpOnly: number;
  withSameSite: number;
  issues: CookieIssue[];
  cookies: CookieFlagSummary[];
}

export interface TlsCertificate {
  valid: boolean;
  issuer: string | null;
  subject: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysUntilExpiry: number | null;
  protocol: string | null;
}

export interface SecurityResult {
  https: HttpsInfo;
  headers: SecurityHeaders;
  securityScore: number;
  cookies?: CookiesSummary;
  tlsCertificate?: TlsCertificate | null;
}
