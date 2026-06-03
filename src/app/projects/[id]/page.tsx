import { notFound } from "next/navigation";
import { authenticateAndAuthorize } from "@/lib/auth";
import { dispatchRepo } from "@/lib/repos/dispatches";
import type { ArtifactPayload } from "@/lib/schemas";
import { CanvasClient, type InitialTile } from "./canvas-client";

export const dynamic = "force-dynamic";

/** Server component: auth gate, then hydrate the canvas with the last 60 runs. */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;

  try {
    await authenticateAndAuthorize(projectId);
  } catch {
    notFound();
  }

  const rows = await dispatchRepo.listByProject(projectId, 60);

  const initial: InitialTile[] = rows.map((r) => ({
    runId: r.dispatch.id,
    prompt: r.dispatch.prompt,
    kind: r.dispatch.intent,
    status: r.dispatch.status,
    payload: (r.artifact?.payload as ArtifactPayload | undefined) ?? null,
    artifactId: r.artifact?.id ?? null,
    parentArtifactId: r.artifact?.parentArtifactId ?? null,
  }));

  return <CanvasClient projectId={projectId} initial={initial} />;
}
