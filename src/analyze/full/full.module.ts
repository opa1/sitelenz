import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { BrowserModule } from '../../common/browser/browser.module';
import { X402Module } from '../../x402/x402.module';
import { StorageModule } from '../../storage/storage.module';
import { AiModule } from '../../ai/ai.module';
import { TechnologyModule } from '../../analyzers/technology/technology.module';
import { SeoModule } from '../../analyzers/seo/seo.module';
import { SecurityModule } from '../../analyzers/security/security.module';
import { PerformanceModule } from '../../analyzers/performance/performance.module';
import { BusinessModule } from '../../analyzers/business/business.module';
import { UxModule } from '../../analyzers/ux/ux.module';
import { AnalyzeModule } from '../analyze.module';
import { FullController } from './full.controller';
import { FullProcessor } from './full.processor';

@Module({
  imports: [
    AnalyzeModule,
    QueueModule,
    BrowserModule,
    StorageModule,
    AiModule,
    TechnologyModule,
    SeoModule,
    SecurityModule,
    PerformanceModule,
    BusinessModule,
    UxModule,
    X402Module,
  ],
  controllers: [FullController],
  providers: [FullProcessor],
})
export class FullAnalyzeModule {}
