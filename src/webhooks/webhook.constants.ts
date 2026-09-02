export const WEBHOOK_MAX_ATTEMPTS = 4;

/**
 * WEBHOOK_RETRY_DELAYS_MS[i] is the delay before attempt i+1 (0-based index,
 * 1-based attempt number): attempt 1 immediate, attempt 2 after 30s,
 * attempt 3 after 5min, attempt 4 after 30min.
 */
export const WEBHOOK_RETRY_DELAYS_MS = [0, 30_000, 300_000, 1_800_000];

export const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;
