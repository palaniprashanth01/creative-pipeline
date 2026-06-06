import type { Intent } from "./schemas";

/** Default credits reserved per individual creative dispatch. */
export const HOLD_AMOUNT_PER_RUN = 1;

/**
 * Per-kind credit estimate. Image is cheapest (no second LLM call); landing-page
 * is the most expensive (longest structured-streaming output).
 * Bug #9 — variable hold amount per kind.
 */
export const HOLD_BY_KIND: Record<Intent, number> = {
  image: 0.5,
  email: 1.0,
  "landing-page": 1.5,
};

export function holdAmountFor(kind: Intent | null | undefined): number {
  if (!kind) return HOLD_AMOUNT_PER_RUN;
  return HOLD_BY_KIND[kind];
}

/** Below this classifier confidence the dispatch is rejected outright. */
export const CONFIDENCE_HARD_GATE = 0.6;

/** Between hard-gate and this, the operator is asked to confirm intent. */
export const CONFIDENCE_SOFT_GATE = 0.8;

/** Window during which identical (project, prompt, intent) requests are deduped. */
export const IDEMPOTENCY_WINDOW_MS = 5_000;

/** Max parallel runs in a single batch dispatch. */
export const MAX_BATCH_COUNT = 5;

/** SSE keepalive interval — defeats intermediary buffering on idle streams. */
export const SSE_HEARTBEAT_MS = 15_000;

/** How long event history is retained in the run bus for late SSE subscribers. */
export const RUN_HISTORY_TTL_MS = 5 * 60_000;

/** Bug #6 — abort the <img> shimmer if the placeholder doesn't paint in this long. */
export const IMAGE_LOAD_TIMEOUT_MS = 15_000;

/** Bug #8 — value sent in the SSE `retry:` field on terminal close so the browser
 *  doesn't auto-reconnect immediately after a done/error stream. 24 hours. */
export const SSE_TERMINAL_RETRY_MS = 86_400_000;
