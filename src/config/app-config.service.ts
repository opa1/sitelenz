import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration, Network, NetworkConfig } from './configuration';

@Injectable()
export class AppConfigService {
  constructor(
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {}

  get version(): string {
    return this.configService.get('version', { infer: true });
  }

  get network(): Network {
    return this.configService.get('network', { infer: true });
  }

  get activeNetworkConfig(): NetworkConfig {
    const networks = this.configService.get('networks', { infer: true });
    return networks[this.network];
  }

  get algorandNodeUrl(): string {
    return this.activeNetworkConfig.algorandNodeUrl;
  }

  get x402FacilitatorUrl(): string {
    return this.activeNetworkConfig.x402FacilitatorUrl;
  }

  get payToAddress(): string {
    return this.activeNetworkConfig.payToAddress;
  }

  get usdcAssetId(): string {
    return this.activeNetworkConfig.usdcAssetId;
  }

  get databaseUrl(): string {
    return this.configService.get('database', { infer: true }).url;
  }

  get redisUrl(): string {
    return this.configService.get('redis', { infer: true }).url;
  }

  /**
   * BullMQ's `prefix` option is a path segment BullMQ itself joins with
   * `:` (producing `"<prefix>:<queue>:..."`) - a trailing colon in the env
   * var (e.g. "sitelenz:") would double up, so it's stripped here rather
   * than requiring the operator to get the format exactly right.
   */
  get redisKeyPrefix(): string | undefined {
    const prefix = this.configService
      .get('redis', { infer: true })
      .keyPrefix.replace(/:+$/, '');
    return prefix.length > 0 ? prefix : undefined;
  }

  get cloudinaryCloudName(): string {
    return this.configService.get('cloudinary', { infer: true }).cloudName;
  }

  get cloudinaryApiKey(): string {
    return this.configService.get('cloudinary', { infer: true }).apiKey;
  }

  get cloudinaryApiSecret(): string {
    return this.configService.get('cloudinary', { infer: true }).apiSecret;
  }

  get groqApiKey(): string {
    return this.configService.get('groq', { infer: true }).apiKey;
  }

  get groqModel(): string {
    return this.configService.get('groq', { infer: true }).model;
  }

  get webhookSecret(): string {
    return this.configService.get('webhook', { infer: true }).secret;
  }

  get analysisCacheTtlHours(): number {
    return this.configService.get('analysis', { infer: true }).cacheTtlHours;
  }

  get maxConcurrentAnalyses(): number {
    return this.configService.get('analysis', { infer: true })
      .maxConcurrentAnalyses;
  }

  get analysisTimeoutMs(): number {
    return this.configService.get('analysis', { infer: true }).timeoutMs;
  }

  get priceStandardUsd(): number {
    return this.configService.get('x402', { infer: true }).priceStandardUsd;
  }

  get priceDeepUsd(): number {
    return this.configService.get('x402', { infer: true }).priceDeepUsd;
  }
}
