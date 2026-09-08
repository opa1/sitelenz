import {
  generateAnalysisId,
  generateAnalyzeJobId,
  generateCrawlObservationId,
} from './id';

describe('id generators', () => {
  it('prefixes analysis ids with sl_an_', () => {
    expect(generateAnalysisId()).toMatch(/^sl_an_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('prefixes crawl-observation ids with sl_co_', () => {
    expect(generateCrawlObservationId()).toMatch(
      /^sl_co_[0-9A-HJKMNP-TV-Z]{26}$/,
    );
  });

  it('prefixes analyze-job ids with sl_aj_', () => {
    expect(generateAnalyzeJobId()).toMatch(/^sl_aj_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('generates unique ids', () => {
    const ids = new Set(
      Array.from({ length: 1000 }, () => generateAnalyzeJobId()),
    );
    expect(ids.size).toBe(1000);
  });
});
