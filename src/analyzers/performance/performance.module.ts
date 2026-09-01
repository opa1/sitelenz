import { Module } from '@nestjs/common';
import { PerformanceAnalyzerService } from './performance-analyzer.service';

@Module({
  providers: [PerformanceAnalyzerService],
  exports: [PerformanceAnalyzerService],
})
export class PerformanceModule {}
