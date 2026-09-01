/**
 * Runs a synchronous sub-check and swallows any error so one broken
 * detection can't fail the whole analyzer.
 */
export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
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
