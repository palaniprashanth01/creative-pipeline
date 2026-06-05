"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  ArrowUp,
  Image as ImageIcon,
  Layout,
  Layers,
  Mail,
  Sparkles,
  X,
} from "lucide-react";
import { dispatchCreative } from "@/app/actions/dispatch";
import { deleteDispatch } from "@/app/actions/delete";
import { Sheet } from "@/components/sheet";
import { Tile, type TileEvent, type TileState } from "@/components/tile";
import { DrawerBody } from "@/components/drawer-body";
import { MAX_BATCH_COUNT } from "@/lib/constants";
import type { ArtifactPayload, Intent } from "@/lib/schemas";

export type InitialTile = {
  runId: string;
  prompt: string;
  kind: Intent | null;
  status: "queued" | "classified" | "running" | "done" | "failed" | "ambiguous";
  payload: ArtifactPayload | null;
  artifactId: string | null;
  parentArtifactId: string | null;
};

type Banner =
  | { kind: "info" | "warn" | "error"; text: string }
  | {
      kind: "soft";
      suggestedKind: Intent;
      confidence: number;
      onConfirm: (i: Intent) => void;
    }
  | null;

const EXAMPLES: { kind: "landing-page" | "email" | "image"; text: string }[] = [
  // ── Landing pages (7) ──
  {
    kind: "landing-page",
    text: "Landing page hero for a new productivity app called Tempo",
  },
  {
    kind: "landing-page",
    text: "Hero section for an indie coffee subscription brand",
  },
  {
    kind: "landing-page",
    text: "Pricing-page hero for a tier-based SaaS analytics tool",
  },
  {
    kind: "landing-page",
    text: "About-us hero for a sustainable fashion brand from Portland",
  },
  {
    kind: "landing-page",
    text: "Waitlist signup hero for an AI writing assistant",
  },
  {
    kind: "landing-page",
    text: "Hero for a B2B cybersecurity firm targeting healthcare",
  },
  {
    kind: "landing-page",
    text: "Launch hero for a remote-team scheduling app called Sync",
  },
  // ── Emails (7) ──
  { kind: "email", text: "Launch email for our spring sale of running shoes" },
  { kind: "email", text: "Onboarding welcome email for a new SaaS signup" },
  { kind: "email", text: "Black Friday email for a premium headphones brand" },
  {
    kind: "email",
    text: "Cart-abandonment email for a high-end skincare store",
  },
  {
    kind: "email",
    text: "Re-engagement email for a fitness app, users inactive 30 days",
  },
  {
    kind: "email",
    text: "Customer-success check-in after the first month of usage",
  },
  {
    kind: "email",
    text: "Beta-invite email for early access to a developer tool",
  },
  // ── Images (6) ──
  { kind: "image", text: "A cyberpunk skyline at sunset, neon reflections" },
  { kind: "image", text: "Minimalist product shot of a ceramic mug on linen" },
  { kind: "image", text: "Top-down flat lay of artisan pastries on marble" },
  {
    kind: "image",
    text: "Editorial portrait of a chef in a stainless-steel kitchen",
  },
  {
    kind: "image",
    text: "Aerial drone shot of a winding mountain road at golden hour",
  },
  {
    kind: "image",
    text: "Macro photo of dew on a single fern leaf, soft morning light",
  },
];

