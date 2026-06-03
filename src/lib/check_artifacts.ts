import { db } from "../db";
import { artifacts, dispatches } from "../db/schema";
import { eq } from "drizzle-orm";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  try {
    const list = await db
      .select({
        id: dispatches.id,
        intent: dispatches.intent,
        status: dispatches.status,
        payload: artifacts.payload,
      })
      .from(dispatches)
      .leftJoin(artifacts, eq(dispatches.id, artifacts.dispatchId))
      .where(eq(dispatches.intent, "image"));

    console.log("Image dispatches & artifacts:");
    console.log(JSON.stringify(list, null, 2));
  } catch (err) {
    console.error(err);
  }
}

run();
