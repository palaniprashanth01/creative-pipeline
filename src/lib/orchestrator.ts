import { holdAmountFor } from "./constants";
import { isTerminal, netHeld, release, settle } from "./credits";
import {
  IMAGE_MODEL,
  RENDER_MODEL,
  renderImage,
  renderStructured,
} from "./renderers";
import { artifactRepo } from "./repos/artifacts";
import { dispatchRepo } from "./repos/dispatches";
import { emit, registerAbort } from "./run-bus";
import type { ArtifactPayload, Intent } from "./schemas";

/**
 * Run a single dispatch to completion: render → persist artifact → finalize
 * credits. Fire-and-forget from the server action; SSE observes via the run
 * bus. Every cleanup step has its own try/catch so a thrown DB error never
 * escapes — every run is guaranteed to reach a terminal `done`/`error` event.
 *
 * For batch runs (`batchSize > 1`), settle/release is deferred to
 * {@link finalizeBatchIfReady}, which runs after every sibling reaches a
 * terminal state and writes ONE settle (for completed) + ONE release (for the
 * remainder), keeping the ledger's partial-unique invariant intact.
 */
export async function runDispatch(args: {
  runId: string;
  kind: Intent;
  prompt: string;
  holdId: string;
  parentArtifactId?: string;
  batchId?: string | null;
  batchSize?: number;
}): Promise<void> {
  const ac = registerAbort(args.runId);
  const model = args.kind === "image" ? IMAGE_MODEL : RENDER_MODEL;
  const isBatch = !!args.batchId && (args.batchSize ?? 1) > 1;
  let succeeded = false;

  try {
    await dispatchRepo.markRunning(args.runId, model);
    emit(args.runId, { type: "dispatched", runId: args.runId });

    let payload: ArtifactPayload;
    if (args.kind === "image") {
      payload = renderImage({ runId: args.runId, prompt: args.prompt });
      emit(args.runId, { type: "partial", data: payload });
    } else {
      payload = await renderStructured({
        kind: args.kind,
        prompt: args.prompt,
        onPartial: (partial) =>
          emit(args.runId, { type: "partial", data: partial }),
        signal: ac.signal,
      });
    }

    const artifact = await artifactRepo.create({
      dispatchId: args.runId,
      kind: args.kind,
      payload,
      parentArtifactId: args.parentArtifactId,
    });

    if (!isBatch) {
      // Single dispatch: settle now (the brief's "settle only after persist").
      await settle(args.holdId);
    }
    succeeded = true;
    await dispatchRepo.markDone(args.runId);
    emit(args.runId, { type: "done", artifactId: artifact.id, payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const aborted =
      ac.signal.aborted ||
      /aborted/i.test(message) ||
      (err instanceof Error && err.name === "AbortError");

    if (succeeded) {
      // Settle succeeded but the final status write failed — retry the status
      // write only. Releasing now would drift the ledger.
      console.error("[orchestrator] post-settle update failed:", err);
      try {
        await dispatchRepo.markDone(args.runId);
      } catch (e) {
        console.error("[orchestrator] retry markDone failed:", e);
      }
      return;
    }

    if (!isBatch) {
      try {
        if (!(await isTerminal(args.holdId))) await release(args.holdId);
      } catch (e) {
        console.error("[orchestrator] release failed:", e);
      }
    }

    try {
      await dispatchRepo.markFailed(
        args.runId,
        aborted ? "aborted by client" : message,
      );
    } catch (e) {
      console.error("[orchestrator] failed-status update failed:", e);
    }

    emit(args.runId, {
      type: "error",
      message: aborted ? "Cancelled." : prettify(message),
    });
  } finally {
    if (isBatch && args.batchId) {
      await finalizeBatchIfReady(args.batchId, args.holdId);
    }
  }
}

/**
 * Batch settle/release coordinator. Runs after each sibling in a batch
 * terminates. If all sibs are done/failed, writes exactly one settle for
 * completed-count credits and one release for the rest. Re-entry-safe via
 * `isTerminal` + the ledger's partial-unique index.
 */
export async function finalizeBatchIfReady(
  batchId: string,
  holdId: string,
): Promise<void> {
  try {
    if ((await netHeld(holdId)) <= 0) return;
    const siblings = await dispatchRepo.findBatch(batchId);
    const allTerminal = siblings.every(
      (s) => s.status === "done" || s.status === "failed",
    );
    if (!allTerminal) return;

    const completed = siblings.filter((s) => s.status === "done").length;
    const failed = siblings.length - completed;
    // Bug #9 — use the variable per-kind hold amount; all siblings in a batch
    // share the same kind, so peek at the first one.
    const perRun = holdAmountFor(siblings[0]?.intent ?? null);

    if (completed > 0) {
      try {
        await settle(holdId, completed * perRun);
      } catch (e) {
        // Bug #7 — check pg error code (23505 = unique_violation) instead of
        // regex-matching the message text, which differs across pg versions.
        if (!isUniqueViolation(e)) throw e;
        // Another sibling beat us to the settle write — fine.
      }
    }
    if (failed > 0) {
      try {
        await release(holdId, failed * perRun);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  } catch (err) {
    console.error("[orchestrator] finalizeBatch failed:", err);
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}

/** Wraps noisy upstream error messages into one short user-facing line. */
function prettify(m: string): string {
  if (/rate.?limit|429/i.test(m))
    return "Rate-limited by the LLM — retry in a moment.";
  if (/json.?schema|response.?format/i.test(m))
    return "The model returned an unexpected shape.";
  if (/ECONN|ENOTFOUND|fetch/i.test(m)) return "Network problem reaching the LLM.";
  if (/api.?key|401/i.test(m)) return "LLM credentials problem.";
  return m.length > 160 ? m.slice(0, 160) + "…" : m;
}
