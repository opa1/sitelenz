import { Logger } from '@nestjs/common';

const logger = new Logger('AnalyzerSafety');

/**
 * Builds a `safe()` bound to one analyzer, so every one of its ~60 call
 * sites logs which analyzer a failing sub-check belongs to without having
 * to pass that name in at every call site individually.
 */
export function createSafe(analyzerName: string) {
  /**
   * Runs a synchronous sub-check and swallows any error so one broken
   * detection can't fail the whole analyzer. Logs a warning first — a
   * silent fallback previously made it impossible to tell which specific
   * detector inside which analyzer was failing.
   */
  return function safe<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (error) {
      logger.warn(
        `[${analyzerName}] sub-check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return fallback;
    }
  };
}

/**
 * Runs an async sub-check with its own timeout/error guard so a single slow
 * or failing network call can't blow the analyzer's overall time budget.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
