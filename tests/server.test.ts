import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { request } from "node:http";
test(
  "loopback API: host / CSRF protection, full playable flow, no role leak, persisted restart and mode isolation",
  { timeout: 30000 },
  async () => {
    const base = path.resolve(".local");
    const dir = path.resolve(base, "api-test-" + randomUUID());
    assert.ok(dir.startsWith(base + path.sep));
    await mkdir(dir, { recursive: true });
    let child: ReturnType<typeof spawn> | null = null;
    async function launch() {
      child = spawn(
        process.execPath,
        ["--import", "tsx", "server/index.ts", "--production"],
        {
          cwd: process.cwd(),
          env: { ...process.env, TELL_DATA_DIR: dir, TELL_PORT: "0" },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      return new Promise<string>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
          () => reject(new Error("server boot timeout")),
          10000,
        );
        child!.stdout!.on("data", (b) => {
          output += b;
          const match = output.match(/ready: (http:\/\/127\.0\.0\.1:\d+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
        child!.on("exit", (code) => {
          clearTimeout(timer);
          if (code) reject(new Error("server exited " + code));
        });
      });
    }
    async function stop() {
      if (!child) return;
      const c = child;
      child = null;
      const exited = new Promise<void>((resolve) =>
        c.once("exit", () => resolve()),
      );
      c.kill();
      await exited;
    }
    try {
      let origin = await launch();
      let cookie = "";
      let csrf = "";
      async function state() {
        const r = await fetch(origin + "/api/state?mode=practice");
        cookie = r.headers.get("set-cookie")!.split(";")[0];
        const s = await r.json();
        csrf = s.csrf;
        return s;
      }
      async function post(
        route: string,
        body: unknown,
        headers: Record<string, string> = {},
      ) {
        return fetch(origin + route, {
          method: "POST",
          headers: {
            cookie,
            "Content-Type": "application/json",
            "X-Tell-CSRF": csrf,
            ...headers,
          },
          body: JSON.stringify(body),
        });
      }
      let s = await state();
      assert.equal(s.history.length, 0);
      const wrongHostStatus = await new Promise<number | undefined>(
        (resolve, reject) => {
          const req = request(
            origin + "/api/health",
            {
              headers: {
                Host: new URL(origin).host.replace("127.0.0.1", "localhost"),
              },
            },
            (res) => {
              res.resume();
              resolve(res.statusCode);
            },
          );
          req.on("error", reject);
          req.end();
        },
      );
      assert.equal(wrongHostStatus, 403);
      assert.equal(
        (
          await post(
            "/api/game/start",
            { mode: "practice" },
            { "X-Tell-CSRF": "wrong" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await post(
            "/api/game/start",
            { mode: "practice" },
            { Origin: "https://untrusted.example" },
          )
        ).status,
        403,
      );
      assert.equal(
        (await post("/api/game/start", { mode: "chatgpt", model: "fake" }))
          .status,
        401,
      );
      const login = await (await post("/api/auth/start", {})).json();
      const url = new URL(login.url);
      assert.equal(url.origin, "https://auth.openai.com");
      assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
      assert.equal(
        url.searchParams.get("redirect_uri"),
        origin + "/auth/callback",
      );
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.ok(
        url.searchParams.get("ext_agent_host_id")!.startsWith("urn:uuid:"),
      );
      assert.ok(
        url.searchParams.get("scope")!.includes("chatgpt.tokens.use.direct"),
      );
      const denied = await fetch(
        origin + "/auth/callback?state=forged&code=forged",
        { headers: { cookie }, redirect: "manual" },
      );
      assert.equal(denied.status, 302);
      assert.match(denied.headers.get("location")!, /invalid_state/);
      s = await (
        await post("/api/game/start", { mode: "practice", memoryEnabled: true })
      ).json();
      const id = s.match.id;
      assert.equal(s.match.roles, null);
      assert.equal(s.match.stage, "brief");
      assert.ok(!("seed" in s.match));
      s = await (
        await post("/api/game/action", { matchId: id, action: "reveal" })
      ).json();
      assert.equal(s.match.stage, "opening");
      s = await (
        await post("/api/game/action", {
          matchId: id,
          action: "opening",
          approach: "observe",
          target: "nora",
        })
      ).json();
      assert.equal(s.match.stage, "reply");
      assert.equal(s.match.decisions.length, 4);
      assert.equal(
        (
          await post("/api/game/action", {
            matchId: id,
            action: "opening",
            approach: "accuse",
            target: "rook",
          })
        ).status,
        400,
      );
      await stop();
      origin = await launch();
      s = await state();
      assert.equal(s.match.id, id);
      assert.equal(s.match.stage, "reply");
      s = await (
        await post("/api/game/action", {
          matchId: id,
          action: "reply",
          reply: "hold",
          target: "nora",
        })
      ).json();
      assert.equal(s.match.stage, "vote");
      s = await (
        await post("/api/game/action", {
          matchId: id,
          action: "vote",
          target: "nora",
        })
      ).json();
      assert.equal(s.match.stage, "finished");
      assert.equal(s.history.length, 1);
      assert.equal(
        Object.values(s.match.roles).filter((r) => r === "mafia").length,
        1,
      );
      assert.equal(s.match.record.metrics.length, 0);
      const live = await (
        await fetch(origin + "/api/state?mode=chatgpt", { headers: { cookie } })
      ).json();
      assert.equal(live.history.length, 0);
      assert.equal(
        (
          await post("/api/game/action", {
            matchId: id,
            action: "vote",
            target: "nora",
          })
        ).status,
        400,
      );
    } finally {
      await stop();
      assert.ok(path.resolve(dir).startsWith(base + path.sep));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
