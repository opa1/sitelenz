import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { BrowserModule } from '../../common/browser/browser.module';
import { X402Module } from '../../x402/x402.module';
import { SeoModule as SeoAnalyzerModule } from '../../analyzers/seo/seo.module';
import { AnalyzeModule } from '../analyze.module';
import { SeoController } from './seo.controller';
import { SeoProcessor } from './seo.processor';

@Module({
  imports: [AnalyzeModule, QueueModule, BrowserModule, SeoAnalyzerModule, X402Module],
  controllers: [SeoController],
  providers: [SeoProcessor],
})
export class SeoAnalyzeModule {}
