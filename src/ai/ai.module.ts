import { Module } from '@nestjs/common';
import { GroqService } from './groq.service';
import { GroqProvider } from './groq-provider.service';
import { AiInputBuilderService } from './ai-input-builder.service';
import { AI_PROVIDER } from './ai-provider.interface';

@Module({
  providers: [
    GroqService,
    AiInputBuilderService,
    { provide: AI_PROVIDER, useClass: GroqProvider },
  ],
  exports: [GroqService, AiInputBuilderService, AI_PROVIDER],
})
export class AiModule {}
