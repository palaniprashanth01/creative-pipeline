"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  GitFork,
  Image as ImageIcon,
  ImageOff,
  Layout,
  Loader2,
  Mail,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactPayload, Intent } from "@/lib/schemas";

export type TileState = {
  runId: string;
  prompt: string;
  kind?: Intent;
  status: "queued" | "classified" | "running" | "done" | "error";
  payload?: Partial<ArtifactPayload>;
  artifactId?: string;
  parentArtifactId?: string;
  error?: string;
};

export type TileEvent =
  | { type: "classified"; kind: Intent; confidence: number; model: string }
  | { type: "dispatched"; runId: string }
  | { type: "partial"; data: Partial<ArtifactPayload> }
  | { type: "done"; artifactId: string; payload: ArtifactPayload }
  | { type: "error"; message: string };

const KIND_VISUALS: Record<
  Intent,
  { icon: typeof Layout; label: string; tint: string }
> = {
  "landing-page": {
    icon: Layout,
    label: "Landing Page",
    tint: "text-violet-600 dark:text-violet-400",
  },
  email: {
    icon: Mail,
    label: "Email",
    tint: "text-sky-600 dark:text-sky-400",
  },
  image: {
    icon: ImageIcon,
    label: "Image",
    tint: "text-amber-600 dark:text-amber-400",
  },
};

export function Tile({
  state,
  onEvent,
  onClickImprovise,
  onClickDelete,
  onOpenDrawer,
  parentLabel,
}: {
  state: TileState;
  onEvent?: (e: TileEvent) => void;
  onClickImprovise: () => void;
  onClickDelete: () => void;
  onOpenDrawer: () => void;
  parentLabel?: string;
}) {
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  const initialStatusRef = useRef(state.status);
  useEffect(() => {
    if (
      initialStatusRef.current === "done" ||
      initialStatusRef.current === "error"
    ) {
      return;
    }
    const es = new EventSource(`/api/runs/${state.runId}/stream`);
    const types = [
      "classified",
      "dispatched",
      "partial",
      "done",
      "error",
    ] as const;
    for (const t of types) {
      es.addEventListener(t, (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as TileEvent;
          onEventRef.current?.(data);
          if (data.type === "done" || data.type === "error") es.close();
        } catch {
          // ignore malformed
        }
      });
    }
    return () => es.close();
  }, [state.runId]);

  const kindMeta = state.kind ? KIND_VISUALS[state.kind] : null;
  const Icon = kindMeta?.icon;

  return (
    <article
      onClick={onOpenDrawer}
      className={cn(
        "group relative cursor-pointer rounded-2xl",
        "border border-[var(--border)] bg-[var(--surface)]",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.15)]",
        "hover:border-[var(--border-strong)]",
        "transition-all duration-200 hover:-translate-y-0.5",
        "flex flex-col overflow-hidden",
      )}
    >
      <ProgressBar status={state.status} />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClickDelete();
        }}
        aria-label="Delete tile"
        title="Delete"
        className={cn(
          "absolute top-2 right-2 z-10",
          "inline-flex size-6 items-center justify-center rounded-full",
          "bg-black/40 backdrop-blur text-white",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "hover:bg-rose-600",
        )}
      >
        <X className="size-3.5" />
      </button>

      <header className="flex items-center justify-between px-4 pt-3.5 pb-2.5 pr-10">
        <div className="flex items-center gap-2 min-w-0">
          {Icon ? (
            <span className={cn("shrink-0", kindMeta?.tint)}>
              <Icon className="size-3.5" />
            </span>
          ) : (
            <span className="size-3.5 rounded-full bg-[var(--surface-2)]" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)] truncate">
            {kindMeta?.label ?? "Classifying…"}
          </span>
        </div>
        <StatusBadge status={state.status} />
      </header>

      <Body state={state} />

      <Footer
        state={state}
        parentLabel={parentLabel}
        onImprovise={(e) => {
          e.stopPropagation();
          onClickImprovise();
        }}
      />
    </article>
  );
}

/**
 * Top-edge progress bar that grows with each phase transition. Gives the
 * operator a real visual sense of "where the run is right now" without
 * extra labels — softens the "stuck skeleton" feel during slow LLM calls.
 */
