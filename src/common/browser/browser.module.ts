import { Global, Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { BrowserService } from './browser.service';
import { ObservationCollector } from './observation-collector.service';
import { LighthouseService } from './lighthouse.service';
import { BlockerDismissalService } from './blocker-dismissal.service';

@Global()
@Module({
  imports: [AiModule],
  providers: [
    BrowserService,
    ObservationCollector,
    LighthouseService,
    BlockerDismissalService,
  ],
  exports: [
    BrowserService,
    ObservationCollector,
    LighthouseService,
    BlockerDismissalService,
  ],
})
export class BrowserModule {}
