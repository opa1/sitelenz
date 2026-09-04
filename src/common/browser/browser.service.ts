import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { AppConfigService } from '../../config';
import { findFreePort } from './free-port';

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-zygote',
];

/**
 * Owns a single shared Chromium instance for the whole app. Launched with an
 * explicit --remote-debugging-port so Lighthouse can attach to the same
 * browser process over CDP (see LighthouseService) instead of spawning its
 * own Chrome.
 */
@Injectable()
export class BrowserService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private currentDebugPort = 0;

  constructor(private readonly appConfigService: AppConfigService) {}

  get debugPort(): number {
    return this.currentDebugPort;
  }

  onModuleInit(): void {
    // Fire-and-forget, not awaited: Nest resolves every onModuleInit hook
    // before main.ts's app.listen() runs, so awaiting a Chromium launch here
    // blocks the HTTP server from binding to any port until it finishes. On
    // Render's Docker deploy that meant the port-scan timeout gave up with
    // "no open ports detected" before Chromium ever came up. Launching in
    // the background still warms the browser for the first request; if this
    // hasn't resolved yet (or failed) by then, acquireContext()/
    // acquireMobileContext() fall back to getBrowser()'s own lazy launch.
    this.getBrowser().catch((error: Error) => {
      this.logger.error(
        `Startup Chromium launch failed: ${error.message}`,
        error.stack,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) {
      await browser.close().catch((error: Error) => {
        this.logger.warn(`Error closing browser: ${error.message}`);
      });
    }
  }

  async acquireContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: DESKTOP_USER_AGENT,
      viewport: { width: 1280, height: 720 }, // 16:9, matches a video frame
      javaScriptEnabled: true,
    });
    this.applyTimeout(context);
    return context;
  }

  async acquireMobileContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: MOBILE_USER_AGENT,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      javaScriptEnabled: true,
    });
    this.applyTimeout(context);
    return context;
  }

  private applyTimeout(context: BrowserContext): void {
    const timeoutMs = this.appConfigService.analysisTimeoutMs;
    context.setDefaultTimeout(timeoutMs);
    context.setDefaultNavigationTimeout(timeoutMs);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }
    if (this.launching) {
      return this.launching;
    }
    this.launching = this.launchBrowser();
    try {
      this.browser = await this.launching;
      return this.browser;
    } finally {
      this.launching = null;
    }
  }

  private async launchBrowser(): Promise<Browser> {
    this.currentDebugPort = await findFreePort();
    this.logger.log(
      `Launching Chromium (CDP debug port ${this.currentDebugPort})`,
    );
    const browser = await chromium.launch({
      headless: true,
      // "chromium" channel opts into new-headless-mode on the regular
      // Chromium binary. Without it, headless:true launches a separate
      // chrome-headless-shell executable that "playwright install chromium"
      // does not download.
      channel: 'chromium',
      args: [
        ...LAUNCH_ARGS,
        `--remote-debugging-port=${this.currentDebugPort}`,
      ],
    });
    browser.on('disconnected', () => {
      this.logger.warn('Chromium disconnected; will relaunch on next use');
      if (this.browser === browser) {
        this.browser = null;
      }
    });
    return browser;
  }
}
