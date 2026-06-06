"use server";

import { authenticateAndAuthorize } from "@/lib/auth";
import { CLASSIFIER_MODEL, classify } from "@/lib/classifier";
import {
  CONFIDENCE_HARD_GATE,
  CONFIDENCE_SOFT_GATE,
  holdAmountFor,
  IDEMPOTENCY_WINDOW_MS,
} from "@/lib/constants";
import { hold, isTerminal, release } from "@/lib/credits";
import { runDispatch } from "@/lib/orchestrator";
import { artifactRepo } from "@/lib/repos/artifacts";
import { dispatchRepo } from "@/lib/repos/dispatches";
import { emit } from "@/lib/run-bus";
import { dispatchInputZ, type Intent } from "@/lib/schemas";

export type DispatchResult =
  | { status: "ok"; runId: string; runIds: string[]; idempotent?: boolean }
  | {
      status: "ambiguous";
      suggestedKind: Intent;
      confidence: number;
    }
  | {
      /** Stretch: classifier was 0.6–0.8 confident — ask the operator to confirm. */
      status: "soft";
      suggestedKind: Intent;
      confidence: number;
    }
  | { status: "error"; message: string };

/**
 * Server-side entry point for creating one or more creative runs.
 *
 * Order of operations is load-bearing:
 *   1. Zod + auth (cheap, fail fast)
 *   2. Idempotency lookup (saves a classifier call when the user double-clicks)
 *   3. Classifier (skipped if the caller passed an explicit `intent`)
 *   4. Confidence gate (hard <0.6 = no row, soft 0.6–0.8 = confirm)
 *   5. Persist + hold + fire orchestrator (`count: N` shares ONE hold)
 *
 * The action returns immediately with `runIds`; live progress flows via SSE.
 */
