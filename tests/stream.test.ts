import test from "node:test";
import assert from "node:assert/strict";
import { consumeResponse, responsesBody } from "../server/ai.js";
import { ServiceError, sameSecret } from "../server/auth.js";
function response(events: unknown[], chunkSize = 7) {
  const bytes = new TextEncoder().encode(
    events.map((e) => "data: " + JSON.stringify(e) + "\r\n\r\n").join(""),
  );
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset = Math.min(bytes.length, offset + chunkSize);
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "test-request",
      },
    },
  );
}
test("Responses request has exactly supported fields and explicit context", () => {
  const body = responsesBody("account-model", [
    { role: "developer", content: "direct" },
    { role: "user", content: "history included" },
  ]);
  assert.deepEqual(Object.keys(body).sort(), [
    "input",
    "model",
    "store",
    "stream",
  ]);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.ok(Array.isArray(body.input));
});
test("chunked UTF-8 / CRLF SSE measures first text delta and terminal completion", async () => {
  const result = await consumeResponse(
    response(
      [
        { type: "response.created" },
        { type: "response.output_text.delta", delta: "안녕" },
        { type: "response.output_text.delta", delta: " 라이벌" },
        {
          type: "response.completed",
          response: {
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        },
      ],
      1,
    ),
    "model",
    "benchmark",
  );
  assert.equal(result.text, "안녕 라이벌");
  assert.equal(result.measurement.totalTokens, 15);
  assert.equal(result.measurement.completed, true);
  assert.ok(result.measurement.ttftMs !== null);
  assert.ok(result.measurement.completionMs >= result.measurement.ttftMs!);
  assert.equal(result.measurement.requestId, "test-request");
});
test("partial text followed by usage limit is failure, never a completed turn", async () => {
  await assert.rejects(
    () =>
      consumeResponse(
        response([
          { type: "response.output_text.delta", delta: "partial" },
          {
            type: "response.failed",
            response: {
              error: {
                code: "subscription_sharing_usage_limit_exceeded",
                message: "limit",
              },
            },
          },
        ]),
        "model",
        "turn",
      ),
    (e: unknown) =>
      e instanceof ServiceError &&
      e.code === "subscription_sharing_usage_limit_exceeded",
  );
});
test("EOF and response.incomplete cannot pass as success", async () => {
  await assert.rejects(
    () =>
      consumeResponse(
        response([{ type: "response.output_text.delta", delta: "partial" }]),
        "model",
        "turn",
      ),
    /완료 이벤트/,
  );
  await assert.rejects(() =>
    consumeResponse(
      response([{ type: "response.incomplete" }]),
      "model",
      "turn",
    ),
  );
});
test("visible output guard aborts unexpected long output", async () => {
  await assert.rejects(
    () =>
      consumeResponse(
        response([
          { type: "response.output_text.delta", delta: "x".repeat(4100) },
        ]),
        "model",
        "turn",
      ),
    (e: unknown) => e instanceof ServiceError && e.code === "output_guard",
  );
});
test("missing API usage is explicitly unknown, not zero", async () => {
  const r = await consumeResponse(
    response([{ type: "response.completed", response: {} }]),
    "model",
    "turn",
  );
  assert.equal(r.measurement.totalTokens, null);
  assert.equal(r.measurement.ttftMs, null);
});
test("state / CSRF comparisons reject unequal values and lengths", () => {
  assert.equal(sameSecret("same", "same"), true);
  assert.equal(sameSecret("same", "diff"), false);
  assert.equal(sameSecret("", "long"), false);
});
