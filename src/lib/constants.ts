/** Credits reserved per individual creative dispatch. */
export const HOLD_AMOUNT_PER_RUN = 1;

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
