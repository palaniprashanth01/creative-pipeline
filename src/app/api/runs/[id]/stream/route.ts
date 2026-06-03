import type { NextRequest } from "next/server";
import { SSE_HEARTBEAT_MS } from "@/lib/constants";
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
