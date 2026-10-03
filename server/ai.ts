import { performance } from "node:perf_hooks";
import type { Measurement, Match } from "../src/game/engine.js";
import {
  narrationInput,
  parseFramings,
  type AiProvider,
  type FramingResult,
} from "../src/game/provider.js";
import { ChatGPTAuth, checkedJson, ServiceError } from "./auth.js";
export type StreamResult = { text: string; measurement: Measurement };
export function responsesBody(
  model: string,
  input: { role: "developer" | "user" | "assistant"; content: string }[],
) {
  return { model, input, store: false, stream: true };
}
// Accept both CRLF and LF, chunked UTF-8 and multi-line SSE data. Only response.completed is success.
export async function consumeResponse(
  response: Response,
  model: string,
  kind: Measurement["kind"],
  started = performance.now(),
): Promise<StreamResult> {
  if (!response.ok) await checkedJson(response);
  if (!response.body)
    throw new ServiceError("응답 스트림이 없습니다.", "missing_stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    text = "";
  let ttftMs: number | null = null;
  let completed = false;
  let completedAt: number | null = null;
  let usage: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null = null;
  const measurement: Measurement = {
    kind,
    mode: "chatgpt",
    model,
    ttftMs: null,
    completionMs: 0,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    completed: false,
    requestId: response.headers.get("x-request-id") || undefined,
  };
  const event = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let e;
    try {
      e = JSON.parse(data);
    } catch {
      throw new ServiceError(
        "응답 이벤트를 읽을 수 없습니다.",
        "invalid_event",
      );
    }
    if (
      e.type === "response.output_text.delta" &&
      typeof e.delta === "string" &&
      e.delta.length
    ) {
      if (ttftMs === null) ttftMs = performance.now() - started;
      text += e.delta;
      if (Buffer.byteLength(text) > 4096)
        throw new ServiceError(
          "대사 길이 제한으로 응답을 중단했습니다. 일부 사용량은 집계되지 않을 수 있습니다.",
          "output_guard",
        );
    }
    if (["response.failed", "response.incomplete", "error"].includes(e.type))
      throw new ServiceError(
        e.response?.error?.message ||
          e.error?.message ||
          "AI 응답이 완료되지 않았습니다.",
        e.response?.error?.code || e.error?.code || e.code || e.type,
        503,
        measurement.requestId,
      );
    if (e.type === "response.completed") {
      completed = true;
      completedAt = performance.now();
      usage = e.response?.usage || null;
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      let split;
      while ((split = buffer.indexOf("\n\n")) >= 0) {
        event(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
      }
      if (buffer.length > 262144)
        throw new ServiceError("응답 이벤트가 너무 큽니다.", "stream_guard");
      if (completed) break;
    }
    buffer += decoder.decode();
    if (buffer.trim()) event(buffer);
    if (!completed)
      throw new ServiceError(
        "완료 이벤트 없이 연결이 종료되었습니다. 다시 호출하지 않고 현재 판을 보존했습니다.",
        "interrupted_stream",
      );
    const finalUsage = usage as {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    } | null;
    Object.assign(measurement, {
      ttftMs,
      completionMs: (completedAt ?? performance.now()) - started,
      inputTokens: finalUsage?.input_tokens ?? null,
      outputTokens: finalUsage?.output_tokens ?? null,
      totalTokens: finalUsage?.total_tokens ?? null,
      completed: true,
      textBytes: Buffer.byteLength(text),
    });
    return { text, measurement };
  } catch (e) {
    Object.assign(measurement, {
      ttftMs,
      completionMs: performance.now() - started,
      error: e instanceof ServiceError ? e.code : "stream_error",
      textBytes: Buffer.byteLength(text),
    });
    (e as Error & { measurement?: Measurement }).measurement = measurement;
    throw e;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class ChatGPTProvider implements AiProvider {
  constructor(private auth: ChatGPTAuth) {}
  async request(
    model: string,
    input: ReturnType<typeof narrationInput>,
    kind: Measurement["kind"],
  ) {
    const token = await this.auth.token();
    const body = responsesBody(model, input);
    if (JSON.stringify(body).length > 18000)
      throw new ServiceError("입력 길이 제한입니다.", "input_guard");
    const started = performance.now();
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });
      return await consumeResponse(response, model, kind, started);
    } catch (e) {
      const error = e as Error & { measurement?: Measurement };
      if (!error.measurement)
        error.measurement = {
          kind,
          mode: "chatgpt",
          model,
          ttftMs: null,
          completionMs: performance.now() - started,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          completed: false,
          error:
            e instanceof ServiceError
              ? e.code
              : e instanceof Error
                ? e.name
                : "request_failed",
          requestId: e instanceof ServiceError ? e.requestId : undefined,
        };
      throw error;
    }
  }
  async narrate(match: Match): Promise<FramingResult> {
    if (!match.model)
      throw new ServiceError("모델을 선택해 주세요.", "missing_model");
    const previousCount = match.metrics.length;
    try {
      const result = await this.request(
        match.model,
        narrationInput(match),
        "turn",
      );
      match.metrics.push(result.measurement);
      return parseFramings(result.text);
    } catch (e) {
      const metric = (e as Error & { measurement?: Measurement }).measurement;
      if (metric) match.metrics.push(metric);
      else if (match.metrics.length === previousCount)
        match.metrics.push({
          kind: "turn",
          mode: "chatgpt",
          model: match.model,
          ttftMs: null,
          completionMs: 0,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          completed: false,
          error: e instanceof ServiceError ? e.code : "request_failed",
        });
      throw e;
    }
  }
}
