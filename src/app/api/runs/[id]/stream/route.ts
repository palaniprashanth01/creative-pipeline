import { NextResponse, type NextRequest } from "next/server";
import { SSE_HEARTBEAT_MS, SSE_TERMINAL_RETRY_MS } from "@/lib/constants";
import { authenticateAndAuthorize } from "@/lib/auth";
import { isTerminal, release } from "@/lib/credits";
import { finalizeBatchIfReady } from "@/lib/orchestrator";
import { dispatchRepo } from "@/lib/repos/dispatches";
import { abortRun, replay, subscribe, type RunEvent } from "@/lib/run-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE endpoint for a single run's progress. Emits at minimum:
 * `classified → dispatched → partial* → done | error`.
 *
 * Auth: gates on ownership of the dispatch's project before opening the
 * stream. Without this, anyone with a runId could subscribe to another
 * tenant's classified/partial/done events (horizontal IDOR).
 *
 * Behaviour:
 *  - On connect, replays any events buffered before subscription so the
 *    client never misses the early phases.
 *  - Heartbeats every 15s to defeat proxy buffering on idle streams.
 *  - On client disconnect (closed tab, killed network), aborts the in-flight
 *    LLM call. Single runs release immediately; batch runs defer shared-hold
 *    accounting to the batch finalizer so one cancelled sibling cannot release
 *    credits reserved for siblings that may still succeed.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;
  const encoder = new TextEncoder();

  // Gate BEFORE opening the stream so a forbidden caller never gets a
  // text/event-stream response (which they might tail forever).
  const initial = await dispatchRepo.findById(runId);
  if (!initial) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    await authenticateAndAuthorize(initial.projectId);
  } catch {
    // Mirror the not-found response so we don't leak existence of the run.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* double-close is fine */
        }
      };

      const send = (event: RunEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, SSE_HEARTBEAT_MS);

      for (const e of replay(runId)) send(e);

      const unsub = subscribe(runId, (e) => {
        send(e);
        if (e.type === "done" || e.type === "error") {
          // Bug #8 — tell the browser EventSource to wait a long time before
          // reconnecting, since the run is terminal and there's nothing left
          // to stream. Defeats the auto-reconnect-on-close behaviour.
          try {
            controller.enqueue(
              encoder.encode(`retry: ${SSE_TERMINAL_RETRY_MS}\n\n`),
            );
          } catch {
            /* already closed */
          }
          unsub();
          clearInterval(heartbeat);
          close();
        }
      });

      req.signal.addEventListener("abort", async () => {
        try {
          unsub();
          clearInterval(heartbeat);
          abortRun(runId);

          const row = await dispatchRepo.findById(runId);
          if (!row?.holdId || row.status === "done") return;

          try {
            await dispatchRepo.markFailed(runId, "client aborted");
          } catch (e) {
            console.error("[sse abort] failed-status update failed:", e);
          }

          if (row.batchId) {
            await finalizeBatchIfReady(row.batchId, row.holdId);
          } else if (!(await isTerminal(row.holdId))) {
            try {
              await release(row.holdId);
            } catch (e) {
              console.error("[sse abort] release failed:", e);
            }
          }
        } catch (e) {
          console.error("[sse abort] handler crashed:", e);
        } finally {
          close();
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
