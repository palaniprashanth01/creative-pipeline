import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export type AuthedContext = {
  user: { id: string; email: string; orgId: string };
  project: { id: string; orgId: string };
};

/**
 * Stub auth gate. Returns the seeded operator and confirms the user owns the
 * project. Swap this out for a real session lookup when auth is wired.
 */
export async function authenticateAndAuthorize(
  projectId: string,
): Promise<AuthedContext> {
  const seedUserId = process.env.SEED_USER_ID;
  if (!seedUserId) {
    throw new AuthError(
      "SEED_USER_ID missing — run `pnpm db:seed` and copy IDs into .env.",
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, seedUserId));
  if (!user) throw new AuthError("Seed user no longer exists.");

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)));
  if (!project) throw new AuthError("Project not found or not owned by user.");

  return {
    user: { id: user.id, email: user.email, orgId: user.orgId },
    project: { id: project.id, orgId: project.orgId },
  };
}
