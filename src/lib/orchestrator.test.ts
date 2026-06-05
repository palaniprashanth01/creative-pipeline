import { beforeEach, describe, expect, it, vi } from "vitest";

type BatchRow = {
  status: "queued" | "classified" | "running" | "done" | "failed" | "ambiguous";
};

const mocks = vi.hoisted(() => ({
  dispatchRepo: {
    markRunning: vi.fn(async () => undefined),
    markDone: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    findBatch: vi.fn(async (): Promise<BatchRow[]> => []),
  },
  artifactRepo: {
    create: vi.fn(async () => ({
      id: "00000000-0000-0000-0000-0000000000bb",
    })),
  },
}));

vi.mock("@/lib/credits", () => ({
  settle: vi.fn(async () => undefined),
  release: vi.fn(async () => undefined),
  isTerminal: vi.fn(async () => false),
  netHeld: vi.fn(async () => 1),
}));
vi.mock("@/lib/renderers", () => ({
  IMAGE_MODEL: "mock-image",
  RENDER_MODEL: "mock-renderer",
  renderImage: vi.fn(() => ({ url: "https://example.test/image.png" })),
  renderStructured: vi.fn(),
}));
vi.mock("@/lib/repos/artifacts", () => ({
  artifactRepo: mocks.artifactRepo,
}));
vi.mock("@/lib/repos/dispatches", () => ({
  dispatchRepo: mocks.dispatchRepo,
}));
vi.mock("@/lib/run-bus", () => ({
  emit: vi.fn(),
  registerAbort: vi.fn(() => new AbortController()),
}));

import { finalizeBatchIfReady, runDispatch } from "@/lib/orchestrator";
import { isTerminal, netHeld, release, settle } from "@/lib/credits";
import { renderStructured } from "@/lib/renderers";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTerminal).mockResolvedValue(false);
  vi.mocked(netHeld).mockResolvedValue(1);
  mocks.dispatchRepo.findBatch.mockResolvedValue([]);
});

describe("credit-release-on-abort (Item 8)", () => {
  it("releases the hold and does NOT settle when the renderer aborts", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.mocked(renderStructured).mockRejectedValue(abortErr);

    await runDispatch({
      runId: "00000000-0000-0000-0000-0000000000cc",
      kind: "email",
      prompt: "anything",
      holdId: "h1",
    });

    expect(release).toHaveBeenCalledWith("h1");
    expect(settle).not.toHaveBeenCalled();
  });

  it("releases on a generic render error too", async () => {
    vi.mocked(renderStructured).mockRejectedValue(new Error("upstream 500"));

    await runDispatch({
      runId: "00000000-0000-0000-0000-0000000000dd",
      kind: "landing-page",
      prompt: "anything",
      holdId: "h2",
    });

    expect(release).toHaveBeenCalledWith("h2");
    expect(settle).not.toHaveBeenCalled();
  });

  it("does NOT double-release if the hold is already terminal", async () => {
    vi.mocked(renderStructured).mockRejectedValue(new Error("boom"));
    vi.mocked(isTerminal).mockResolvedValue(true);

    await runDispatch({
      runId: "00000000-0000-0000-0000-0000000000ee",
      kind: "email",
      prompt: "anything",
      holdId: "h3",
    });

    expect(release).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("settles on the success path (image renderer doesn't throw)", async () => {
    await runDispatch({
      runId: "00000000-0000-0000-0000-0000000000ff",
      kind: "image",
      prompt: "kitten",
      holdId: "h4",
    });

    expect(settle).toHaveBeenCalledWith("h4");
    expect(release).not.toHaveBeenCalled();
  });
});

describe("batch credit finalization", () => {
  it("settles completed siblings and releases failed siblings once all are terminal", async () => {
    mocks.dispatchRepo.findBatch.mockResolvedValue([
      { status: "done" },
      { status: "done" },
      { status: "failed" },
    ]);

    await finalizeBatchIfReady("batch-1", "hold-1");

    expect(settle).toHaveBeenCalledWith("hold-1", 2);
    expect(release).toHaveBeenCalledWith("hold-1", 1);
  });

  it("does not finalize while any sibling is still running", async () => {
    mocks.dispatchRepo.findBatch.mockResolvedValue([
      { status: "done" },
      { status: "running" },
      { status: "failed" },
    ]);

    await finalizeBatchIfReady("batch-1", "hold-1");

    expect(settle).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("does not skip a needed release just because a partial settle already exists", async () => {
    vi.mocked(netHeld).mockResolvedValue(1);
    mocks.dispatchRepo.findBatch.mockResolvedValue([
      { status: "done" },
      { status: "failed" },
    ]);
    // Bug #7 — finalizer now checks the pg error code, not the message text.
    vi.mocked(settle).mockRejectedValueOnce(
      Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
      }),
    );

    await finalizeBatchIfReady("batch-1", "hold-1");

    expect(settle).toHaveBeenCalledWith("hold-1", 1);
    expect(release).toHaveBeenCalledWith("hold-1", 1);
  });
});
