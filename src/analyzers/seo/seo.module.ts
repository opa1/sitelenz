import { Module } from '@nestjs/common';
import { SeoAnalyzerService } from './seo-analyzer.service';

@Module({
  providers: [SeoAnalyzerService],
  exports: [SeoAnalyzerService],
})
export class SeoModule {}
