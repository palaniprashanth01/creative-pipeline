import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export default function Home() {
  const projectId = process.env.SEED_PROJECT_ID ?? "";
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)]/60 px-3 py-1 text-xs font-medium text-[var(--muted)] backdrop-blur">
          <Sparkles className="size-3.5 text-[var(--accent)]" />
          Skala Media · take-home
        </div>

        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-balance">
          Creative Pipeline
        </h1>
        <p className="mt-4 text-base text-[var(--muted)] text-balance">
          Type a prompt. We classify intent, stream the result as a tile, and
          account every credit along the way.
        </p>

        <div className="mt-10">
          {projectId ? (
            <Link
              href={`/projects/${projectId}`}
              className="group inline-flex items-center gap-2 rounded-xl bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-[var(--background)] shadow-sm transition hover:opacity-90"
            >
              Open seeded project
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left text-sm">
              <p className="font-medium">Set up first:</p>
              <pre className="mt-2 overflow-x-auto rounded bg-[var(--surface-2)] px-3 py-2 text-xs">
                pnpm db:migrate && pnpm db:seed
              </pre>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Then paste the printed <code>SEED_PROJECT_ID</code> into your{" "}
                <code>.env</code>.
              </p>
            </div>
          )}
        </div>

        <p className="mt-12 text-xs text-[var(--muted)]">
          Next.js · TypeScript · Drizzle · Neon · Groq · AI SDK
        </p>
      </div>
    </main>
  );
}
