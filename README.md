# Creative Pipeline — Skala Media take-home

**Loom:** https://www.loom.com/share/f5bff3e4bdf54cfc8494b90a8d4943ac

A chat-driven creative generator. Operator types a prompt → classifier picks intent (image / landing-page / email) → an LLM streams the result into a tile on the canvas. Credits are reserved before work starts, settled on success, released on classifier-reject / render-error / client-abort. Lineage threads each tile back to its parent. A "Why this?" drawer answers from the DB without re-calling the LLM.

## Run

```bash
# 1. Install
pnpm install

# 2. .env (copy and fill)
cp .env.example .env
#   DATABASE_URL   → Neon connection string (https://neon.tech free tier)
#   GROQ_API_KEY   → https://console.groq.com free tier

# 3. Migrate + seed
pnpm db:migrate
pnpm db:seed       # prints SEED_ORG_ID / SEED_USER_ID / SEED_PROJECT_ID
                   # paste them into .env

# 4. Boot
pnpm dev           # http://localhost:3000  →  click "Open seeded project"
```

**Demo path:** type "draft a launch email for our spring sale" → tile streams in → click `Improvise` → submit again → second tile shows "Improvised from →". Kill the tab mid-stream during a slow run, then query the ledger:

```sql
select hold_id, type, amount from credit_ledger order by created_at desc limit 6;
-- failed/aborted runs show hold + release (net 0) and never a settle.
```

## Green-bar gates

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest: classifier gates, batch/idempotency, credit cleanup
```

## Design rationale (≈280 words)

**Classifier-then-dispatch, not classifier-as-step.** The classifier is a gate, not a phase. Running it before any DB write keeps the ambiguous path (`confidence < 0.6`) cheap — no row, no hold, no orphan to reconcile — which is exactly what the brief asks for. Once the gate passes, the dispatch row lands in `classified` status, the hold is taken, the action returns `runId`, and the orchestrator kicks off fire-and-forget.

**One source of truth for streaming.** The server action returns serializable run identifiers (`runId`, plus `runIds` for stretch batch fan-out) and never tries to return a stream. The SSE route at `/api/runs/[id]/stream` is the only place that emits `classified → dispatched → partial → done | error`. An in-process pub/sub (`src/lib/run-bus.ts`) bridges the orchestrator's writes to the SSE subscribers, with a small replay log so a client that connects mid-flight catches up. Tile keys are the `runId` from the first paint → no double-render flash on hydrate.

**Credit lifecycle.** `hold → settle` happens only after the artifact row is durably persisted. `release` fires from three places: render error (orchestrator `catch`), client abort (SSE route's `req.signal` listener), classifier reject (no hold ever created). A partial-unique index on `(hold_id, type) WHERE type IN ('settle','release')` makes double-terminals impossible at the DB level — `netHeld(holdId)` is the one-line verification query.

**Stretch work completed.** Batch fan-out (`count: N`) creates N dispatch rows behind one shared hold and finalizes the ledger only after every sibling reaches a terminal state. Idempotency dedupes repeat requests within 5 seconds on the project/prompt/intent path and returns the full prior batch when applicable. Soft-confidence classifier output (`0.6–0.8`) now surfaces "did you mean…?" intent chips instead of silently launching the wrong renderer. The main remaining production hardening item is moving the in-memory pub/sub to Postgres `LISTEN/NOTIFY` or a queue so streaming survives across serverless instances.

## Architecture

```
src/
├── app/
│   ├── actions/dispatch.ts             # "use server" — Zod, auth gate, returns run ids
│   ├── api/
│   │   ├── runs/[id]/stream/route.ts   # SSE: classified/dispatched/partial/done/error
│   │   └── dispatches/[id]/route.ts    # Drawer read endpoint (pure DB)
│   └── projects/[id]/
│       ├── page.tsx                    # Server component — initial canvas read
│       └── canvas-client.tsx           # Chat + tile grid + drawer
├── components/
│   ├── tile.tsx                        # Skeleton → partial → done, no flash
│   ├── sheet.tsx                       # Radix Dialog drawer primitive
│   └── drawer-body.tsx                 # "Why this?" — prompt, classifier, timeline, ledger
├── lib/
│   ├── schemas.ts                      # Zod schemas — must NOT live in a "use server" file
│   ├── auth.ts                         # Stub: authenticateAndAuthorize(projectId)
│   ├── credits.ts                      # hold / settle / release / isTerminal
│   ├── constants.ts                    # credit, confidence, idempotency, SSE constants
│   ├── classifier.ts                   # generateObject(Groq, classifierOutZ)
│   ├── renderers.ts                    # renderImage + streamObject(Groq, creativeContentZ)
│   ├── orchestrator.ts                 # Fire-and-forget: render → persist → settle/release
│   ├── repos/                          # DB access boundary for dispatches/artifacts/ledger
│   └── run-bus.ts                      # In-process pub/sub + abort registry + replay
└── db/
    ├── schema.ts                       # 6 tables, enums, FKs, indexes
    ├── index.ts                        # Neon HTTP driver
    ├── migrate.ts                      # pnpm db:migrate
    └── seed.ts                         # pnpm db:seed (idempotent)
```

## Acceptance criteria — coverage

| # | Brief item | Where |
|---|---|---|
| 1 | Schema migration: dispatches + artifacts, self-ref lineage, indexes, idempotent | `drizzle/0000_*.sql`, `src/db/schema.ts` |
| 2 | Server action: Zod, auth-gated, returns serializable run id(s), persists queued row before render LLM | `src/app/actions/dispatch.ts` |
| 3 | Intent classifier with `< 0.6` ambiguous gate (no DB row, no hold, no render) | `src/lib/classifier.ts` + gate in `dispatch.ts` |
| 4 | Three render kinds — picsum URL for image, structured streaming for landing-page + email | `src/lib/renderers.ts` |
| 5 | SSE endpoint with phase events, correct headers, `req.signal` abort | `src/app/api/runs/[id]/stream/route.ts` |
| 6 | Chat → action → tile streams from runId (stable key, no flash) | `src/app/projects/[id]/canvas-client.tsx`, `src/components/tile.tsx` |
| 7 | Lineage: parentArtifactId on row, "Improvised from →" link, composer surfaces parent | `tile.tsx` (footer), `canvas-client.tsx` (composer chip), `dispatch.ts` (parent persist) |
| 8 | Credits: hold → settle only on persist; release on reject + error + abort; ledger never drifts | `lib/credits.ts` + partial-unique index in `db/schema.ts` |
| 9 | "Why this?" drawer — prompt, classifier, model, phase timeline, credit cost, parent | `src/components/drawer-body.tsx` + `api/dispatches/[id]/route.ts` |
| 10 | Stretch: batch fan-out with one hold, 5s idempotency, soft-confidence chips | `dispatch.ts`, `orchestrator.ts`, `canvas-client.tsx`, `dispatch.test.ts` |

## What I deliberately did NOT do (out-of-scope per brief)

Mobile polish · real blob storage · real job queue · vendor OAuth · auth flows beyond the stub gate · render kinds beyond the three listed.
