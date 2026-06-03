"use server";

import { authenticateAndAuthorize } from "@/lib/auth";
import { dispatchRepo } from "@/lib/repos/dispatches";

export type DeleteResult =
  | { status: "ok" }
  | { status: "error"; message: string };

/**
 * Hard-delete a dispatch and its artifact (FK cascade). The credit_ledger
 * keeps its rows with dispatch_id NULL'd (FK is `set null`) so the audit
 * trail of holds/settles/releases survives the delete.
 */
export async function deleteDispatch(args: {
  projectId: string;
  dispatchId: string;
}): Promise<DeleteResult> {
  try {
    const ctx = await authenticateAndAuthorize(args.projectId);
    const row = await dispatchRepo.findById(args.dispatchId);
    if (!row) return { status: "error", message: "not found" };
    if (row.projectId !== ctx.project.id) {
      return { status: "error", message: "forbidden" };
    }
    await dispatchRepo.delete(args.dispatchId);
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "delete failed",
    };
  }
}