function ProgressBar({ status }: { status: TileState["status"] }) {
  const pct =
    status === "queued"
      ? 10
      : status === "classified"
        ? 35
        : status === "running"
          ? 70
          : status === "done"
            ? 100
            : 100;
  const tint =
    status === "error"
      ? "bg-rose-500"
      : status === "done"
        ? "bg-emerald-500"
        : "bg-[var(--accent)]";
  const showShimmer = status === "queued" || status === "classified" || status === "running";

  return (
    <div className="absolute top-0 left-0 right-0 h-[3px] overflow-hidden bg-[var(--surface-2)] z-10">
      <div
        className={cn("h-full transition-all duration-700 ease-out relative", tint)}
        style={{ width: `${pct}%` }}
      >
        {showShimmer ? (
          <span className="absolute inset-y-0 right-0 w-12 bg-white/30 blur-sm animate-pulse" />
        ) : null}
      </div>
    </div>
  );
}

function ImageWithFallback({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[var(--accent-soft)] to-[var(--surface-2)]">
        <ImageOff className="size-6 text-[var(--muted)]" />
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
          image unavailable
        </span>
      </div>
    );
  }

  return (
    <>
      {!loaded ? <div className="absolute inset-0 shimmer" /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={cn(
          "object-cover w-full h-full transition-all duration-500",
          "group-hover:scale-[1.02]",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  );
}

function StatusBadge({ status }: { status: TileState["status"] }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3" />
        Done
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">
        <AlertCircle className="size-3" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
      <Loader2 className="size-3 animate-spin" />
      {status === "queued" ? "Queued" : status === "classified" ? "Routed" : "Streaming"}
    </span>
  );
}

function Body({ state }: { state: TileState }) {
  if (state.status === "error") {
    return (
      <div className="px-4 py-3 min-h-[7.5rem] flex items-start">
        <p className="text-xs text-rose-600 dark:text-rose-400 leading-relaxed">
          {state.error ?? "Something went wrong."}
        </p>
      </div>
    );
  }

  if (state.kind === "image") {
    const url = (state.payload as { url?: string } | undefined)?.url;
    return (
      <div className="relative aspect-[4/3] bg-[var(--surface-2)] overflow-hidden">
        {url ? (
          <>
            <ImageWithFallback url={url} />
            <span className="absolute bottom-2 left-2 rounded-full bg-black/60 backdrop-blur-sm text-white text-[9px] font-medium uppercase tracking-wider px-2 py-0.5">
              placeholder
            </span>
          </>
        ) : (
          <div className="absolute inset-0 shimmer" />
        )}
      </div>
    );
  }

  const p = state.payload as
    | { headline?: string; body?: string; ctaLabel?: string; ctaUrl?: string }
    | undefined;
  return (
    <div className="px-4 py-3 space-y-2.5 min-h-[8rem]">
      {p?.headline ? (
        <h3 className="text-[15px] font-semibold leading-snug text-balance">
          {p.headline}
        </h3>
      ) : (
        <div className="space-y-1.5">
          <div className="shimmer h-4 w-3/4 rounded" />
          <div className="shimmer h-4 w-1/2 rounded" />
        </div>
      )}
      {p?.body ? (
        <p className="text-[12.5px] text-[var(--muted)] leading-relaxed line-clamp-3">
          {p.body}
        </p>
      ) : (
        <div className="space-y-1">
          <div className="shimmer h-3 w-full rounded" />
          <div className="shimmer h-3 w-5/6 rounded" />
        </div>
      )}
      {p?.ctaLabel ? (
        p.ctaUrl && /^https?:\/\//i.test(p.ctaUrl) ? (
          <a
            href={p.ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--foreground)] text-[var(--background)] text-[11px] font-medium px-2.5 py-1 hover:opacity-90 transition-opacity"
          >
            {p.ctaLabel}
            <span className="opacity-60">↗</span>
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-2)] text-[var(--muted)] text-[11px] font-medium px-2.5 py-1">
            {p.ctaLabel}
          </span>
        )
      ) : null}
    </div>
  );
}

function Footer({
  state,
  parentLabel,
  onImprovise,
}: {
  state: TileState;
  parentLabel?: string;
  onImprovise: (e: React.MouseEvent) => void;
}) {
  return (
    <footer className="px-4 py-2.5 border-t border-[var(--border)] flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        {parentLabel ? (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--muted)] truncate">
            <GitFork className="size-3 shrink-0" />
            <span className="truncate">Improvised from → {parentLabel}</span>
          </span>
        ) : (
          <span
            className="text-[10.5px] italic text-[var(--muted)] truncate block"
            title={state.prompt}
          >
            {state.prompt}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onImprovise}
        disabled={state.status !== "done"}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium shrink-0",
          "text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)]",
          "disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent",
          "transition-colors",
        )}
      >
        <Sparkles className="size-3" />
        Improvise
      </button>
    </footer>
  );
}
