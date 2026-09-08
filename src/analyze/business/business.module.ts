import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { BrowserModule } from '../../common/browser/browser.module';
import { X402Module } from '../../x402/x402.module';
import { BusinessModule as BusinessAnalyzerModule } from '../../analyzers/business/business.module';
import { AnalyzeModule } from '../analyze.module';
import { BusinessController } from './business.controller';
import { BusinessProcessor } from './business.processor';

@Module({
  imports: [
    AnalyzeModule,
    QueueModule,
    BrowserModule,
    BusinessAnalyzerModule,
    X402Module,
  ],
  controllers: [BusinessController],
  providers: [BusinessProcessor],
})
export class BusinessAnalyzeModule {}
