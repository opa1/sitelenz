import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { BrowserModule } from '../../common/browser/browser.module';
import { X402Module } from '../../x402/x402.module';
import { UxModule as UxAnalyzerModule } from '../../analyzers/ux/ux.module';
import { AnalyzeModule } from '../analyze.module';
import { UxAccessibilityController } from './ux-accessibility.controller';
import { UxAccessibilityProcessor } from './ux-accessibility.processor';

@Module({
  imports: [
    AnalyzeModule,
    QueueModule,
    BrowserModule,
    UxAnalyzerModule,
    X402Module,
  ],
  controllers: [UxAccessibilityController],
  providers: [UxAccessibilityProcessor],
})
export class UxAccessibilityAnalyzeModule {}
