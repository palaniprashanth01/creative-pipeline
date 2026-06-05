import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type DuplicateRow = { id: string; batchId?: string | null };
  const dispatchRepo = {
    findRecentDuplicate: vi.fn(async (): Promise<DuplicateRow | null> => null),
    findIdempotentRuns: vi.fn(async (row: DuplicateRow) => [row]),
    create: vi.fn(),
    setHold: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  };
  return { dispatchRepo, nextId: 0 };
});

vi.mock("@/lib/auth", () => ({
  authenticateAndAuthorize: vi.fn(async () => ({
    user: { id: "u1", email: "x@y.z", orgId: "o1" },
    project: { id: "c3a4cb05-3c11-46f0-92d3-baa00f1c87bd", orgId: "o1" },
  })),
}));
vi.mock("@/lib/classifier", () => ({
  classify: vi.fn(),
  CLASSIFIER_MODEL: "mock-classifier",
}));
vi.mock("@/lib/credits", () => ({
  hold: vi.fn(async (args: { amount: number }) => ({
    holdId: "h1",
    amount: args.amount,
  })),
  isTerminal: vi.fn(async () => false),
  release: vi.fn(async () => undefined),
}));
vi.mock("@/lib/orchestrator", () => ({
  runDispatch: vi.fn(async () => undefined),
}));
vi.mock("@/lib/repos/dispatches", () => ({
  dispatchRepo: mocks.dispatchRepo,
}));
vi.mock("@/lib/run-bus", () => ({ emit: vi.fn() }));

import { dispatchCreative } from "@/app/actions/dispatch";
import { classify } from "@/lib/classifier";
import { hold } from "@/lib/credits";
import { runDispatch } from "@/lib/orchestrator";

const VALID_PROJECT = "c3a4cb05-3c11-46f0-92d3-baa00f1c87bd";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.nextId = 0;
  mocks.dispatchRepo.findRecentDuplicate.mockResolvedValue(null);
  mocks.dispatchRepo.findIdempotentRuns.mockImplementation(async (row) => [row]);
  mocks.dispatchRepo.create.mockImplementation(async () => {
    mocks.nextId += 1;
    return { id: `run-${mocks.nextId}` };
  });
});

describe("classifier branching (Item 3 gate)", () => {
  it("returns 'ambiguous' with NO db row, NO hold, NO render when confidence < 0.6", async () => {
    vi.mocked(classify).mockResolvedValue({ kind: "image", confidence: 0.4 });

    const res = await dispatchCreative({
      projectId: VALID_PROJECT,
      prompt: "make me something pretty",
    });

    expect(res).toEqual({
      status: "ambiguous",
      suggestedKind: "image",
      confidence: 0.4,
    });
    expect(mocks.dispatchRepo.create).not.toHaveBeenCalled();
    expect(hold).not.toHaveBeenCalled();
    expect(runDispatch).not.toHaveBeenCalled();
  });

  it("returns soft-confirm chips for the 0.6–0.8 confidence band", async () => {
    vi.mocked(classify).mockResolvedValue({ kind: "email", confidence: 0.72 });

    const res = await dispatchCreative({
      projectId: VALID_PROJECT,
      prompt: "write copy about a launch",
    });

    expect(res).toEqual({
      status: "soft",
      suggestedKind: "email",
      confidence: 0.72,
    });
    expect(mocks.dispatchRepo.create).not.toHaveBeenCalled();
    expect(hold).not.toHaveBeenCalled();
    expect(runDispatch).not.toHaveBeenCalled();
  });

  it("proceeds (insert + hold + fire orchestrator) when confidence >= 0.8", async () => {
    vi.mocked(classify).mockResolvedValue({ kind: "email", confidence: 0.85 });

    const res = await dispatchCreative({
      projectId: VALID_PROJECT,
      prompt: "draft a launch email for our spring sale",
    });

    expect(res).toEqual({ status: "ok", runId: "run-1", runIds: ["run-1"] });
    expect(classify).toHaveBeenCalledOnce();
    expect(mocks.dispatchRepo.create).toHaveBeenCalledOnce();
    expect(hold).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1, orgId: "o1", dispatchId: "run-1" }),
    );
    expect(runDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "email", prompt: expect.any(String) }),
    );
  });

  it("skips the classifier entirely when intent is passed explicitly", async () => {
    const res = await dispatchCreative({
      projectId: VALID_PROJECT,
      prompt: "anything goes",
      intent: "landing-page",
    });

    expect(res).toEqual({ status: "ok", runId: "run-1", runIds: ["run-1"] });
    expect(classify).not.toHaveBeenCalled();
    expect(runDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "landing-page" }),
    );
  });
});

describe("stretch dispatch behavior", () => {
  it("fans out count:N into N rows, one shared hold, and N orchestrators", async () => {
    const res = await dispatchCreative({
      projectId: VALID_PROJECT,
      prompt: "generate options",
      intent: "image",
      count: 3,
    });

    expect(res).toEqual({
      status: "ok",
      runId: "run-1",
      runIds: ["run-1", "run-2", "run-3"],
    });
    expect(mocks.dispatchRepo.create).toHaveBeenCalledTimes(3);
    // image kind = 0.5 credits/run × 3 runs = 1.5 (bug #9)
    expect(hold).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1.5, dispatchId: "run-1" }),
    );
    expect(mocks.dispatchRepo.setHold).toHaveBeenCalledTimes(3);
    expect(runDispatch).toHaveBeenCalledTimes(3);
    expect(runDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", batchSize: 3 }),
    );
  });

  it("dedupes repeated batch requests inside the idempotency window", async () => {
    const duplicate = { id: "run-old-2", batchId: "batch-old" };
    mocks.dispatchRepo.findRecentDuplicate.mockImplementation(async () => duplicate);
    mocks.dispatchRepo.findIdempotentRuns.mockResolvedValue([
      { id: "run-old-1" },
      { id: "run-old-2" },
    ]);

    const res = await dispatchCreative({
      projectId: VALID_PROJECT,
      prompt: "generate options",
      intent: "image",
      count: 3,
    });

    expect(res).toEqual({
      status: "ok",
      runId: "run-old-1",
      runIds: ["run-old-1", "run-old-2"],
      idempotent: true,
    });
    expect(mocks.dispatchRepo.findRecentDuplicate).toHaveBeenCalledWith({
      orgId: "o1",
      projectId: VALID_PROJECT,
      prompt: "generate options",
      intent: "image",
      withinMs: 5000,
    });
    expect(mocks.dispatchRepo.create).not.toHaveBeenCalled();
    expect(hold).not.toHaveBeenCalled();
    expect(runDispatch).not.toHaveBeenCalled();
  });
});