export async function dispatchCreative(raw: unknown): Promise<DispatchResult> {
  const queuedAt = new Date();

  const parsed = dispatchInputZ.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }
  const input = parsed.data;

  let ctx;
  try {
    ctx = await authenticateAndAuthorize(input.projectId);
  } catch (err) {
    return { status: "error", message: friendlyError(err) };
  }

  // ----- Stretch: idempotency window -----
  // Applies to both single and batch dispatches. For a batch duplicate, return
  // every sibling run in the original fanout instead of creating another hold.
  const dup = await dispatchRepo.findRecentDuplicate({
    orgId: ctx.user.orgId,
    projectId: input.projectId,
    prompt: input.prompt,
    intent: input.intent ?? null,
    withinMs: IDEMPOTENCY_WINDOW_MS,
  });
  if (dup) {
    const runs = await dispatchRepo.findIdempotentRuns(dup);
    const runIds = runs.map((r) => r.id);
    return { status: "ok", runId: runIds[0], runIds, idempotent: true };
  }

  // ----- Classifier (with hard + soft gates) -----
  let kind = input.intent;
  let confidence: number | null = null;
  let classifierModel: string | null = null;

  // Bug #1 — inherit kind from parent on Improvise. A parent's kind is an
  // implicit explicit intent; running the classifier on the bare "make it
  // shorter" follow-up wastes a call and often fails the confidence gate.
  //
  // Tenant-scoped (PR #2 review feedback): verify the parent's dispatch is in
  // the caller's project before trusting either its kind or the lineage link.
  // If the parent is foreign, silently strip the parentArtifactId so we don't
  // persist a cross-tenant lineage reference, and let the classifier run.
  if (input.parentArtifactId) {
    try {
      const parent = await artifactRepo.findById(input.parentArtifactId);
      const parentDispatch = parent
        ? await dispatchRepo.findById(parent.dispatchId)
        : null;
      const inProject =
        parentDispatch?.projectId === ctx.project.id;
      if (!inProject) {
        input.parentArtifactId = undefined;
      } else if (!kind) {
        kind = parent!.kind as Intent;
      }
    } catch {
      // Parent lookup is best-effort; on failure, fall through to classifier
      // and leave parentArtifactId as-is (the FK insert will surface any issue).
    }
  }

  if (!kind) {
    try {
      const cls = await classify(input.prompt);
      confidence = cls.confidence;
      classifierModel = CLASSIFIER_MODEL;

      if (cls.confidence < CONFIDENCE_HARD_GATE) {
        // No row, no hold — per brief Item 3.
        return {
          status: "ambiguous",
          suggestedKind: cls.kind,
          confidence: cls.confidence,
        };
      }
      if (cls.confidence < CONFIDENCE_SOFT_GATE) {
        // Stretch: surface chips to the operator instead of running.
        return {
          status: "soft",
          suggestedKind: cls.kind,
          confidence: cls.confidence,
        };
      }
      kind = cls.kind;
    } catch (err) {
      return { status: "error", message: friendlyError(err) };
    }
  }

  // ----- Persist N rows + one shared hold + fire N orchestrators -----
  const count = input.count ?? 1;
  const batchId = count > 1 ? crypto.randomUUID() : null;
  const classifiedAt = new Date();
  const runIds: string[] = [];
  let holdId: string | null = null;

  try {
    for (let i = 0; i < count; i++) {
      const row = await dispatchRepo.create({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        prompt: input.prompt,
        intent: kind,
        confidence: confidence !== null ? confidence.toFixed(3) : null,
        classifierModel,
        status: "queued",
        batchId,
        queuedAt,
        classifiedAt,
        createdAt: queuedAt,
        updatedAt: classifiedAt,
      });
      runIds.push(row.id);
    }

    // Single hold covers the whole batch — the orchestrator's finalizer
    // settles the completed portion and releases the rest.
    // Bug #9 — hold amount varies by kind (image cheapest, landing-page priciest).
    const h = await hold({
      orgId: ctx.user.orgId,
      amount: holdAmountFor(kind) * count,
      dispatchId: runIds[0],
    });
    holdId = h.holdId;
    for (const runId of runIds) {
      await dispatchRepo.setHold(runId, h.holdId);
    }
  } catch (err) {
    await safeRelease(holdId);
    for (const runId of runIds) {
      await safeMarkFailed(runId, friendlyError(err));
      emit(runId, { type: "error", message: friendlyError(err) });
    }
    return { status: "error", message: friendlyError(err) };
  }

  // Replay-friendly: emit classified before fire-off so late SSE subscribers
  // receive the event from history.
  for (const runId of runIds) {
    emit(runId, {
      type: "classified",
      kind,
      confidence: confidence ?? 1,
      model: classifierModel ?? "explicit",
    });
  }

  for (const runId of runIds) {
    void runDispatch({
      runId,
      kind,
      prompt: input.prompt,
      holdId: holdId!,
      parentArtifactId: input.parentArtifactId,
      batchId,
      batchSize: count,
    });
  }

  return { status: "ok", runId: runIds[0], runIds };
}

/** Translates noisy upstream errors into a single sentence for the UI. */
function friendlyError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const m = err.message;
  if (/rate.?limit|429/i.test(m)) return "Groq rate-limited — try again in a moment.";
  if (/api.?key|401|unauthorized/i.test(m))
    return "Groq API key missing or invalid. Check GROQ_API_KEY.";
  if (/model.*not.*found|404/i.test(m)) return "LLM model not available on Groq.";
  if (/json.?schema|response.?format/i.test(m))
    return "Schema rejected by provider — please report.";
  if (/aborted/i.test(m)) return "Cancelled.";
  if (/ECONN|ENOTFOUND|fetch/i.test(m)) return "Network problem reaching Groq.";
  return m.length > 200 ? m.slice(0, 200) + "…" : m;
}

async function safeRelease(holdId: string | null): Promise<void> {
  if (!holdId) return;
  try {
    if (!(await isTerminal(holdId))) await release(holdId);
  } catch (err) {
    console.error("[dispatch] release failed:", err);
  }
}

async function safeMarkFailed(rowId: string, message: string): Promise<void> {
  try {
    await dispatchRepo.markFailed(rowId, message);
  } catch (err) {
    console.error("[dispatch] failed-status write failed:", err);
  }
}
