export const AGENTS = [
  {
    id: "nora",
    name: "노라",
    tag: "분석가",
    focus: "첫 지목 · 결백 주장",
    color: "#a7c8ee",
    traits: "차분하게 표본을 세는 라이벌",
    interests: ["firstAccuse", "selfDefend"],
    sensitivity: 1.35,
  },
  {
    id: "rook",
    name: "루크",
    tag: "승부사",
    focus: "첫 지목 · 지목 변경",
    color: "#e9b78e",
    traits: "빠르게 걸고, 틀리면 웃는 라이벌",
    interests: ["firstAccuse", "switchTarget"],
    sensitivity: 1.1,
  },
  {
    id: "sol",
    name: "솔",
    tag: "중재자",
    focus: "결백 주장 · 다수 추종",
    color: "#a6c8a4",
    traits: "부드럽게 질문하고 끝까지 듣는 라이벌",
    interests: ["selfDefend", "followMajority"],
    sensitivity: 0.9,
  },
  {
    id: "iris",
    name: "이리스",
    tag: "관찰자",
    focus: "지목 변경 · 다수 추종",
    color: "#c4b6df",
    traits: "말보다 방향의 변화를 보는 라이벌",
    interests: ["switchTarget", "followMajority"],
    sensitivity: 1.4,
  },
] as const;
export type AgentId = (typeof AGENTS)[number]["id"];
export type PlayerId = AgentId | "you";
export type Role = "citizen" | "mafia";
export type Mode = "practice" | "chatgpt";
export type Feature =
  "firstAccuse" | "selfDefend" | "switchTarget" | "followMajority";
export type Features = Record<Feature, boolean>;
export type Approach = "accuse" | "observe" | "defend";
export type Reply = "hold" | "switch" | "follow";
export type Framing = "direct" | "cautious" | "playful";
export const FEATURE_LABELS: Record<Feature, string> = {
  firstAccuse: "먼저 지목하기",
  selfDefend: "먼저 결백 주장하기",
  switchTarget: "지목 바꾸기",
  followMajority: "다수의 지목 따르기",
};
export const IDS: PlayerId[] = ["you", ...AGENTS.map((a) => a.id)];
export const nameOf = (id: PlayerId) =>
  id === "you" ? "당신" : AGENTS.find((a) => a.id === id)!.name;
