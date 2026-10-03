import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENTS,
  createMatch,
  chooseOpening,
  chooseReply,
  openRound,
  finishMatch,
  extractTells,
  publicMatch,
  decide,
  type RecordEntry,
} from "../src/game/engine.js";
import { narrationInput, parseFramings } from "../src/game/provider.js";
export function train(): RecordEntry[] {
  const records: RecordEntry[] = [];
  for (let n = 1; n <= 4; n++) {
    const m = createMatch(records, "practice", n, true);
    openRound(m);
    chooseOpening(
      m,
      records,
      {
        approach: m.roles.you === "mafia" ? "accuse" : "observe",
        target: "nora",
      },
      null,
    );
    chooseReply(m, records, {
      reply: m.roles.you === "mafia" ? "switch" : "hold",
      target: "rook",
    });
    records.push(finishMatch(m, "nora"));
  }
  return records;
}
test("completed games alone establish role-conditioned tells; first citation is round five", () => {
  const history = train();
  assert.equal(history.filter((r) => r.humanRole === "mafia").length, 2);
  assert.equal(history.filter((r) => r.humanRole === "citizen").length, 2);
  assert.equal(extractTells(history.slice(0, 3)).length, 0);
  const tell = extractTells(history).find((t) => t.id === "firstAccuse")!;
  assert.equal(tell.mafia.hits, 2);
  assert.equal(tell.citizen.hits, 0);
  assert.equal(tell.mafiaRate, 0.75);
  assert.equal(tell.citizenRate, 0.25);
  const m = createMatch(history, "practice", 5, true);
  openRound(m);
  chooseOpening(m, history, { approach: "accuse", target: "nora" }, null);
  assert.equal(m.round, 5);
  const remembered = m.decisions.filter((d) => d.evidence);
  assert.equal(remembered.length, 2);
  for (const d of remembered) {
    assert.match(d.text, /마피아일 때 2\/2판, 시민일 때 0\/2판/);
    assert.deepEqual(d.evidence!.cites, [1, 2, 3, 4]);
    assert.ok(d.evidence!.delta > 0);
  }
});
test("same choice in both roles is not a tell", () => {
  const history = train().map((r) => ({
    ...r,
    features: {
      firstAccuse: true,
      selfDefend: false,
      switchTarget: false,
      followMajority: false,
    },
  }));
  assert.equal(extractTells(history).length, 0);
});
test("memory changes actual votes and can still be wrong", () => {
  const history = train();
  let flips = 0,
    incorrect = 0;
  for (let seed = 0; seed < 200; seed++) {
    const m = createMatch(history, "practice", seed, true);
    openRound(m);
    chooseOpening(m, history, { approach: "accuse", target: "nora" }, null);
    chooseReply(m, history, { reply: "switch", target: "rook" });
    for (const d of m.decisions.filter((d) => d.stage === 2)) {
      if (d.target !== d.withoutMemory) flips++;
      if (d.evidence && d.target === "you" && m.roles.you === "citizen")
        incorrect++;
      const values = Object.values(d.probabilities);
      assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-9);
      assert.ok(values.every((v) => v > 0 && v < 1));
    }
  }
  assert.ok(flips > 0);
  assert.ok(incorrect > 0);
});
test("memory off changes no votes and emits no remembered lines", () => {
  const history = train();
  const m = createMatch(history, "practice", 5, false);
  openRound(m);
  chooseOpening(m, history, { approach: "accuse", target: "nora" }, null);
  chooseReply(m, history, { reply: "switch", target: "rook" });
  for (const d of m.decisions) {
    assert.equal(d.evidence, null);
    assert.equal(d.target, d.withoutMemory);
    assert.deepEqual(d.probabilities, d.baseline);
    assert.doesNotMatch(d.text, /지난|기록|판이었/);
  }
});
test("fake tell reward requires precommitted plan, contrary role impression and a changed incorrect vote", () => {
  const history = train();
  let success = false;
  for (let seed = 0; seed < 500; seed++) {
    const m = createMatch(history, "practice", seed, true);
    if (m.roles.you !== "citizen") continue;
    openRound(m);
    chooseOpening(
      m,
      history,
      { approach: "accuse", target: "nora" },
      "firstAccuse",
    );
    chooseReply(m, history, { reply: "switch", target: "rook" });
    const r = finishMatch(m, "rook");
    if (r.deception?.success) {
      assert.ok(r.deception.matched);
      assert.ok(r.deception.changedVotes.length);
      for (const id of r.deception.changedVotes) {
        const d = r.decisions.find((d) => d.agentId === id)!;
        assert.equal(d.target, "you");
        assert.notEqual(d.withoutMemory, "you");
      }
      success = true;
      break;
    }
  }
  assert.ok(success);
  const m = createMatch(history, "practice", 8, true);
  openRound(m);
  chooseOpening(m, history, { approach: "accuse", target: "nora" }, null);
  chooseReply(m, history, { reply: "switch", target: "rook" });
  assert.equal(finishMatch(m, "rook").deception, null);
});
test("no hidden roles or seed reach UI / model; agent only knows its own role", () => {
  const history = train();
  const m = createMatch(history, "practice", 5, true);
  openRound(m);
  chooseOpening(m, history, { approach: "accuse", target: "nora" }, null);
  const view = publicMatch(m)!;
  assert.equal(view.roles, null);
  assert.ok(!("seed" in view));
  assert.ok(!("npcTargets" in view));
  const input = JSON.stringify(JSON.parse(narrationInput(m)[1].content));
  assert.ok(!input.includes("humanRole"));
  assert.ok(!input.includes("roles"));
  assert.ok(!input.includes("seed"));
  const clone = structuredClone(m);
  clone.roles.you = clone.roles.you === "mafia" ? "citizen" : "mafia";
  clone.roles.iris = clone.roles.iris === "mafia" ? "citizen" : "mafia";
  assert.deepEqual(
    decide(m, history, 1).find((d) => d.agentId === "nora"),
    decide(clone, history, 1).find((d) => d.agentId === "nora"),
  );
});
test("invalid, repeated and out-of-order selections are rejected", () => {
  const m = createMatch([], "practice", 1, true);
  assert.throws(() =>
    chooseOpening(m, [], { approach: "observe", target: "nora" }, null),
  );
  openRound(m);
  assert.throws(() =>
    chooseOpening(
      m,
      [],
      { approach: "observe", target: "nora" },
      "firstAccuse",
    ),
  );
  chooseOpening(m, [], { approach: "observe", target: "nora" }, null);
  assert.throws(() =>
    chooseOpening(m, [], { approach: "accuse", target: "rook" }, null),
  );
  assert.throws(() => chooseReply(m, [], { reply: "switch", target: "nora" }));
  chooseReply(m, [], { reply: "hold", target: "nora" });
  finishMatch(m, "nora");
  assert.throws(() => finishMatch(m, "nora"));
});
test("LLM free-text and fabricated memory cannot reach the renderer", () => {
  const valid = AGENTS.map((a) => ({ agentId: a.id, framing: "cautious" }));
  assert.equal(parseFramings(JSON.stringify(valid)).length, 4);
  assert.throws(() =>
    parseFramings(
      JSON.stringify(
        valid.map((a) => ({ ...a, text: "지난 99판 모두 마피아였어" })),
      ),
    ),
  );
  assert.throws(() =>
    parseFramings(JSON.stringify([...valid.slice(0, 3), valid[0]])),
  );
  assert.throws(() => parseFramings("당신은 지난 판에 마피아였어"));
});
