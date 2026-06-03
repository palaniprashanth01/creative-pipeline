import { RUN_HISTORY_TTL_MS } from "./constants";
import type { Intent, ArtifactPayload } from "./schemas";

export type RunEvent =
  | { type: "classified"; kind: Intent; confidence: number; model: string }
  | { type: "dispatched"; runId: string }
  | { type: "partial"; data: Partial<ArtifactPayload> }
  | { type: "done"; artifactId: string; payload: ArtifactPayload }
  | { type: "error"; message: string };

type Listener = (event: RunEvent) => void;

// Hot-reload-safe singletons. In Next.js dev (Turbopack) modules are reloaded
// on edit, which produces fresh Maps in each module instance. The server
// action and the SSE route can end up holding different Maps and never
// communicate. Pinning to globalThis fixes that.
const g = globalThis as unknown as {
  __runBus?: {
    buses: Map<string, Set<Listener>>;
    aborts: Map<string, AbortController>;
    history: Map<string, RunEvent[]>;
  };
};
g.__runBus ??= {
  buses: new Map(),
  aborts: new Map(),
  history: new Map(),
};
const { buses, aborts, history } = g.__runBus;


/** Register an AbortController for a run so the SSE route can cancel the LLM. */
export function registerAbort(runId: string): AbortController {
  const ac = new AbortController();
  aborts.set(runId, ac);
  return ac;
}

export function abortRun(runId: string): void {
  aborts.get(runId)?.abort();
  aborts.delete(runId);
}

export function emit(runId: string, event: RunEvent): void {
  const log = history.get(runId) ?? [];
  log.push(event);
  history.set(runId, log);

  const subs = buses.get(runId);
  if (subs) for (const fn of subs) fn(event);

  if (event.type === "done" || event.type === "error") {
    setTimeout(() => {
      history.delete(runId);
      buses.delete(runId);
      aborts.delete(runId);
    }, RUN_HISTORY_TTL_MS);
  }
}

export function subscribe(runId: string, fn: Listener): () => void {
  let set = buses.get(runId);
  if (!set) {
    set = new Set();
    buses.set(runId, set);
  }
  set.add(fn);
  return () => set?.delete(fn);
}

export function replay(runId: string): RunEvent[] {
  return history.get(runId) ?? [];
}
