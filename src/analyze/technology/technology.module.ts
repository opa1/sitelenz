import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { BrowserModule } from '../../common/browser/browser.module';
import { X402Module } from '../../x402/x402.module';
import { TechnologyModule as TechnologyAnalyzerModule } from '../../analyzers/technology/technology.module';
import { AnalyzeModule } from '../analyze.module';
import { TechnologyController } from './technology.controller';
import { TechnologyProcessor } from './technology.processor';

@Module({
  imports: [
    AnalyzeModule,
    QueueModule,
    BrowserModule,
    TechnologyAnalyzerModule,
    X402Module,
  ],
  controllers: [TechnologyController],
  providers: [TechnologyProcessor],
})
export class TechnologyAnalyzeModule {}
