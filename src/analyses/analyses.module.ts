import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { X402Module } from '../x402/x402.module';
import { AnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';
import { UrlValidationInterceptor } from './interceptors/url-validation.interceptor';

@Module({
  imports: [QueueModule, X402Module],
  controllers: [AnalysesController],
  providers: [AnalysesService, UrlValidationInterceptor],
})
export class AnalysesModule {}
