import { Module } from '@nestjs/common';
import { UxAnalyzerService } from './ux-analyzer.service';

@Module({
  providers: [UxAnalyzerService],
  exports: [UxAnalyzerService],
})
export class UxModule {}
