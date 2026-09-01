import { Module } from '@nestjs/common';
import { TechnologyAnalyzerService } from './technology-analyzer.service';

@Module({
  providers: [TechnologyAnalyzerService],
  exports: [TechnologyAnalyzerService],
})
export class TechnologyModule {}
