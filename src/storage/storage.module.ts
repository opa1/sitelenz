import { Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';
import { ScreenshotCaptureService } from './screenshot-capture.service';

@Module({
  providers: [CloudinaryService, ScreenshotCaptureService],
  exports: [CloudinaryService, ScreenshotCaptureService],
})
export class StorageModule {}
