import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { AppConfigService } from '../config';

export interface ScreenshotUploadResult {
  url: string;
  publicId: string;
}

@Injectable()
export class CloudinaryService {
  constructor(private readonly appConfigService: AppConfigService) {
    cloudinary.config({
      cloud_name: this.appConfigService.cloudinaryCloudName,
      api_key: this.appConfigService.cloudinaryApiKey,
      api_secret: this.appConfigService.cloudinaryApiSecret,
    });
  }

  uploadScreenshot(
    buffer: Buffer,
    analysisId: string,
    type: 'desktop' | 'mobile',
  ): Promise<ScreenshotUploadResult> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `sitelenz/screenshots/${analysisId}`,
          public_id: `${analysisId}-${type}`,
          resource_type: 'image',
          overwrite: true,
        },
        (error, result) => {
          if (error || !result) {
            reject(
              new Error(
                error?.message ?? 'Cloudinary upload returned no result',
              ),
            );
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }
}
