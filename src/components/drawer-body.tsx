"use client";

import { useEffect, useState } from "react";
import { GitFork, Copy, Check } from "lucide-react";

type DrawerData = {
  dispatch: {
    id: string;
    prompt: string;
    intent: string | null;
    confidence: string | null;
    classifierModel: string | null;
    model: string | null;
    status: string;
    error: string | null;
    queuedAt: string;
    classifiedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    failedAt: string | null;
  };
  artifact: { id: string; kind: string; payload: unknown } | null;
  parentArtifact: { id: string; payload: unknown } | null;
  parentDispatchId: string | null;
  ledger: { type: string; amount: string; createdAt: string }[];
};

export function DrawerBody({
  dispatchId,
  onJumpTo,
}: {
  dispatchId: string;
  onJumpTo: (dispatchId: string) => void;
}) {
  const [loadState, setLoadState] = useState<{
    dispatchId: string;
    data: DrawerData | null;
    err: string | null;
  }>({ dispatchId, data: null, err: null });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/dispatches/${dispatchId}`)
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(b))))
      .then(
        (d: DrawerData) =>
          alive && setLoadState({ dispatchId, data: d, err: null }),
      )
      .catch(
        (e) =>
          alive &&
          setLoadState({
            dispatchId,
            data: null,
            err: String(e?.error ?? "fetch failed"),
          }),
      );
    return () => {
      alive = false;
    };
  }, [dispatchId]);

  const data = loadState.dispatchId === dispatchId ? loadState.data : null;
  const err = loadState.dispatchId === dispatchId ? loadState.err : null;

  if (err)
    return (
      <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>
    );
  if (!data)
    return (
      <div className="space-y-3">
        <div className="shimmer h-4 w-1/3 rounded" />
        <div className="shimmer h-16 w-full rounded" />
        <div className="shimmer h-4 w-1/2 rounded mt-6" />
        <div className="shimmer h-10 w-full rounded" />
      </div>
    );

  const d = data.dispatch;
  const cost = data.ledger
    .filter((l) => l.type === "settle")
    .reduce((s, l) => s + Number(l.amount), 0);
  const released = data.ledger.some((l) => l.type === "release");
  const total = totalLatency(d);

  return (
    <div className="space-y-7">
      <StatusHero status={d.status} totalMs={total} />

      {/* Bug #3 — full artifact preview so reviewers can read the whole output. */}
      {data.artifact ? (
        <PreviewSection artifact={data.artifact} prompt={d.prompt} />
      ) : null}

      <Section title="Prompt">
        <div className="group relative">
          <p className="whitespace-pre-wrap leading-relaxed text-sm text-[var(--foreground)]">
            {d.prompt}
          </p>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(d.prompt);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="absolute -top-1 right-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-2)]"
            aria-label="Copy prompt"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-600" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        </div>
      </Section>

      <Section title="Classifier">
        <Grid>
          <KV label="Kind" value={d.intent ?? "—"} mono />
          <KV
            label="Confidence"
            value={d.confidence ? Number(d.confidence).toFixed(2) : "—"}
            mono
          />
          <KV
            label="Model"
            value={d.classifierModel ?? "explicit"}
            mono
            span={2}
          />
        </Grid>
      </Section>

      <Section title="Render">
        <Grid>
          <KV label="Model" value={d.model ?? "—"} mono span={2} />
        </Grid>
      </Section>

      <Section title="Timeline">
        <div className="space-y-0.5">
          <Phase label="queued" at={d.queuedAt} />
          <Phase label="classified" at={d.classifiedAt} from={d.queuedAt} />
          <Phase label="started" at={d.startedAt} from={d.classifiedAt} />
          <Phase
            label={d.failedAt ? "failed" : "completed"}
            at={d.completedAt ?? d.failedAt}
            from={d.startedAt}
            variant={d.failedAt ? "error" : "ok"}
          />
        </div>
      </Section>

      <Section title="Credits">
        <Grid>
          <KV
            label="Settled"
            value={
              cost > 0
                ? cost.toFixed(2)
                : released
                  ? "0 (released)"
                  : "0"
            }
            mono
          />
          <KV
            label="Status"
            value={
              cost > 0
                ? "Committed"
                : released
                  ? "Released"
                  : "Held"
            }
          />
        </Grid>
        <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3 space-y-1 font-mono text-xs text-[var(--muted)]">
          {data.ledger.length === 0 ? (
            <p className="italic">no ledger entries</p>
          ) : (
            data.ledger.map((l, i) => (
              <div key={i} className="flex items-center gap-3">
                <span
                  className={
                    "inline-flex w-16 " +
                    (l.type === "settle"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : l.type === "release"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-[var(--accent)]")
                  }
                >
                  {l.type}
                </span>
                <span className="text-[var(--foreground)]">
                  {Number(l.amount).toFixed(4)}
                </span>
                <span className="ml-auto">
                  {new Date(l.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </Section>

      {data.parentArtifact && data.parentDispatchId ? (
        <Section title="Lineage">
          <button
            type="button"
            onClick={() => onJumpTo(data.parentDispatchId!)}
            className="group inline-flex items-center gap-2 text-[12.5px] text-[var(--foreground)] hover:text-[var(--accent)] transition-colors"
          >
            <GitFork className="size-3.5 text-[var(--muted)] group-hover:text-[var(--accent)]" />
            Improvised from → {summarize(data.parentArtifact.payload)}
          </button>
        </Section>
      ) : null}

      {d.error ? (
        <Section title="Error">
          <div className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-3">
            <p className="text-rose-700 dark:text-rose-400 font-mono text-[11px] leading-relaxed">
              {d.error}
            </p>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function StatusHero({ status, totalMs }: { status: string; totalMs: number | null }) {
  const cfg =
    status === "done"
      ? {
          tint: "from-emerald-500/20 to-emerald-500/0 border-emerald-500/30",
          label: "Completed",
          text: "text-emerald-700 dark:text-emerald-400",
        }
      : status === "failed"
        ? {
            tint: "from-rose-500/20 to-rose-500/0 border-rose-500/30",
            label: "Failed",
            text: "text-rose-700 dark:text-rose-400",
          }
        : {
            tint: "from-violet-500/20 to-violet-500/0 border-violet-500/30",
            label: "In progress",
            text: "text-[var(--accent)]",
          };

  return (
    <div
      className={
        "rounded-xl border bg-gradient-to-br p-4 " + cfg.tint
      }
    >
      <div className="flex items-baseline justify-between">
        <span
          className={"text-sm font-semibold uppercase tracking-wider " + cfg.text}
        >
          {cfg.label}
        </span>
        {totalMs != null ? (
          <span className="font-mono text-xs text-[var(--muted)]">
            {totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(2)}s`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function totalLatency(d: DrawerData["dispatch"]): number | null {
  const end = d.completedAt ?? d.failedAt;
  if (!end) return null;
  return new Date(end).getTime() - new Date(d.queuedAt).getTime();
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)] mb-2.5">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-2">{children}</div>;
}

