import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { LocalTellStore, ProtectedFile } from "../server/storage.js";
import {
  createMatch,
  openRound,
  chooseOpening,
  chooseReply,
  finishMatch,
} from "../src/game/engine.js";
const base = path.resolve(".local");
async function isolated(work: (root: string) => Promise<void>) {
  const root = path.resolve(base, "test-" + randomUUID());
  assert.ok(root.startsWith(base + path.sep));
  await mkdir(root, { recursive: true });
  try {
    await work(root);
  } finally {
    assert.ok(path.resolve(root).startsWith(base + path.sep));
    await rm(root, { recursive: true, force: true });
  }
}
test("mode separation, atomic persistence and duplicate protection", async () =>
  isolated(async (root) => {
    const store = new LocalTellStore(root);
    const m = createMatch([], "practice", 1, true);
    openRound(m);
    chooseOpening(m, [], { approach: "observe", target: "nora" }, null);
    chooseReply(m, [], { reply: "hold", target: "nora" });
    const record = finishMatch(m, "nora");
    await store.append("practice", record);
    assert.equal((await store.read("practice")).length, 1);
    assert.equal((await store.read("chatgpt")).length, 0);
    await assert.rejects(() => store.append("practice", record));
    await store.saveMatch(m);
    assert.deepEqual(await store.loadMatch(), m);
    await store.clear("practice");
    assert.equal((await store.read("practice")).length, 0);
  }));
test("corrupted or missing choices are preserved and never presented as evidence", async () =>
  isolated(async (root) => {
    await mkdir(path.join(root, "game"));
    const file = path.join(root, "game", "practice.json");
    await writeFile(file, "not json");
    await assert.rejects(() => new LocalTellStore(root).read("practice"));
    assert.equal(await readFile(file, "utf8"), "not json");
    const incomplete = {
      version: 1,
      rounds: [
        { mode: "practice", round: 1, humanRole: "citizen", features: {} },
      ],
    };
    await writeFile(file, JSON.stringify(incomplete));
    await assert.rejects(() => new LocalTellStore(root).read("practice"));
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), incomplete);
  }));
test("credential storage roundtrip is protected on Windows", async () =>
  isolated(async (root) => {
    const filename = path.join(root, "test.credential");
    const file = new ProtectedFile<{ accessToken: string }>(filename);
    const value = { accessToken: "test-only-" + randomUUID() };
    await file.save(value);
    assert.deepEqual(await file.load(), value);
    if (process.platform === "win32")
      assert.ok(!(await readFile(filename)).includes(value.accessToken));
  }));
