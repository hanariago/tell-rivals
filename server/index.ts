import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import {
  createMatch,
  publicMatch,
  extractTells,
  openRound,
  chooseOpening,
  chooseReply,
  finishMatch,
  applyFramings,
  type Match,
  type Mode,
  type Feature,
} from "../src/game/engine.js";
import { narrationInput } from "../src/game/provider.js";
import { LocalTellStore, dataDirectory } from "./storage.js";
import { ChatGPTAuth, ServiceError, sameSecret, secureRandom } from "./auth.js";
import { ChatGPTProvider } from "./ai.js";

const root = fileURLToPath(new URL("..", import.meta.url));
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
const lock = path.join(dataDirectory, "runtime.lock");
async function acquireLock() {
  try {
    const file = await open(lock, "wx", 0o600);
    await file.writeFile(String(process.pid));
    await file.close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const oldPid = Number(await readFile(lock, "utf8"));
    let alive = false;
    try {
      process.kill(oldPid, 0);
      alive = true;
    } catch {
      /* stale lock */
    }
    if (alive)
      throw new Error(
        "TELL이 이미 실행 중입니다. http://127.0.0.1:4317을 열어 주세요.",
      );
    await unlink(lock);
    const file = await open(lock, "wx", 0o600);
    await file.writeFile(String(process.pid));
    await file.close();
  }
}
await acquireLock();
process.on("exit", () => {
  try {
    unlinkSync(lock);
  } catch {
    /* already closed */
  }
});
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
const auth = new ChatGPTAuth();
await auth.init();
const store = new LocalTellStore();
const ai = new ChatGPTProvider(auth);
let match: Match | null = await store.loadMatch();
if (match?.stage === "finished" && match.record) {
  const saved = await store.read(match.mode);
  if (saved.length < match.round) await store.append(match.mode, match.record);
}
let catalog: { slug: string; display_name: string }[] = [];
let catalogAccount: string | null = null;
let busy = false;
let planPaused = false;
const app = express();
app.disable("x-powered-by");
let origin = "";
const sessions = new Map<string, { csrf: string; time: number }>();
const production = process.argv.includes("--production");
app.use((req, res, next) => {
  if (req.headers.host !== new URL(origin).host) {
    res.status(403).json({ error: "127.0.0.1 주소로 실행해 주세요." });
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'" +
      (production ? "" : " 'unsafe-inline'") +
      "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (req.path.startsWith("/api") || req.path.startsWith("/auth"))
    res.setHeader("Cache-Control", "no-store");
  for (const [id, s] of sessions)
    if (Date.now() - s.time > 86400000) sessions.delete(id);
  const cookie = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("tell_session="))
    ?.slice(13);
  let id = cookie && sessions.has(cookie) ? cookie : null;
  if (!id) {
    id = secureRandom();
    sessions.set(id, { csrf: secureRandom(), time: Date.now() });
    res.cookie("tell_session", id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 86400000,
    });
  }
  res.locals.browserSession = id;
  res.locals.csrf = sessions.get(id)!.csrf;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (
      (req.headers.origin && req.headers.origin !== origin) ||
      !sameSecret(String(req.headers["x-tell-csrf"] || ""), res.locals.csrf)
    ) {
      res
        .status(403)
        .json({ error: "페이지를 새로 열어 주세요.", code: "csrf" });
      return;
    }
  }
  next();
});
app.use(express.json({ limit: "16kb" }));
async function snapshot(mode: Mode, csrf: string) {
  const history = await store.read(mode);
  const allMetrics = history.flatMap((r) => r.metrics);
  const real = allMetrics.filter((m) => m.mode === "chatgpt" && m.completed);
  const withUsage = real.filter((m) => m.totalTokens !== null);
  const fullyMeasuredRounds = history.filter(
    (r) =>
      r.metrics.length > 0 &&
      r.metrics.every((m) => m.completed && m.totalTokens !== null),
  );
  return {
    testMode: process.env.TELL_TEST_MODE === "1",
    csrf,
    mode,
    auth: auth.publicState(),
    history,
    tells: extractTells(history),
    match:
      match && (match.mode === mode || match.stage !== "finished")
        ? publicMatch(match)
        : null,
    benchmark: await store.loadBenchmark(),
    catalog,
    planPaused,
    stats: {
      rounds: history.length,
      wins: history.filter((r) => r.won).length,
      points: history.reduce(
        (s, r) => s + (r.won ? 100 : 25) + (r.deception?.success ? 75 : 0),
        0,
      ),
      roleSamples: {
        citizen: history.filter((r) => r.humanRole === "citizen").length,
        mafia: history.filter((r) => r.humanRole === "mafia").length,
      },
      averageMs: history.length
        ? history.reduce((s, r) => s + r.elapsedMs, 0) / history.length
        : null,
      averageTokens: fullyMeasuredRounds.length
        ? fullyMeasuredRounds.reduce(
            (s, r) => s + r.metrics.reduce((n, m) => n + m.totalTokens!, 0),
            0,
          ) / fullyMeasuredRounds.length
        : null,
      measuredCalls: withUsage.length,
      unknownUsageCalls: allMetrics.filter(
        (m) => m.mode === "chatgpt" && m.totalTokens === null,
      ).length,
      totalTokens: withUsage.reduce((s, m) => s + m.totalTokens!, 0),
      realCalls: real.length,
    },
  };
}
function modeOf(value: unknown): Mode {
  return value === "chatgpt" ? "chatgpt" : "practice";
}
app.get("/api/state", async (req, res) => {
  res.json(await snapshot(modeOf(req.query.mode), res.locals.csrf));
});
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "TELL Rivals", version: "0.1.0" });
});
app.post("/api/auth/start", async (req, res) => {
  if (busy || (match?.mode === "chatgpt" && match.stage !== "finished"))
    throw new ServiceError(
      "현재 판을 끝낸 뒤 계정을 연결해 주세요.",
      "active_match",
      409,
    );
  res.json({
    url: await auth.begin(
      res.locals.browserSession,
      origin + "/auth/callback",
      typeof req.body.accountId === "string" ? req.body.accountId : undefined,
      req.body.consent === true,
    ),
  });
});
app.get("/auth/callback", async (req, res) => {
  if (busy) {
    res.redirect("/?auth_error=busy");
    return;
  }
  busy = true;
  try {
    await auth.callback(
      new URL(req.originalUrl, origin).searchParams,
      res.locals.browserSession,
    );
    catalog = [];
    catalogAccount = null;
    planPaused = false;
    res.redirect("/?connected=1");
  } catch (e) {
    const code =
      e instanceof ServiceError ? e.code : "identity_validation_failed";
    res.redirect("/?auth_error=" + encodeURIComponent(code));
  } finally {
    busy = false;
  }
});
app.post("/api/auth/welcome", async (_req, res) => {
  if (busy)
    throw new ServiceError("진행 중 응답을 기다려 주세요.", "busy", 409);
  busy = true;
  try {
    await auth.welcome();
    res.json({ ok: true });
  } finally {
    busy = false;
  }
});
app.post("/api/auth/logout", async (_req, res) => {
  if (busy)
    throw new ServiceError("응답이 끝난 뒤 연결을 해제해 주세요.", "busy", 409);
  busy = true;
  try {
    const revoked = await auth.logout();
    catalog = [];
    catalogAccount = null;
    res.json({ revoked });
  } finally {
    busy = false;
  }
});
app.post("/api/models", async (_req, res) => {
  if (busy)
    throw new ServiceError("진행 중 응답을 기다려 주세요.", "busy", 409);
  busy = true;
  try {
    catalog = await auth.models();
    catalogAccount = auth.publicState().activeId;
    res.json({ models: catalog });
  } finally {
    busy = false;
  }
});
app.post("/api/benchmark", async (req, res) => {
  if (busy)
    throw new ServiceError("진행 중 응답을 기다려 주세요.", "busy", 409);
  if (
    !catalog.some((m) => m.slug === req.body.model) ||
    catalogAccount !== auth.publicState().activeId
  )
    throw new ServiceError(
      "현재 계정의 모델을 선택해 주세요.",
      "invalid_model",
    );
  busy = true;
  try {
    const dummy = createMatch([], "chatgpt", 23, true, req.body.model);
    chooseOpening(
      Object.assign(dummy, { stage: "opening" }),
      [],
      { approach: "observe", target: "nora" },
      null,
    );
    const result = await ai.request(
      req.body.model,
      narrationInput(dummy),
      "benchmark",
    );
    await store.saveBenchmark(result.measurement);
    res.json({ measurement: result.measurement });
  } catch (e) {
    const metric = (
      e as Error & { measurement?: import("../src/game/engine.js").Measurement }
    ).measurement;
    if (metric) await store.saveBenchmark(metric);
    throw e;
  } finally {
    busy = false;
  }
});
app.post("/api/game/start", async (req, res) => {
  if (busy || (match && match.stage !== "finished"))
    throw new ServiceError(
      "진행 중인 판을 이어가거나 포기해 주세요.",
      "active_match",
      409,
    );
  const mode = modeOf(req.body.mode);
  const model = mode === "chatgpt" ? req.body.model : null;
  if (mode === "chatgpt") {
    if (planPaused)
      throw new ServiceError(
        "ChatGPT 사용량을 확인한 뒤 다시 진행해 주세요.",
        "subscription_sharing_usage_limit_exceeded",
        429,
      );
    await auth.token();
    if (
      !catalog.some((m) => m.slug === model) ||
      catalogAccount !== auth.publicState().activeId
    )
      throw new ServiceError(
        "현재 계정의 모델을 먼저 불러와 주세요.",
        "invalid_model",
      );
  }
  const history = await store.read(mode);
  match = createMatch(
    history,
    mode,
    randomInt(0, 0x7fffffff),
    req.body.memoryEnabled !== false,
    model,
  );
  await store.saveMatch(match);
  res.json(await snapshot(mode, res.locals.csrf));
});
app.post("/api/game/action", async (req, res) => {
  if (busy || !match || match.id !== req.body.matchId)
    throw new ServiceError(
      "현재 판 상태를 확인해 주세요.",
      "stale_action",
      409,
    );
  const current = match;
  busy = true;
  try {
    if (current.aiError && req.body.action !== "ack-error")
      throw new ServiceError(
        "응답 오류 안내를 먼저 확인해 주세요.",
        "ack_required",
      );
    const history = await store.read(current.mode);
    switch (req.body.action) {
      case "reveal":
        openRound(current);
        break;
      case "opening":
        chooseOpening(
          current,
          history,
          { approach: req.body.approach, target: req.body.target },
          (req.body.plan || null) as Feature | null,
        );
        break;
      case "reply":
        chooseReply(current, history, {
          reply: req.body.reply,
          target: req.body.target,
        });
        break;
      case "vote": {
        const record = finishMatch(current, req.body.target);
        await store.saveMatch(current);
        await store.append(current.mode, record);
        break;
      }
      case "ack-error":
        current.aiError = null;
        current.localFallback = true;
        break;
      default:
        throw new ServiceError("알 수 없는 선택입니다.", "invalid_action");
    }
    const narrating =
      ["opening", "reply"].includes(req.body.action) &&
      current.mode === "chatgpt" &&
      !current.localFallback;
    if (narrating) {
      current.aiError = "AI 응답이 중단되었습니다. 저장된 선택은 유지됩니다.";
      await store.saveMatch(current);
      const knownTokens = current.metrics.reduce(
        (s, m) => s + (m.totalTokens || 0),
        0,
      );
      if (
        knownTokens >= 8000 ||
        current.metrics.length >= 2 ||
        current.metrics.some((m) => m.totalTokens === null)
      )
        current.aiError =
          "판당 사용량 보호가 작동했습니다. 추가 호출 없이 로컬 대사로 이어갈 수 있습니다.";
      else {
        try {
          applyFramings(current, await ai.narrate(current));
          current.aiError = null;
        } catch (e) {
          const code =
            e instanceof ServiceError
              ? e.code
              : (e as Error).name === "TimeoutError"
                ? "timeout"
                : "request_failed";
          if (code === "subscription_sharing_usage_limit_exceeded")
            planPaused = true;
          current.aiError =
            code +
            ": " +
            (e instanceof ServiceError
              ? e.message
              : "응답을 완료하지 못했습니다. 선택은 저장되었고 자동 재호출하지 않습니다.");
        }
      }
    }
    await store.saveMatch(current);
    res.json(await snapshot(current.mode, res.locals.csrf));
  } finally {
    busy = false;
  }
});
app.post("/api/game/abandon", async (_req, res) => {
  if (busy)
    throw new ServiceError("응답이 끝날 때까지 기다려 주세요.", "busy", 409);
  match = null;
  await store.saveMatch(null);
  res.json({ ok: true });
});
app.post("/api/memory/clear", async (req, res) => {
  if (busy || (match && match.stage !== "finished"))
    throw new ServiceError(
      "진행 중인 판을 끝낸 뒤 기록을 초기화해 주세요.",
      "active_match",
      409,
    );
  const mode = modeOf(req.body.mode);
  await store.clear(mode);
  if (match?.mode === mode) {
    match = null;
    await store.saveMatch(null);
  }
  res.json({ ok: true });
});
app.post("/api/usage/recheck", (_req, res) => {
  planPaused = false;
  res.json({ ok: true });
});
app.get("/api/memory/export", async (req, res) => {
  const mode = modeOf(req.query.mode);
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="tell-' + mode + '-records.json"',
  );
  res.json({ version: 1, mode, rounds: await store.read(mode) });
});
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API 경로를 찾을 수 없습니다." });
});
if (production) {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(root, "dist", "index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const e = error as ServiceError;
    res
      .status(e.status || 400)
      .json({
        error: e.message || "처리할 수 없습니다.",
        code: e.code || "invalid_operation",
        requestId: e.requestId,
      });
  },
);
const port = Number(process.env.TELL_PORT || 4317);
const server = app.listen(port, "127.0.0.1");
server.on("listening", () => {
  const address = server.address();
  origin =
    "http://127.0.0.1:" +
    (typeof address === "object" && address ? address.port : port);
  console.log("TELL Rivals ready: " + origin);
  console.log("Local game data: " + dataDirectory);
});
server.on("error", (e) => {
  console.error(
    (e as NodeJS.ErrnoException).code === "EADDRINUSE"
      ? "포트가 사용 중입니다. TELL_PORT를 다른 포트로 지정해 주세요."
      : "로컬 서버를 시작하지 못했습니다.",
  );
  process.exit(1);
});