export const roleName = (role: Role) => (role === "mafia" ? "마피아" : "시민");
export const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
export function random(seed: number) {
  let x = seed >>> 0;
  return () => {
    x += 0x6d2b79f5;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Tell = {
  id: Feature;
  label: string;
  mafia: { hits: number; n: number; rounds: number[] };
  citizen: { hits: number; n: number; rounds: number[] };
  mafiaRate: number;
  citizenRate: number;
  confidence: number;
  favoredRole: Role;
  gap: number;
};
export type Evidence = {
  tell: Tell;
  value: boolean;
  logLikelihood: number;
  delta: number;
  cites: number[];
};
export type Decision = {
  agentId: AgentId;
  target: PlayerId;
  withoutMemory: PlayerId;
  probabilities: Partial<Record<PlayerId, number>>;
  baseline: Partial<Record<PlayerId, number>>;
  evidence: Evidence | null;
  framing: Framing;
  text: string;
  stage: 1 | 2;
};
export type Measurement = {
  kind: "turn" | "benchmark";
  mode: Mode;
  model: string | null;
  ttftMs: number | null;
  completionMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  completed: boolean;
  error?: string;
  requestId?: string;
  textBytes?: number;
};
export type RecordEntry = {
  round: number;
  mode: Mode;
  humanRole: Role;
  features: Features;
  won: boolean;
  elapsedMs: number;
  memoryEnabled: boolean;
  deception: {
    tellId: Feature;
    matched: boolean;
    changedVotes: AgentId[];
    success: boolean;
  } | null;
  decisions: Decision[];
  metrics: Measurement[];
};
export type Opening = { approach: Approach; target: AgentId };
export type ResponseChoice = { reply: Reply; target: AgentId };
export type Match = {
  id: string;
  round: number;
  mode: Mode;
  seed: number;
  roles: Record<PlayerId, Role>;
  clues: Record<PlayerId, number>;
  stage: "brief" | "opening" | "reply" | "vote" | "finished";
  startedAt: number;
  memoryEnabled: boolean;
  opening: Opening | null;
  response: ResponseChoice | null;
  features: Features;
  decisions: Decision[];
  votes: Partial<Record<PlayerId, PlayerId>>;
  eliminated: PlayerId | null;
  won: boolean | null;
  deceptionPlan: Feature | null;
  record: RecordEntry | null;
  metrics: Measurement[];
  aiError: string | null;
  localFallback: boolean;
  model: string | null;
  npcTargets: Record<AgentId, PlayerId>;
};
export function extractTells(history: RecordEntry[]): Tell[] {
  const mafia = history.filter((r) => r.humanRole === "mafia");
  const citizen = history.filter((r) => r.humanRole === "citizen");
  if (mafia.length < 2 || citizen.length < 2) return [];
  return (Object.keys(FEATURE_LABELS) as Feature[])
    .flatMap<Tell>((id) => {
      const m = mafia.filter((r) => r.features[id]);
      const c = citizen.filter((r) => r.features[id]);
      const mr = (m.length + 1) / (mafia.length + 2);
      const cr = (c.length + 1) / (citizen.length + 2);
      const gap = Math.abs(mr - cr);
      if (gap < 0.25) return [];
      return [
        {
          id,
          label: FEATURE_LABELS[id],
          mafia: {
            hits: m.length,
            n: mafia.length,
            rounds: mafia.map((r) => r.round),
          },
          citizen: {
            hits: c.length,
            n: citizen.length,
            rounds: citizen.map((r) => r.round),
          },
          mafiaRate: mr,
          citizenRate: cr,
          confidence: Math.min(0.85, history.length / (history.length + 4)),
          favoredRole: mr > cr ? "mafia" : "citizen",
          gap,
        },
      ];
    })
    .sort((a, b) => b.gap - a.gap);
}
export function createMatch(
  history: RecordEntry[],
  mode: Mode,
  seed: number,
  memoryEnabled: boolean,
  model: string | null = null,
): Match {
  const rng = random(seed);
  const round = history.length + 1;
  // Balanced two-game blocks accelerate honest role comparisons. Order within each block is random.
  const humanRole: Role =
    history.length % 2
      ? history.at(-1)!.humanRole === "mafia"
        ? "citizen"
        : "mafia"
      : rng() < 0.5
        ? "citizen"
        : "mafia";
  const mafia: PlayerId =
    humanRole === "mafia"
      ? "you"
      : AGENTS[Math.floor(rng() * AGENTS.length)].id;
  const roles = Object.fromEntries(
    IDS.map((id) => [id, id === mafia ? "mafia" : "citizen"]),
  ) as Record<PlayerId, Role>;
  // Public, noisy alibi evidence. No agent receives the hidden roles of other players.
  const clues = Object.fromEntries(
    IDS.map((id) => [
      id,
      clamp(rng() * 0.68 + (id === mafia ? 0.22 : 0.02), 0, 0.95),
    ]),
  ) as Record<PlayerId, number>;
  const npcTargets = Object.fromEntries(
    AGENTS.map((a) => {
      const candidates = IDS.filter((id) => id !== a.id);
      return [a.id, candidates[Math.floor(rng() * candidates.length)]];
    }),
  ) as Record<AgentId, PlayerId>;
  return {
    id: "round-" + round + "-" + seed,
    round,
    mode,
    seed,
    roles,
    clues,
    stage: "brief",
    startedAt: Date.now(),
    memoryEnabled,
    opening: null,
    response: null,
    features: {
      firstAccuse: false,
      selfDefend: false,
      switchTarget: false,
      followMajority: false,
    },
    decisions: [],
    votes: {},
    eliminated: null,
    won: null,
    deceptionPlan: null,
    record: null,
    metrics: [],
    aiError: null,
    localFallback: false,
    model,
    npcTargets,
  };
}
function pick(
  probabilities: Partial<Record<PlayerId, number>>,
  draw: number,
): PlayerId {
  let cumulative = 0;
  let last: PlayerId = "you";
  for (const id of IDS) {
    if (probabilities[id] === undefined) continue;
    last = id;
    cumulative += probabilities[id]!;
    if (draw < cumulative) return id;
  }
  return last;
}
function normalize(scores: Partial<Record<PlayerId, number>>) {
  const entries = Object.entries(scores) as [PlayerId, number][];
  const sum = entries.reduce((s, [, n]) => s + Math.exp(n), 0);
  return Object.fromEntries(
    entries.map(([id, n]) => [id, Math.exp(n) / sum]),
  ) as Partial<Record<PlayerId, number>>;
}
export function majorityTarget(match: Match): AgentId {
  const counts = Object.fromEntries(AGENTS.map((a) => [a.id, 0])) as Record<
    AgentId,
    number
  >;
  for (const d of match.decisions.filter((d) => d.stage === 1))
    if (d.target !== "you") counts[d.target]++;
  return AGENTS.reduce<AgentId>(
    (best, a) => (counts[a.id] > counts[best] ? a.id : best),
    AGENTS[0].id,
  );
}
export function decide(
  match: Match,
  history: RecordEntry[],
  stage: 1 | 2,
): Decision[] {
  const tells = match.memoryEnabled ? extractTells(history) : [];
  return AGENTS.map((agent, index) => {
    const rng = random(match.seed + stage * 1291 + index * 177);
    const scores: Partial<Record<PlayerId, number>> = {};
    for (const id of IDS.filter((id) => id !== agent.id)) {
      let score = match.clues[id] * 1.5 + rng() * 0.5;
      if (id === "you") {
        if (match.features.selfDefend) score += 0.2;
        if (match.features.firstAccuse) score += 0.1;
        if (stage === 2 && match.features.switchTarget) score += 0.24;
      }
      if (id === match.opening?.target && match.opening.approach === "accuse")
        score += 0.24;
      if (stage === 2 && id === match.response?.target) score += 0.25;
      // The mafia knows only its own role and tries to redirect suspicion. It cannot read other roles.
      if (match.roles[agent.id] === "mafia" && id === "you") score += 0.12;
      scores[id] = score;
    }
    const baseline = normalize(scores);
    const eligible = tells.filter(
      (t) =>
        (agent.interests as readonly string[]).includes(t.id) &&
        (stage === 2 || !["switchTarget", "followMajority"].includes(t.id)),
    );
    // Correlated tells are not double-counted: one strongest eligible observation per rival per turn.
    const t = eligible.sort((a, b) => b.gap - a.gap)[0];
    let evidence: Evidence | null = null;
    if (t) {
      const value = match.features[t.id];
      const m = value ? t.mafiaRate : 1 - t.mafiaRate;
      const c = value ? t.citizenRate : 1 - t.citizenRate;
      const logLikelihood = clamp(
        Math.log(m / c) * t.confidence * agent.sensitivity,
        -1.4,
        1.4,
      );
      scores.you! += logLikelihood;
      const after = normalize(scores);
      evidence = {
        tell: t,
        value,
        logLikelihood,
        delta: after.you! - baseline.you!,
        cites: [...t.mafia.rounds, ...t.citizen.rounds].sort((a, b) => a - b),
      };
    }
    const probabilities = normalize(scores);
    const draw = rng();
    const target = pick(probabilities, draw);
    const withoutMemory = pick(baseline, draw);
    const decision: Decision = {
      agentId: agent.id,
      target,
      withoutMemory,
      probabilities,
      baseline,
      evidence,
      framing: index === 1 ? "playful" : "cautious",
      text: "",
      stage,
    };
    decision.text = renderStatement(decision);
    return decision;
  });
}
export function renderStatement(d: Decision): string {
  const voices: Record<AgentId, Record<Framing, string>> = {
    nora: {
      direct: nameOf(d.target) + "에게 한 표. 근거를 따져 봤어.",
      cautious:
        "아직 단정하진 않지만, " + nameOf(d.target) + " 쪽이 마음에 걸려.",
      playful:
        "숫자가 늘 정답은 아니지. 이번엔 " + nameOf(d.target) + " 쪽이야.",
    },
    rook: {
      direct: "결정했어. " + nameOf(d.target) + "에게 걸겠어.",
      cautious:
        "이번엔 " + nameOf(d.target) + " 쪽에 걸어볼게. 틀리면 인정하지.",
      playful: "자, 판을 흔들어 볼까? 내 표는 " + nameOf(d.target) + "에게.",
    },
    sol: {
      direct: "내 표는 " + nameOf(d.target) + "에게. 이유는 함께 보자.",
      cautious:
        nameOf(d.target) + "의 이야기를 더 듣고 싶어. 지금은 그쪽을 의심해.",
      playful:
        "모두를 믿고 싶지만, 한 표는 골라야겠지. " + nameOf(d.target) + "에게.",
    },
    iris: {
      direct: "흐름을 따라가 봤어. " + nameOf(d.target) + "에게 한 표.",
      cautious:
        "내 시선은 " + nameOf(d.target) + "에게 갔어. 아직 단정하진 않을게.",
      playful:
        "이번 한 표로 흐름이 바뀔까? 내 표는 " + nameOf(d.target) + "에게.",
    },
  };
  const lead = voices[d.agentId][d.framing];
  if (!d.evidence)
    return lead + " 지금 공개된 알리바이와 지목을 보고 판단했어.";
  const { tell: t, value, delta } = d.evidence;
  const mh = value ? t.mafia.hits : t.mafia.n - t.mafia.hits;
  const ch = value ? t.citizen.hits : t.citizen.n - t.citizen.hits;
  const memory =
    " 당신이 ‘" +
    t.label +
    "’" +
    (value ? "를 선택한 건" : "를 하지 않은 건") +
    " 마피아일 때 " +
    mh +
    "/" +
    t.mafia.n +
    "판, 시민일 때 " +
    ch +
    "/" +
    t.citizen.n +
    "판이었어.";
  return (
    lead +
    memory +
    (delta > 0
      ? " 그래서 당신을 조금 더 의심해. 이번엔 다를 수도 있지."
      : " 그래서 당신의 의심은 조금 낮췄어. 습관이 정답은 아니니까.")
  );
}
export function applyFramings(
  match: Match,
  framings: { agentId: AgentId; framing: Framing }[],
) {
  const stage = match.stage === "reply" ? 1 : 2;
  for (const d of match.decisions.filter((d) => d.stage === stage)) {
    const f = framings.find((f) => f.agentId === d.agentId);
    if (f) d.framing = f.framing;
    d.text = renderStatement(d);
  }
}
export function openRound(match: Match) {
  if (match.stage !== "brief") throw new Error("잘못된 턴입니다.");
  match.stage = "opening";
}
export function chooseOpening(
  match: Match,
  history: RecordEntry[],
  choice: Opening,
  plan: Feature | null,
) {
  if (match.stage !== "opening") throw new Error("이미 처리한 선택입니다.");
  if (
    !["accuse", "observe", "defend"].includes(choice.approach) ||
    !AGENTS.some((a) => a.id === choice.target)
  )
    throw new Error("선택지를 확인해 주세요.");
  if (
    plan &&
    (!match.memoryEnabled || !extractTells(history).some((t) => t.id === plan))
  )
    throw new Error("기록에 없는 텔입니다.");
  match.deceptionPlan = plan;
  match.opening = choice;
  match.features.firstAccuse = choice.approach === "accuse";
  match.features.selfDefend = choice.approach === "defend";
  match.decisions = decide(match, history, 1);
  match.stage = "reply";
}
export function chooseReply(
  match: Match,
  history: RecordEntry[],
  choice: ResponseChoice,
) {
  if (match.stage !== "reply" || !match.opening)
    throw new Error("잘못된 턴입니다.");
  if (
    !["hold", "switch", "follow"].includes(choice.reply) ||
    !AGENTS.some((a) => a.id === choice.target)
  )
    throw new Error("선택지를 확인해 주세요.");
  const target =
    choice.reply === "hold"
      ? match.opening.target
      : choice.reply === "follow"
        ? majorityTarget(match)
        : choice.target;
  if (choice.reply === "switch" && target === match.opening.target)
    throw new Error("다른 사람을 지목해 주세요.");
  match.response = { reply: choice.reply, target };
  match.features.switchTarget = target !== match.opening.target;
  match.features.followMajority = choice.reply === "follow";
  match.decisions.push(...decide(match, history, 2));
  match.stage = "vote";
}
export function finishMatch(match: Match, target: AgentId): RecordEntry {
  if (match.stage !== "vote" || !AGENTS.some((a) => a.id === target))
    throw new Error("잘못된 투표입니다.");
  const final = match.decisions.filter((d) => d.stage === 2);
  match.votes.you = target;
  final.forEach((d) => {
    match.votes[d.agentId] = d.target;
  });
  const tally = IDS.map((id) => ({
    id,
    count: Object.values(match.votes).filter((v) => v === id).length,
  })).sort((a, b) => b.count - a.count);
  match.eliminated = tally[0].count > tally[1].count ? tally[0].id : null;
  const caught =
    match.eliminated !== null && match.roles[match.eliminated] === "mafia";
  match.won = match.roles.you === "mafia" ? !caught : caught;
  match.stage = "finished";
  let deception: RecordEntry["deception"] = null;
  if (match.deceptionPlan) {
    const relevant = final.filter(
      (d) => d.evidence?.tell.id === match.deceptionPlan,
    );
    const expectedRole =
      relevant[0]?.evidence && relevant[0].evidence!.logLikelihood > 0
        ? "mafia"
        : "citizen";
    const matched =
      relevant.length > 0 &&
      expectedRole !== match.roles.you &&
      relevant.some((d) => Math.abs(d.evidence!.delta) > 0.025);
    const changedVotes = relevant
      .filter(
        (d) =>
          match.roles[d.agentId] === "citizen" &&
          d.target !== d.withoutMemory &&
          ((match.roles.you === "mafia" &&
            d.target !== "you" &&
            d.withoutMemory === "you") ||
            (match.roles.you === "citizen" &&
              d.target === "you" &&
              d.withoutMemory !== "you")),
      )
      .map((d) => d.agentId);
    deception = {
      tellId: match.deceptionPlan,
      matched: Boolean(matched),
      changedVotes,
      success: Boolean(matched && changedVotes.length),
    };
  }
  match.record = {
    round: match.round,
    mode: match.mode,
    humanRole: match.roles.you,
    features: { ...match.features },
    won: match.won,
    elapsedMs: Date.now() - match.startedAt,
    memoryEnabled: match.memoryEnabled,
    deception,
    decisions: final,
    metrics: [...match.metrics],
  };
  return match.record;
}
export function publicMatch(match: Match | null) {
  if (!match) return null;
  return {
    id: match.id,
    round: match.round,
    mode: match.mode,
    role: match.roles.you,
    roles: match.stage === "finished" ? match.roles : null,
    clues: match.clues,
    stage: match.stage,
    memoryEnabled: match.memoryEnabled,
    opening: match.opening,
    response: match.response,
    features: match.features,
    majorityTarget: majorityTarget(match),
    decisions: match.decisions.map((d) => ({
      agentId: d.agentId,
      target: d.target,
      text: d.text,
      stage: d.stage,
      evidence: d.evidence
        ? {
            label: d.evidence.tell.label,
            cites: d.evidence.cites,
            delta: d.evidence.delta,
          }
        : null,
    })),
    votes: match.votes,
    eliminated: match.eliminated,
    won: match.won,
    record: match.record,
    metrics: match.metrics,
    aiError: match.aiError,
    localFallback: match.localFallback,
    model: match.model,
  };
}
export type PublicMatch = NonNullable<ReturnType<typeof publicMatch>>;
