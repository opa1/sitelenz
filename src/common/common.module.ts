import { Global, Module } from '@nestjs/common';
import { UrlValidatorService } from './utils/url-validator.service';

@Global()
@Module({
  providers: [UrlValidatorService],
  exports: [UrlValidatorService],
})
export class CommonModule {}
