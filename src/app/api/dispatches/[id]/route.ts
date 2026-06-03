import { NextResponse } from "next/server";
import { artifactRepo } from "@/lib/repos/artifacts";
import { dispatchRepo } from "@/lib/repos/dispatches";
import { ledgerRepo } from "@/lib/repos/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Why this?" drawer endpoint. Pure DB read — never invokes the LLM.
 * Returns the dispatch row, its artifact, the parent artifact (with parent
 * dispatch id for the jump-to button), and the full credit ledger for the run.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const dispatch = await dispatchRepo.findById(id);
  if (!dispatch) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const artifact = await artifactRepo.findByDispatch(id);

  let parentArtifact = null;
  let parentDispatchId: string | null = null;
  if (artifact?.parentArtifactId) {
    const p = await artifactRepo.findById(artifact.parentArtifactId);
    if (p) {
      parentArtifact = p;
      parentDispatchId = p.dispatchId;
    }
  }

  const ledger = dispatch.holdId ? await ledgerRepo.findByHold(dispatch.holdId) : [];

  return NextResponse.json({
    dispatch,
    artifact,
    parentArtifact,
    parentDispatchId,
    ledger,
  });
}
