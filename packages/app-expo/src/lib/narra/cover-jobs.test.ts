import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));
vi.mock("@/lib/analytics/telemetry", () => ({ recordTelemetry: vi.fn() }));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///documents/" }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("@/config/bundled-ai", () => ({
  getBundledApiKey: vi.fn(),
  hasBundledOpenRouterKey: false,
}));
import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { type CoverJobSnapshot, acknowledgeCoverJob, boundedCoverBookFacts } from "./cover-jobs";
import { generateBookCoverImage } from "./media";

const id = "b42e5309-0d9f-49b3-89cf-87fc08ee381b";
const requestId = "e2d52fa8-2356-4af2-a47d-d918d0476a9d";
const request = { book: { title: "Книга", author: "Автор" } };
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const job = (status: string, fields = {}) => ({
  job_id: id,
  status,
  poll_after_ms: 1000,
  ...fields,
});
const completed = () => json(job("completed", { image: "aGVsbG8=", mime_type: "image/png" }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("durable cover transport", () => {
  it("submits once, persists the ID immediately and polls queued/running/retry_wait at server intervals", async () => {
    const onJob = vi.fn(async (_snapshot: CoverJobSnapshot) => {});
    vi.mocked(narraGatewayRequest)
      .mockResolvedValueOnce(json(job("queued", { poll_after_ms: 3000 }), 202))
      .mockResolvedValueOnce(json(job("running")))
      .mockResolvedValueOnce(json(job("retry_wait", { poll_after_ms: 2000 })))
      .mockResolvedValueOnce(completed());
    const pending = generateBookCoverImage(request, { requestId, onJob });
    await vi.advanceTimersByTimeAsync(0);
    expect(onJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: id, status: "queued" }));
    await vi.advanceTimersByTimeAsync(2999);
    expect(narraGatewayRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3001);
    await expect(pending).resolves.toMatchObject({ jobId: id });
    expect(vi.mocked(narraGatewayRequest).mock.calls.map(([path]) => path)).toEqual([
      "/v2/media/cover/jobs",
      ...Array(3).fill(`/v2/media/cover/jobs/${id}`),
    ]);
    expect(onJob.mock.calls.map(([snapshot]) => snapshot.status)).toEqual([
      "queued",
      "running",
      "retry_wait",
      "completed",
    ]);
  });

  it("resumes a saved job with GET, respecting its persisted polling time", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(completed());
    const pending = generateBookCoverImage(request, {
      requestId,
      jobId: id,
      nextPollAt: Date.now() + 5000,
      onJob: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(narraGatewayRequest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(narraGatewayRequest).toHaveBeenCalledWith(
      `/v2/media/cover/jobs/${id}`,
      expect.anything(),
    );
  });

  it("accepts completed POST and never acknowledges before local saving", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(completed());
    const pending = generateBookCoverImage(request, { requestId, onJob: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(narraGatewayRequest).toHaveBeenCalledOnce();
  });

  it("fetches the same completed job when an older gateway omits image on POST", async () => {
    vi.mocked(narraGatewayRequest)
      .mockResolvedValueOnce(json(job("completed")))
      .mockResolvedValueOnce(completed());
    const pending = generateBookCoverImage(request, { requestId, onJob: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(narraGatewayRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(narraGatewayRequest).mock.calls[1][0]).toBe(`/v2/media/cover/jobs/${id}`);
  });

  it("records terminal failure and stops without creating a new job", async () => {
    const onJob = vi.fn();
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      json(job("failed", { error: "Blocked", code: "CENSOR" })),
    );
    const check = expect(generateBookCoverImage(request, { requestId, onJob })).rejects.toThrow(
      "Blocked",
    );
    await vi.advanceTimersByTimeAsync(0);
    await check;
    expect(onJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "CENSOR" }),
    );
    expect(narraGatewayRequest).toHaveBeenCalledOnce();
  });

  it("stops on a failed local checkpoint, leaving the result on the server", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(json(job("queued"), 202));
    const check = expect(
      generateBookCoverImage(request, {
        requestId,
        onJob: async () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(0);
    await check;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(narraGatewayRequest).toHaveBeenCalledOnce();
  });

  it("cancels a polling timer without requesting another image", async () => {
    const controller = new AbortController();
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(json(job("queued"), 202));
    const pending = generateBookCoverImage(request, {
      requestId,
      onJob: vi.fn(),
      signal: controller.signal,
    });
    const check = expect(pending).rejects.toThrow("paused");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await check;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(narraGatewayRequest).toHaveBeenCalledOnce();
  });

  it("treats ACK 404 as an already acknowledged result", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(json({}, 404));
    await acknowledgeCoverJob(id);
    expect(narraGatewayRequest).toHaveBeenCalledWith(
      `/v2/media/cover/jobs/${id}/ack`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("bounds book facts and sends no client model/providerprompt", () => {
    const facts = boundedCoverBookFacts({
      title: "T".repeat(900),
      author: "A".repeat(800),
      description: "D".repeat(5000),
      excerpt: "E".repeat(5000),
      subjects: Array(50).fill("S".repeat(200)),
    });
    expect(facts.title).toHaveLength(500);
    expect(facts.author).toHaveLength(500);
    expect(facts.description).toHaveLength(2000);
    expect(facts.excerpt).toHaveLength(2000);
    expect(facts.subjects).toHaveLength(32);
    expect(facts.subjects?.[0]).toHaveLength(120);
    expect(facts).not.toHaveProperty("prompt");
    expect(facts).not.toHaveProperty("model");
  });
});
