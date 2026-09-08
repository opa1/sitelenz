import { Injectable } from '@nestjs/common';
import { CrawlType, type CrawlObservation, type Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../config';
import { generateCrawlObservationId } from '../common/utils/id';
import { sanitizeForJsonb } from '../common/utils/json-sanitize.util';

export interface StoreCrawlObservationParams {
  url: string;
  normalizedUrl: string;
  rawObservations: Prisma.InputJsonValue;
  crawlType: CrawlType;
}

@Injectable()
export class CrawlCacheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfigService: AppConfigService,
  ) {}

  /**
   * A stored `full` crawl satisfies a `lightweight` request (it's a
   * superset of the observations a lightweight crawl would produce), but not
   * the other way around - only an exact `full` match satisfies a `full`
   * request.
   */
  async getFreshObservation(
    normalizedUrl: string,
    crawlType: 'lightweight' | 'full',
  ): Promise<CrawlObservation | null> {
    return this.prisma.crawlObservation.findFirst({
      where: {
        normalizedUrl,
        expiresAt: { gt: new Date() },
        crawlType:
          crawlType === 'full'
            ? CrawlType.full
            : { in: [CrawlType.lightweight, CrawlType.full] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async storeCrawlObservation(
    params: StoreCrawlObservationParams,
  ): Promise<CrawlObservation> {
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() +
        this.appConfigService.analysisCacheTtlHours * 60 * 60 * 1000,
    );

    return this.prisma.crawlObservation.create({
      data: {
        id: generateCrawlObservationId(),
        url: params.url,
        normalizedUrl: params.normalizedUrl,
        // rawObservations is derived from fetched HTML/text - Postgres's
        // jsonb rejects embedded NUL bytes and lone UTF-16 surrogates
        // outright (22P05 "unsupported Unicode escape sequence"), both of
        // which real-world pages can produce.
        rawObservations: sanitizeForJsonb(params.rawObservations),
        crawlType: params.crawlType,
        createdAt,
        expiresAt,
      },
    });
  }

  isExpired(observation: CrawlObservation): boolean {
    return observation.expiresAt.getTime() <= Date.now();
  }
}
