import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export type { CheerioAPI } from 'cheerio';

/**
 * Single shared cheerio entry point - analyzers import this instead of
 * depending on the `cheerio` package directly.
 */
export function loadHtml(html: string): CheerioAPI {
  return cheerio.load(html);
}
