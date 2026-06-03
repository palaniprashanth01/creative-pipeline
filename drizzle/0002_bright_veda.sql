ALTER TABLE "dispatches" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX "dispatches_idempotency_idx" ON "dispatches" USING btree ("project_id","prompt","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dispatches_batch_idx" ON "dispatches" USING btree ("batch_id");