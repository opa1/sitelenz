import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { BrowserModule } from '../../common/browser/browser.module';
import { X402Module } from '../../x402/x402.module';
import { PerformanceModule as PerformanceAnalyzerModule } from '../../analyzers/performance/performance.module';
import { AnalyzeModule } from '../analyze.module';
import { PerformanceController } from './performance.controller';
import { PerformanceProcessor } from './performance.processor';

@Module({
  imports: [
    AnalyzeModule,
    QueueModule,
    BrowserModule,
    PerformanceAnalyzerModule,
    X402Module,
  ],
  controllers: [PerformanceController],
  providers: [PerformanceProcessor],
})
export class PerformanceAnalyzeModule {}