const KIND_META = {
  "landing-page": {
    icon: Layout,
    label: "Landing",
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
} as const;

const STATUS_MAP: Record<InitialTile["status"], TileState["status"]> = {
  queued: "queued",
  classified: "classified",
  running: "running",
  done: "done",
  failed: "error",
  ambiguous: "error",
};

export function CanvasClient({
  projectId,
  initial,
}: {
  projectId: string;
  initial: InitialTile[];
}) {
  const [tiles, setTiles] = useState<Record<string, TileState>>(() =>
    Object.fromEntries(
      initial.map((t) => [
        t.runId,
        {
          runId: t.runId,
          prompt: t.prompt,
          kind: t.kind ?? undefined,
          status: STATUS_MAP[t.status],
          payload: t.payload ?? undefined,
          artifactId: t.artifactId ?? undefined,
          parentArtifactId: t.parentArtifactId ?? undefined,
        },
      ]),
    ),
  );
  const [order, setOrder] = useState<string[]>(() =>
    initial.map((t) => t.runId),
  );
  const [highlightRunId, setHighlightRunId] = useState<string | null>(null);

  const promptByArtifact = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of initial) {
      if (t.artifactId) m[t.artifactId] = t.prompt;
    }
    return m;
  }, [initial]);

  const [prompt, setPrompt] = useState("");
  const [batchCount, setBatchCount] = useState(1);
  const [parent, setParent] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [banner, setBanner] = useState<Banner>(null);
  const [pending, startTransition] = useTransition();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const useExample = useCallback((text: string) => {
    setPrompt(text);
    setBanner(null);
    setParent(null); // Bug #5 — drop any pending Improvise context.
    promptRef.current?.focus();
  }, []);

  const removeTile = useCallback(
    async (runId: string) => {
      // Bug #2 — drawer was showing stale data for a tile we just deleted.
      setDrawerId((cur) => (cur === runId ? null : cur));
      setOrder((prev) => prev.filter((r) => r !== runId));
      setTiles((prev) => {
        // Bug #10 — cleaner mutation than the destructure-with-void dance.
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      const res = await deleteDispatch({ projectId, dispatchId: runId });
      if (res.status !== "ok") {
        setBanner({
          kind: "error",
          text: `Couldn't delete tile: ${res.message}`,
        });
      }
    },
    [projectId],
  );

  const updateTile = useCallback((runId: string, patch: Partial<TileState>) => {
    setTiles((prev) => {
      const cur = prev[runId];
      if (!cur) return prev;
      return { ...prev, [runId]: { ...cur, ...patch } };
    });
  }, []);

  const onTileEvent = useCallback(
    (runId: string, e: TileEvent) => {
      if (e.type === "classified") {
        updateTile(runId, { kind: e.kind, status: "classified" });
      } else if (e.type === "dispatched") {
        updateTile(runId, { status: "running" });
      } else if (e.type === "partial") {
        setTiles((prev) => {
          const cur = prev[runId];
          if (!cur) return prev;
          return {
            ...prev,
            [runId]: {
              ...cur,
              status: "running",
              payload: { ...(cur.payload ?? {}), ...e.data },
            },
          };
        });
      } else if (e.type === "done") {
        updateTile(runId, {
          status: "done",
          payload: e.payload,
          artifactId: e.artifactId,
        });
      } else if (e.type === "error") {
        updateTile(runId, { status: "error", error: e.message });
      }
    },
    [updateTile],
  );

  /** Pulse-highlight a tile briefly (used by idempotent reuse). */
  const flashTile = useCallback((runId: string) => {
    setHighlightRunId(runId);
    setTimeout(() => setHighlightRunId(null), 1600);
  }, []);

  const send = useCallback(
    (text: string, explicitIntent?: Intent, count = batchCount) => {
      if (!text.trim() || pending) return;
      const localParent = parent;
      setBanner(null);

      startTransition(async () => {
        const result = await dispatchCreative({
          projectId,
          prompt: text,
          intent: explicitIntent,
          parentArtifactId: localParent?.id,
          count: count > 1 ? count : undefined,
        });

        if (result.status === "ok") {
          // Idempotency: server reused recent dispatches — highlight/re-add them.
          if (result.idempotent) {
            const missing = result.runIds.filter((runId) => !(runId in tiles));
            if (missing.length > 0) {
              setOrder((prev) => [
                ...missing,
                ...prev.filter((runId) => !missing.includes(runId)),
              ]);
              setTiles((prev) => ({
                ...prev,
                ...Object.fromEntries(
                  missing.map((runId) => [
                    runId,
                    {
                      runId,
                      prompt: text,
                      status: "queued" as const,
                      parentArtifactId: localParent?.id,
                    },
                  ]),
                ),
              }));
            }
            for (const runId of result.runIds) flashTile(runId);
            setBanner({
              kind: "info",
              text:
                result.runIds.length > 1
                  ? `Same prompt within 5s — reusing ${result.runIds.length} previous runs.`
                  : "Same prompt within 5s — reusing the previous run.",
            });
            setPrompt("");
            setParent(null);
            return;
          }

          const newTiles: Record<string, TileState> = {};
          for (const runId of result.runIds) {
            newTiles[runId] = {
              runId,
              prompt: text,
              status: "queued",
              parentArtifactId: localParent?.id,
            };
          }
          setTiles((prev) => ({ ...prev, ...newTiles }));
          setOrder((prev) => [...result.runIds, ...prev]);
          setPrompt("");
          setParent(null);
          setBatchCount(1);
        } else if (result.status === "ambiguous") {
          setBanner({
            kind: "warn",
            text: `Ambiguous — only ${(result.confidence * 100).toFixed(0)}% confident this is ${result.suggestedKind}. Try rephrasing or pick intent explicitly.`,
          });
        } else if (result.status === "soft") {
          setBanner({
            kind: "soft",
            suggestedKind: result.suggestedKind,
            confidence: result.confidence,
            onConfirm: (intent: Intent) => send(text, intent, count),
          });
        } else {
          setBanner({ kind: "error", text: result.message });
        }
      });
    },
    [batchCount, parent, pending, projectId, tiles, flashTile],
  );

  return (
    <div className="flex h-screen flex-col">
      <Header projectId={projectId} count={order.length} />

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          {order.length === 0 ? (
            <EmptyState
              onExample={useExample}
              onSend={(text, kind) => send(text, kind, 1)}
            />
          ) : (
            <div className="mx-auto max-w-6xl px-6 py-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {order.map((runId) => {
                const t = tiles[runId];
                if (!t) return null;
                const parentLabel = t.parentArtifactId
                  ? promptByArtifact[t.parentArtifactId]?.slice(0, 40)
                  : undefined;
                return (
                  <div
                    key={runId}
                    className={
                      runId === highlightRunId
                        ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)] rounded-2xl transition-all"
                        : ""
                    }
                  >
                    <Tile
                      state={t}
                      parentLabel={parentLabel}
                      onEvent={(e) => onTileEvent(runId, e)}
                      onOpenDrawer={() => setDrawerId(runId)}
                      onClickDelete={() => removeTile(runId)}
                      // Bug #4 — retry passes the original prompt + kind so we
                      // skip the classifier on re-dispatch (intent is known).
                      onClickRetry={() => send(t.prompt, t.kind, 1)}
                      onClickImprovise={() => {
                        if (!t.artifactId) return;
                        promptByArtifact[t.artifactId] = t.prompt;
                        setParent({
                          id: t.artifactId,
                          label: t.prompt.slice(0, 40),
                        });
                        promptRef.current?.focus();
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </main>

        <ExamplesSidebar
          onPick={useExample}
          onSend={(text, kind) => send(text, kind, 1)}
        />
      </div>

      <Composer
        promptRef={promptRef}
        prompt={prompt}
        setPrompt={setPrompt}
        pending={pending}
        submit={() => send(prompt)}
        banner={banner}
        clearBanner={() => setBanner(null)}
        parent={parent}
        clearParent={() => setParent(null)}
        batchCount={batchCount}
        setBatchCount={setBatchCount}
      />

      <Sheet
        open={drawerId !== null}
        onOpenChange={(v) => !v && setDrawerId(null)}
        title="Why this?"
        description="Full provenance for this run — prompt, classifier output, timeline, ledger, and lineage."
      >
        {drawerId ? (
          <DrawerBody dispatchId={drawerId} onJumpTo={(id) => setDrawerId(id)} />
        ) : null}
      </Sheet>
    </div>
  );
}

function Header({ projectId, count }: { projectId: string; count: number }) {
  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/60 backdrop-blur-xl px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-gradient-to-br from-[var(--accent)] to-violet-700 flex items-center justify-center text-white">
          <Sparkles className="size-4.5" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Creative Pipeline
          </h1>
          <p className="text-xs text-[var(--muted)] font-mono">
            {projectId.slice(0, 8)}… · {count} {count === 1 ? "tile" : "tiles"}
          </p>
        </div>
      </div>
    </header>
  );
}

function EmptyState({
  onExample,
  onSend,
}: {
  onExample: (t: string) => void;
  onSend: (t: string, k: Intent) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <h2 className="text-5xl sm:text-6xl font-semibold tracking-tight text-balance">
        What do you want to create?
      </h2>
      <p className="mt-4 text-lg text-[var(--muted)] text-balance max-w-xl">
        Pick a sample on the right — click the body to edit, or the arrow to
        send it instantly. Or type your own below.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-2 max-w-3xl">
        {EXAMPLES.slice(0, 6).map((ex) => {
          const Meta = KIND_META[ex.kind];
          const Icon = Meta.icon;
          return (
            <div
              key={ex.text}
              className="group inline-flex items-stretch rounded-full border border-[var(--border)] bg-[var(--surface)] overflow-hidden hover:border-[var(--border-strong)] hover:shadow-sm transition-all"
            >
              <button
                type="button"
                onClick={() => onExample(ex.text)}
                className="inline-flex items-center gap-2 pl-4 pr-2 py-2.5 text-sm"
              >
                <Icon className={`size-4 ${Meta.tint}`} />
                <span className="truncate max-w-[260px]">{ex.text}</span>
              </button>
              <button
                type="button"
                onClick={() => onSend(ex.text, ex.kind)}
                aria-label="Send now"
                title="Send now"
                className="px-3 border-l border-[var(--border)] text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] transition-colors"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExamplesSidebar({
  onPick,
  onSend,
}: {
  onPick: (t: string) => void;
  onSend: (t: string, k: Intent) => void;
}) {
  return (
    <aside className="hidden lg:flex w-[22rem] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]/40 backdrop-blur-xl overflow-y-auto">
      <div className="sticky top-0 z-10 px-5 py-4 border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-xl">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
          Try one ({EXAMPLES.length})
        </h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Click body to edit · click <ArrowUp className="inline size-3" /> to
          send instantly
        </p>
      </div>
      <ul className="p-3 space-y-2">
        {EXAMPLES.map((ex) => {
          const Meta = KIND_META[ex.kind];
          const Icon = Meta.icon;
          return (
            <li key={ex.text}>
              <div className="group flex items-stretch rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden hover:border-[var(--border-strong)] hover:-translate-y-0.5 hover:shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)] transition-all">
                <button
                  type="button"
                  onClick={() => onPick(ex.text)}
                  className="flex-1 text-left px-3.5 py-3"
                  title="Drop into composer"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className={`size-4 ${Meta.tint}`} />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                      {Meta.label}
                    </span>
                  </div>
                  <p className="text-sm leading-snug text-[var(--foreground)]">
                    {ex.text}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => onSend(ex.text, ex.kind)}
                  aria-label={`Send: ${ex.text}`}
                  title="Send now"
                  className="px-3 border-l border-[var(--border)] text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] transition-colors flex items-center"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function Composer({
  promptRef,
  prompt,
  setPrompt,
  pending,
  submit,
  banner,
  clearBanner,
  parent,
  clearParent,
  batchCount,
  setBatchCount,
}: {
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  prompt: string;
  setPrompt: (s: string) => void;
  pending: boolean;
  submit: () => void;
  banner: Banner;
  clearBanner: () => void;
  parent: { id: string; label: string } | null;
  clearParent: () => void;
  batchCount: number;
  setBatchCount: (n: number) => void;
}) {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface)]/70 backdrop-blur-xl px-6 py-5">
      <div className="mx-auto w-full max-w-2xl">
        {banner ? <BannerView banner={banner} onClose={clearBanner} /> : null}

        {parent ? (
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] px-3 py-1 text-xs font-medium">
              <Sparkles className="size-3.5" />
              Improvising → {parent.label}
            </span>
            <button
              type="button"
              onClick={clearParent}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              clear
            </button>
          </div>
        ) : null}

        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="What do you want to create?"
            rows={2}
            className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--surface)] pl-5 pr-36 py-4 text-lg leading-relaxed shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-soft)] placeholder:text-[var(--muted)] transition-all"
          />
          <div className="absolute right-3 bottom-3 flex items-center gap-2">
            <BatchPicker value={batchCount} onChange={setBatchCount} />
            <button
              type="submit"
              disabled={!prompt.trim() || pending}
              aria-label="Send"
              className="inline-flex size-10 items-center justify-center rounded-xl bg-[var(--foreground)] text-[var(--background)] shadow-sm hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
            >
              {pending ? (
                <span className="size-2.5 rounded-full bg-[var(--background)] animate-pulse" />
              ) : (
                <ArrowUp className="size-5" />
              )}
            </button>
          </div>
        </form>
        <div className="mt-2 flex items-center justify-between gap-1 text-xs text-[var(--muted)]">
          <span>
            {batchCount > 1 ? `Will fan out into ${batchCount} runs.` : ""}
          </span>
          <span className="flex items-center gap-1">
            Press
            <kbd className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 font-sans">
              ⌘
            </kbd>
            <kbd className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 font-sans">
              Enter
            </kbd>
            to send
          </span>
        </div>
      </div>
    </footer>
  );
}

function BatchPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-xs text-[var(--muted)]">
      <Layers className="size-3.5" />
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-transparent outline-none font-mono"
        aria-label="Number of parallel runs"
      >
        {Array.from({ length: MAX_BATCH_COUNT }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            ×{n}
          </option>
        ))}
      </select>
    </label>
  );
}

function BannerView({ banner, onClose }: { banner: Banner; onClose: () => void }) {
  if (!banner) return null;
  if (banner.kind === "soft") {
    return (
      <div className="mb-3 rounded-lg border border-amber-300/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
        <p className="text-sm text-amber-900 dark:text-amber-300">
          Looks like{" "}
          <strong className="font-semibold">
            {banner.suggestedKind === "landing-page"
              ? "a landing page"
              : `an ${banner.suggestedKind}`}
          </strong>{" "}
          ({(banner.confidence * 100).toFixed(0)}% confident). Confirm or pick a
          different intent:
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["landing-page", "email", "image"] as const).map((kind) => {
            const isSuggested = kind === banner.suggestedKind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => banner.onConfirm(kind)}
                className={
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                  (isSuggested
                    ? "bg-amber-900 text-amber-50 dark:bg-amber-300 dark:text-amber-950"
                    : "bg-white dark:bg-amber-900/30 text-amber-900 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50")
                }
              >
                {kind === "landing-page" ? "Landing page" : kind === "email" ? "Email" : "Image"}
                {isSuggested ? " ✓" : ""}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div
      className={
        "mb-3 flex items-start justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm " +
        (banner.kind === "warn"
          ? "border-amber-300/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
          : banner.kind === "error"
            ? "border-rose-300/40 bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300"
            : "border-violet-300/40 bg-violet-50 text-violet-900 dark:bg-violet-950/30 dark:text-violet-300")
      }
    >
      <span className="flex-1">{banner.text}</span>
      <button
        type="button"
        onClick={onClose}
        className="opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
