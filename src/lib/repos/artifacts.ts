import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  artifacts,
  type Artifact,
  type ArtifactInsert,
} from "@/db/schema";

/** Repository for `artifacts` — the rendered creative outputs. */
export const artifactRepo = {
  /** Insert and return the artifact row. */
  async create(values: ArtifactInsert): Promise<Artifact> {
    const [row] = await db.insert(artifacts).values(values).returning();
    return row;
  },

  /** Returns the (at most one) artifact attached to a dispatch. */
  async findByDispatch(dispatchId: string): Promise<Artifact | null> {
    const [row] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.dispatchId, dispatchId))
      .limit(1);
    return row ?? null;
  },

  /** Lookup by id — used by the drawer to resolve a parent in a lineage chain. */
  async findById(id: string): Promise<Artifact | null> {
    const [row] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id));
    return row ?? null;
  },
};
