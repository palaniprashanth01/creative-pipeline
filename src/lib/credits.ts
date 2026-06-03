import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditLedger } from "@/db/schema";

/** A reserved credit hold returned by {@link hold}. */
export type Hold = { holdId: string; amount: number };

/**
 * Reserve `amount` credits up front and return the resulting hold id. Every
 * hold must later be terminated by exactly one of {@link settle} or
 * {@link release} (enforced by a partial-unique index on the ledger). The
 * write is single-statement so it's safe under Neon's HTTP driver.
 */
export async function hold(args: {
  orgId: string;
  amount: number;
  dispatchId?: string;
}): Promise<Hold> {
  const holdId = crypto.randomUUID();
  await db.insert(creditLedger).values({
    holdId,
    orgId: args.orgId,
    dispatchId: args.dispatchId,
    amount: args.amount.toFixed(4),
    type: "hold",
  });
  return { holdId, amount: args.amount };
}

/**
 * Commit a hold. Pass `amountOverride` to settle only part of a batch hold
 * (e.g. when some sibling runs failed). Defaults to the full hold amount.
 */
export async function settle(
  holdId: string,
  amountOverride?: number,
): Promise<void> {
  const amount = amountOverride ?? (await holdAmount(holdId));
  await db.insert(creditLedger).values({
    holdId,
    orgId: await holdOrg(holdId),
    amount: amount.toFixed(4),
    type: "settle",
  });
}

/**
 * Return a hold to the org. Same `amountOverride` semantics as {@link settle}.
 * Called on classifier-reject (no-op since no hold taken), render-error,
 * client abort, and batch failures.
 */
export async function release(
  holdId: string,
  amountOverride?: number,
): Promise<void> {
  const amount = amountOverride ?? (await holdAmount(holdId));
  await db.insert(creditLedger).values({
    holdId,
    orgId: await holdOrg(holdId),
    amount: amount.toFixed(4),
    type: "release",
  });
}

/** True once a hold has been settled or released — used to make cleanup idempotent. */
export async function isTerminal(holdId: string): Promise<boolean> {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.holdId, holdId),
        sql`${creditLedger.type} in ('settle','release')`,
      ),
    );
  return (rows[0]?.c ?? 0) > 0;
}

/** Net credits still uncommitted for a hold (zero = fully terminal). */
export async function netHeld(holdId: string): Promise<number> {
  const rows = await db
    .select({
      held: sql<string>`coalesce(sum(case when type='hold' then amount else -amount end), 0)`,
    })
    .from(creditLedger)
    .where(eq(creditLedger.holdId, holdId));
  return Number(rows[0]?.held ?? 0);
}

async function holdAmount(holdId: string): Promise<number> {
  const rows = await db
    .select({ amount: creditLedger.amount })
    .from(creditLedger)
    .where(and(eq(creditLedger.holdId, holdId), eq(creditLedger.type, "hold")))
    .limit(1);
  if (!rows.length) throw new Error(`Unknown holdId ${holdId}`);
  return Number(rows[0].amount);
}

async function holdOrg(holdId: string): Promise<string> {
  const rows = await db
    .select({ orgId: creditLedger.orgId })
    .from(creditLedger)
    .where(and(eq(creditLedger.holdId, holdId), eq(creditLedger.type, "hold")))
    .limit(1);
  if (!rows.length) throw new Error(`Unknown holdId ${holdId}`);
  return rows[0].orgId;
}
