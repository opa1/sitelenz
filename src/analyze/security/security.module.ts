import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { BrowserModule } from '../../common/browser/browser.module';
import { X402Module } from '../../x402/x402.module';
import { SecurityModule as SecurityAnalyzerModule } from '../../analyzers/security/security.module';
import { AnalyzeModule } from '../analyze.module';
import { SecurityController } from './security.controller';
import { SecurityProcessor } from './security.processor';

@Module({
  imports: [
    AnalyzeModule,
    QueueModule,
    BrowserModule,
    SecurityAnalyzerModule,
    X402Module,
  ],
  controllers: [SecurityController],
  providers: [SecurityProcessor],
})
export class SecurityAnalyzeModule {}
