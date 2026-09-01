import { Module } from '@nestjs/common';
import { BusinessAnalyzerService } from './business-analyzer.service';

@Module({
  providers: [BusinessAnalyzerService],
  exports: [BusinessAnalyzerService],
})
export class BusinessModule {}
