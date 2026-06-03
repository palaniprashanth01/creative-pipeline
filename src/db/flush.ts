import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = neon(url);

  console.log("Flushing dispatches, artifacts, credit_ledger…");
  await sql`truncate dispatches, artifacts, credit_ledger restart identity cascade`;

  const [{ d }] = await sql`select count(*)::int as d from dispatches` as { d: number }[];
  const [{ a }] = await sql`select count(*)::int as a from artifacts` as { a: number }[];
  const [{ l }] = await sql`select count(*)::int as l from credit_ledger` as { l: number }[];
  console.log(`Done. dispatches=${d}  artifacts=${a}  credit_ledger=${l}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
