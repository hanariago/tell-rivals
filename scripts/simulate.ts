import {
  createMatch,
  openRound,
  chooseOpening,
  chooseReply,
  finishMatch,
  extractTells,
  type RecordEntry,
} from "../src/game/engine.js";
import { mkdir, writeFile } from "node:fs/promises";
// Synthetic selections are an isolated test fixture, never imported into the user's memory store.
const history: RecordEntry[] = [];
for (let n = 1; n <= 4; n++) {
  const m = createMatch(history, "practice", n, true);
  openRound(m);
  chooseOpening(
    m,
    history,
    {
      approach: m.roles.you === "mafia" ? "accuse" : "observe",
      target: "nora",
    },
    null,
  );
  chooseReply(m, history, {
    reply: m.roles.you === "mafia" ? "switch" : "hold",
    target: "rook",
  });
  history.push(finishMatch(m, "nora"));
}
let voteFlips = 0,
  rememberedVotes = 0,
  wrongHumanVotes = 0,
  fakeTellRewards = 0,
  firstCitation: unknown = null,
  deceptionWitness: unknown = null;
for (let seed = 0; seed < 1000; seed++) {
  const m = createMatch(history, "practice", seed, true);
  openRound(m);
  chooseOpening(
    m,
    history,
    { approach: "accuse", target: "nora" },
    "firstAccuse",
  );
  chooseReply(m, history, { reply: "switch", target: "rook" });
  const record = finishMatch(m, "rook");
  for (const d of record.decisions) {
    if (d.evidence) rememberedVotes++;
    if (d.target !== d.withoutMemory) voteFlips++;
    if (
      d.evidence &&
      d.target === "you" &&
      m.roles.you === "citizen" &&
      m.roles[d.agentId] === "citizen"
    )
      wrongHumanVotes++;
  }
  if (record.deception?.success) {
    fakeTellRewards++;
    if (!deceptionWitness)
      deceptionWitness = {
        seed,
        role: m.roles.you,
        deception: record.deception,
        decisions: record.decisions
          .filter((d) => record.deception!.changedVotes.includes(d.agentId))
          .map((d) => ({
            agent: d.agentId,
            role: m.roles[d.agentId],
            target: d.target,
            withoutMemory: d.withoutMemory,
            text: d.text,
          })),
      };
  }
  if (
    !firstCitation &&
    record.decisions.some(
      (d) =>
        d.evidence && d.target === "you" && m.roles[d.agentId] === "citizen",
    )
  )
    firstCitation = {
      round: m.round,
      seed,
      role: m.roles.you,
      decisions: record.decisions
        .filter(
          (d) =>
            d.evidence &&
            d.target === "you" &&
            m.roles[d.agentId] === "citizen",
        )
        .map((d) => ({
          agent: d.agentId,
          role: m.roles[d.agentId],
          text: d.text,
          sourceRounds: d.evidence!.cites,
          withMemory: d.probabilities.you,
          withoutMemory: d.baseline.you,
        })),
    };
}
const result = {
  label: "SYNTHETIC OFFLINE TEST — NOT HUMAN PLAYTEST OR LIVE API",
  training: history.map((r) => ({
    round: r.round,
    role: r.humanRole,
    features: r.features,
  })),
  tells: extractTells(history).map((t) => ({
    feature: t.id,
    mafia: t.mafia,
    citizen: t.citizen,
  })),
  trials: 1000,
  voteDecisions: 4000,
  rememberedVotes,
  voteFlips,
  wrongHumanVotes,
  fakeTellRewards,
  firstCitation,
  deceptionWitness,
  api: {
    ttftMs: null,
    completionMs: null,
    averageTokens: null,
    reason: "Game-specific ChatGPT OAuth consent has not been completed.",
  },
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/simulation.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (voteFlips === 0 || fakeTellRewards === 0 || !firstCitation)
  process.exitCode = 1;
