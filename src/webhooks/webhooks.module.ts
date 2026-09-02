import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { WebhookService } from './webhook.service';

@Module({
  imports: [QueueModule],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhooksModule {}
