import { Injectable, Logger } from '@nestjs/common';
import Groq from 'groq-sdk';
import { AppConfigService } from '../config';

const VISION_MODEL = 'qwen/qwen3.6-27b';

export interface BlockerBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockerDetectionResult {
  hasBlocker: boolean;
  box: BlockerBoundingBox | null;
}

@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);
  private readonly client: Groq;

  constructor(private readonly appConfigService: AppConfigService) {
    this.client = new Groq({ apiKey: this.appConfigService.groqApiKey });
  }

  /**
   * Asks a Groq vision model whether a screenshot is blocked by a modal,
   * cookie/consent banner, newsletter popup, age gate, etc., and if so, its
   * approximate pixel bounding box within the given viewport dimensions.
   * Returns null on any failure (network, bad JSON, missing key) — this is
   * a best-effort fallback, never a hard dependency.
   *
   * Deliberately does not use response_format: json_object — Groq's
   * server-side JSON-schema enforcement on this vision model proved flaky in
   * practice (400 json_validate_failed with an empty failed_generation, even
   * at temperature 0, on otherwise-valid requests). Plain-text mode plus
   * lenient client-side parsing is more reliable for this fallback path.
   */
  async detectBlocker(
    screenshot: Buffer,
    viewport: { width: number; height: number },
  ): Promise<BlockerDetectionResult | null> {
    if (!this.appConfigService.groqApiKey) {
      return null;
    }

    const attempts = 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await this.requestDetection(screenshot, viewport);
        if (result) {
          return result;
        }
      } catch (error) {
        this.logger.warn(
          `Groq blocker detection attempt ${attempt}/${attempts} failed: ${(error as Error).message}`,
        );
      }
    }
    return null;
  }

  private async requestDetection(
    screenshot: Buffer,
    viewport: { width: number; height: number },
  ): Promise<BlockerDetectionResult | null> {
    const base64 = screenshot.toString('base64');
    const response = await this.client.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0,
      max_tokens: 500,
      // Qwen 3.6 27B is a reasoning model that otherwise emits a <think>...
      // block before the answer, which was consuming the entire max_tokens
      // budget and leaving no room for the actual JSON. This model is not
      // used for anything that benefits from that reasoning.
      reasoning_effort: 'none',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `This is a ${viewport.width}x${viewport.height} pixel screenshot of a website's viewport. ` +
                'Determine whether a modal dialog, cookie/consent banner, newsletter or promo popup, ' +
                'age-verification gate, or similar overlay is blocking the main page content. ' +
                'Respond with only a single JSON object and nothing else — no markdown, no explanation — ' +
                'in exactly this shape: ' +
                '{"hasBlocker": boolean, "box": {"x": number, "y": number, "width": number, "height": number} | null}. ' +
                `"box" must be pixel coordinates within the ${viewport.width}x${viewport.height} image bounding ` +
                'the blocking element (not just its close button), or null when hasBlocker is false.',
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64}` },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    return content ? this.parseDetectionResult(content) : null;
  }

  private parseDetectionResult(content: string): BlockerDetectionResult | null {
    const jsonText = this.extractJsonObject(content);
    if (!jsonText) {
      return null;
    }
    let parsed: Partial<BlockerDetectionResult>;
    try {
      parsed = JSON.parse(jsonText) as Partial<BlockerDetectionResult>;
    } catch {
      return null;
    }
    if (!parsed.hasBlocker) {
      return { hasBlocker: false, box: null };
    }
    if (
      parsed.box &&
      typeof parsed.box.x === 'number' &&
      typeof parsed.box.y === 'number' &&
      typeof parsed.box.width === 'number' &&
      typeof parsed.box.height === 'number'
    ) {
      return { hasBlocker: true, box: parsed.box };
    }
    return null;
  }

  /** Models occasionally wrap JSON in markdown fences or add stray text. */
  private extractJsonObject(content: string): string | null {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }
    const match = /\{[\s\S]*\}/.exec(trimmed);
    return match ? match[0] : null;
  }
}
