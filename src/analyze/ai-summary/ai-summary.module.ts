import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { X402Module } from '../../x402/x402.module';
import { AiModule } from '../../ai/ai.module';
import { AnalyzeModule } from '../analyze.module';
import { AiSummaryController } from './ai-summary.controller';
import { AiSummaryProcessor } from './ai-summary.processor';

@Module({
  imports: [AnalyzeModule, QueueModule, AiModule, X402Module],
  controllers: [AiSummaryController],
  providers: [AiSummaryProcessor],
})
export class AiSummaryAnalyzeModule {}
