import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { BrowserModule } from '../../common/browser/browser.module';
import { X402Module } from '../../x402/x402.module';
import { StorageModule } from '../../storage/storage.module';
import { AnalyzeModule } from '../analyze.module';
import { ScreenshotsController } from './screenshots.controller';
import { ScreenshotsProcessor } from './screenshots.processor';

@Module({
  imports: [AnalyzeModule, QueueModule, BrowserModule, StorageModule, X402Module],
  controllers: [ScreenshotsController],
  providers: [ScreenshotsProcessor],
})
export class ScreenshotsAnalyzeModule {}
