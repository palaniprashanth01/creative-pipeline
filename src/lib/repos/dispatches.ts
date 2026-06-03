import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  artifacts,
  dispatches,
  projects,
  type Dispatch,
  type DispatchInsert,
} from "@/db/schema";
import type { Intent } from "@/lib/schemas";

/**
 * Repository for `dispatches`. The only module that issues DB statements
 * against this table — keeps action / orchestrator / route handlers free of
 * Drizzle imports and gives a single seam to mock in tests.
 */
export const dispatchRepo = {
  /** Insert a new dispatch row and return the row. */
  async create(values: DispatchInsert): Promise<Dispatch> {
    const [row] = await db.insert(dispatches).values(values).returning();
    return row;
  },

  /** Attach the credit hold id to a dispatch (set after `credits.hold`). */
  async setHold(runId: string, holdId: string): Promise<void> {
    await db
      .update(dispatches)
      .set({ holdId, updatedAt: new Date() })
      .where(eq(dispatches.id, runId));
  },

  /** Transition: queued → running. Records the render model + start time. */
  async markRunning(runId: string, model: string): Promise<void> {
    const now = new Date();
    await db
      .update(dispatches)
      .set({ status: "running", model, startedAt: now, updatedAt: now })
      .where(eq(dispatches.id, runId));
  },

  /** Transition: running → done. */
  async markDone(runId: string): Promise<void> {
    const now = new Date();
    await db
      .update(dispatches)
      .set({ status: "done", completedAt: now, updatedAt: now })
      .where(eq(dispatches.id, runId));
  },

  /** Transition: any → failed, with a short error message. */
  async markFailed(runId: string, error: string): Promise<void> {
    const now = new Date();
    await db
      .update(dispatches)
      .set({
        status: "failed",
        failedAt: now,
        error: error.slice(0, 500),
        updatedAt: now,
      })
      .where(eq(dispatches.id, runId));
  },

  /** Lookup by id. Used by SSE abort, drawer endpoint, and tests. */
  async findById(runId: string): Promise<Dispatch | null> {
    const [row] = await db
      .select()
      .from(dispatches)
      .where(eq(dispatches.id, runId));
    return row ?? null;
  },

  /**
   * Idempotency check (stretch item): returns the most recent dispatch with
   * the same (project, prompt, intent) created within `withinMs`. `intent`
   * NULL is treated as "any intent" — covers the pre-classifier call site.
   */
  async findRecentDuplicate(args: {
    orgId: string;
    projectId: string;
    prompt: string;
    intent: Intent | null;
    withinMs: number;
  }): Promise<Dispatch | null> {
    const cutoff = new Date(Date.now() - args.withinMs);
    const conds = [
      eq(projects.orgId, args.orgId),
      eq(dispatches.projectId, args.projectId),
      eq(dispatches.prompt, args.prompt),
      gt(dispatches.createdAt, cutoff),
    ];
    if (args.intent !== null) conds.push(eq(dispatches.intent, args.intent));
    const [row] = await db
      .select()
      .from(dispatches)
      .innerJoin(projects, eq(projects.id, dispatches.projectId))
      .where(and(...conds))
      .orderBy(desc(dispatches.createdAt))
      .limit(1);
    return row?.dispatches ?? null;
  },

  /**
   * Idempotency return path: if the duplicate belongs to a batch, return all
   * sibling rows so the client can reuse/highlight the full fanout.
   */
  async findIdempotentRuns(duplicate: Dispatch): Promise<Dispatch[]> {
    if (!duplicate.batchId) return [duplicate];
    return db
      .select()
      .from(dispatches)
      .where(eq(dispatches.batchId, duplicate.batchId))
      .orderBy(desc(dispatches.createdAt));
  },

  /**
   * All dispatches in a batch, used by the orchestrator's batch finalizer
   * to detect when all sibling runs have reached a terminal state.
   */
  async findBatch(batchId: string): Promise<Dispatch[]> {
    return db.select().from(dispatches).where(eq(dispatches.batchId, batchId));
  },

  /**
   * Canvas read path: most recent dispatches in a project, left-joined with
   * their artifact. Backed by `dispatches_project_created_idx`.
   */
  async listByProject(projectId: string, limit: number) {
    return db
      .select({ dispatch: dispatches, artifact: artifacts })
      .from(dispatches)
      .leftJoin(artifacts, eq(artifacts.dispatchId, dispatches.id))
      .where(eq(dispatches.projectId, projectId))
      .orderBy(desc(dispatches.createdAt))
      .limit(limit);
  },

  /** Hard delete a dispatch (FK cascade removes artifact; ledger keeps history). */
  async delete(runId: string): Promise<void> {
    await db.delete(dispatches).where(eq(dispatches.id, runId));
  },
};
