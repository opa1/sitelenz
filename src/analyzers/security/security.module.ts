import { Module } from '@nestjs/common';
import { SecurityAnalyzerService } from './security-analyzer.service';

@Module({
  providers: [SecurityAnalyzerService],
  exports: [SecurityAnalyzerService],
})
export class SecurityModule {}
