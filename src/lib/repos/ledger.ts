import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creditLedger } from "@/db/schema";

/**
 * Read-side of the credit ledger. Writes go through `lib/credits.ts` so
 * the hold/settle/release invariants live in one place.
 */
export const ledgerRepo = {
  /** All ledger entries for a hold, used by the drawer's audit panel. */
  async findByHold(holdId: string) {
    return db
      .select({
        type: creditLedger.type,
        amount: creditLedger.amount,
        createdAt: creditLedger.createdAt,
      })
      .from(creditLedger)
      .where(eq(creditLedger.holdId, holdId));
  },
};
