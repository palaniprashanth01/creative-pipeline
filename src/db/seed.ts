import "dotenv/config";
import { db } from "./index";
import { orgs, users, projects } from "./schema";
import { eq } from "drizzle-orm";

async function main() {
  const email = "operator@skala.local";

  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    const user = existing[0];
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.ownerId, user.id))
      .limit(1);
    console.log("Seed already present.");
    printSeedIds({ orgId: user.orgId, userId: user.id, projectId: project?.id });
    return;
  }

  const [org] = await db
    .insert(orgs)
    .values({ name: "Skala Demo Org" })
    .returning();

  const [user] = await db
    .insert(users)
    .values({ email, name: "Demo Operator", orgId: org.id })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({ orgId: org.id, ownerId: user.id, name: "Launch Campaign" })
    .returning();

  console.log("Seed complete.");
  printSeedIds({ orgId: org.id, userId: user.id, projectId: project.id });
}

function printSeedIds(ids: {
  orgId: string;
  userId: string;
  projectId?: string;
}) {
  console.log("\nPaste these into .env:");
  console.log(`SEED_ORG_ID="${ids.orgId}"`);
  console.log(`SEED_USER_ID="${ids.userId}"`);
  if (ids.projectId) console.log(`SEED_PROJECT_ID="${ids.projectId}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