function KV({
  label,
  value,
  mono,
  span,
}: {
  label: string;
  value: string;
  mono?: boolean;
  span?: number;
}) {
  return (
    <div
      className={
        "rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 " +
        (span === 2 ? "col-span-2" : "")
      }
    >
      <div className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div
        className={
          "mt-0.5 text-sm text-[var(--foreground)] truncate " +
          (mono ? "font-mono" : "font-medium")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Phase({
  label,
  at,
  from,
  variant,
}: {
  label: string;
  at: string | null;
  from?: string | null;
  variant?: "ok" | "error";
}) {
  if (!at) {
    return (
      <div className="flex items-center gap-3 py-1.5 text-[13px] text-[var(--muted)]/60">
        <Dot />
        <span className="capitalize">{label}</span>
        <span className="ml-auto font-mono">—</span>
      </div>
    );
  }
  const delta = from ? new Date(at).getTime() - new Date(from).getTime() : null;
  return (
    <div className="flex items-center gap-3 py-1.5 text-[13px]">
      <Dot variant={variant} />
      <span className="capitalize text-[var(--foreground)]">{label}</span>
      <span className="ml-auto font-mono text-[var(--muted)]">
        {delta != null && delta >= 0
          ? `+${delta}ms`
          : new Date(at).toLocaleTimeString()}
      </span>
    </div>
  );
}

function Dot({ variant }: { variant?: "ok" | "error" }) {
  return (
    <span
      className={
        "inline-block size-2 rounded-full " +
        (variant === "error"
          ? "bg-rose-500"
          : variant === "ok"
            ? "bg-emerald-500"
            : "bg-[var(--accent)]/60")
      }
    />
  );
}

function summarize(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const p = payload as { headline?: string; url?: string };
    if (p.headline) return p.headline.slice(0, 56);
    if (p.url) return p.url.split("/").pop() ?? p.url;
  }
  return "creative";
}

/** Full artifact preview — bug #3. Click ctaUrl link opens in a new tab. */
function PreviewSection({
  artifact,
  prompt,
}: {
  artifact: { kind: string; payload: unknown };
  prompt: string;
}) {
  if (artifact.kind === "image") {
    const url = (artifact.payload as { url?: string }).url;
    if (!url) return null;
    // PR #2 review feedback: descriptive alt for screen readers. Truncate so
    // the announcement isn't unwieldy on very long prompts.
    const altText = `Placeholder image generated for prompt: ${prompt.slice(0, 120)}${prompt.length > 120 ? "…" : ""}`;
    return (
      <Section title="Preview">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={altText}
          className="w-full rounded-lg border border-[var(--border)]"
        />
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          Placeholder image — picsum seeded by prompt hash.
        </p>
      </Section>
    );
  }

  const p = artifact.payload as {
    headline?: string;
    body?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  };
  return (
    <Section title="Preview">
      <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 space-y-3">
        {p.headline ? (
          <h4 className="text-lg font-semibold leading-snug text-balance">
            {p.headline}
          </h4>
        ) : null}
        {p.body ? (
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-[var(--foreground)]">
            {p.body}
          </p>
        ) : null}
        {p.ctaLabel ? (
          p.ctaUrl && /^https?:\/\//i.test(p.ctaUrl) ? (
            <a
              href={p.ctaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-[var(--foreground)] text-[var(--background)] text-sm font-medium px-3.5 py-2 hover:opacity-90 transition-opacity"
            >
              {p.ctaLabel}
              <span className="opacity-60">↗</span>
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface)] text-[var(--muted)] text-sm font-medium px-3.5 py-2 border border-[var(--border)]">
              {p.ctaLabel}
            </span>
          )
        ) : null}
      </article>
    </Section>
  );
}
