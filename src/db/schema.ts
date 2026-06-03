import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- enums ----------
export const intentEnum = pgEnum("intent", ["image", "landing-page", "email"]);
export const dispatchStatusEnum = pgEnum("dispatch_status", [
  "queued",
  "classified",
  "running",
  "done",
  "failed",
  "ambiguous",
]);
export const ledgerTypeEnum = pgEnum("ledger_type", [
  "hold",
  "settle",
  "release",
]);

// ---------- seeded tables (provided by starter per brief) ----------
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    name: text("name").notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("projects_org_idx").on(t.orgId)],
);

// ---------- NEW tables (Item 1) ----------
export const dispatches = pgTable(
  "dispatches",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    prompt: text("prompt").notNull(),
    intent: intentEnum("intent"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    classifierModel: text("classifier_model"),
    model: text("model"),
    status: dispatchStatusEnum("status").notNull().default("queued"),
    holdId: uuid("hold_id"),
    /** Shared across all runs in a `count: N` batch dispatch (stretch item). */
    batchId: uuid("batch_id"),
    error: text("error"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("dispatches_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("dispatches_status_idx").on(t.status),
    // Idempotency + batch lookup paths
    index("dispatches_idempotency_idx").on(
      t.projectId,
      t.prompt,
      t.createdAt.desc(),
    ),
    index("dispatches_batch_idx").on(t.batchId),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    dispatchId: uuid("dispatch_id")
      .notNull()
      .references(() => dispatches.id, { onDelete: "cascade" }),
    kind: intentEnum("kind").notNull(),
    payload: jsonb("payload").notNull(),
    parentArtifactId: uuid("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.parentArtifactId],
      foreignColumns: [t.id],
      name: "artifacts_parent_fk",
    }).onDelete("set null"),
    index("artifacts_dispatch_idx").on(t.dispatchId),
    index("artifacts_parent_idx").on(t.parentArtifactId),
  ],
);

// ---------- ledger (provided by starter per brief) ----------
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    holdId: uuid("hold_id").notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    dispatchId: uuid("dispatch_id").references(
      (): AnyPgColumn => dispatches.id,
      { onDelete: "set null" },
    ),
    amount: numeric("amount", { precision: 12, scale: 4 }).notNull(),
    type: ledgerTypeEnum("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ledger_hold_idx").on(t.holdId),
    index("ledger_org_created_idx").on(t.orgId, t.createdAt.desc()),
    // one settle and one release per hold — keeps the ledger from drifting
    uniqueIndex("ledger_terminal_idx")
      .on(t.holdId, t.type)
      .where(sql`type in ('settle','release')`),
  ],
);

export type Org = typeof orgs.$inferSelect;
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Dispatch = typeof dispatches.$inferSelect;
export type DispatchInsert = typeof dispatches.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type ArtifactInsert = typeof artifacts.$inferInsert;
export type LedgerEntry = typeof creditLedger.$inferSelect;
