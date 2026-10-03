import { AGENTS, type AgentId, type Framing, type Match } from "./engine.js";
export type FramingResult = { agentId: AgentId; framing: Framing }[];
export interface AiProvider {
  narrate(match: Match, onToken?: () => void): Promise<FramingResult>;
}
// No raw model text is shown. The model picks tone; code binds every remembered fact to verified records.
export function parseFramings(text: string): FramingResult {
  const raw = JSON.parse(
    text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""),
  );
  if (!Array.isArray(raw) || raw.length !== 4)
    throw new Error("대사 형식을 검증하지 못했습니다.");
  const seen = new Set<string>();
  for (const item of raw) {
    if (
      !item ||
      !AGENTS.some((a) => a.id === item.agentId) ||
      seen.has(item.agentId) ||
      !["direct", "cautious", "playful"].includes(item.framing) ||
      Object.keys(item).some((k) => !["agentId", "framing"].includes(k))
    )
      throw new Error("근거 밖 응답을 차단했습니다.");
    seen.add(item.agentId);
  }
  return raw;
}
export function narrationInput(match: Match) {
  const stage = match.stage === "reply" ? 1 : 2;
  const facts = match.decisions
    .filter((d) => d.stage === stage)
    .map((d) => ({
      id: d.agentId,
      personality: AGENTS.find((a) => a.id === d.agentId)!.traits,
      target: d.target,
      evidence: d.evidence
        ? {
            feature: d.evidence.tell.label,
            observed: d.evidence.value,
            mafia: {
              hits: d.evidence.tell.mafia.hits,
              n: d.evidence.tell.mafia.n,
              rounds: d.evidence.tell.mafia.rounds.slice(-6),
            },
            citizen: {
              hits: d.evidence.tell.citizen.hits,
              n: d.evidence.tell.citizen.n,
              rounds: d.evidence.tell.citizen.rounds.slice(-6),
            },
            delta: Number(d.evidence.delta.toFixed(3)),
          }
        : null,
    }));
  return [
    {
      role: "developer" as const,
      content:
        "You direct the tone of four Korean social-deduction rivals. Decisions and historical facts are already computed. Return ONLY a JSON array of exactly four objects with keys agentId and framing. agentId: nora,rook,sol,iris. framing: direct,cautious,playful. Respect each personality. Never add dialogue, roles, memories, explanations, or other fields. Keep the response under 100 words.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        round: match.round,
        publicHistory: {
          opening: match.opening,
          response: match.response,
          priorTurn: match.decisions
            .filter((d) => d.stage < stage)
            .map((d) => ({ agent: d.agentId, target: d.target, text: d.text })),
        },
        current: facts,
      }),
    },
  ];
}
