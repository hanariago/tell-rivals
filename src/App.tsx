import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Fingerprint,
  CircleDot,
  BookOpen,
  SlidersHorizontal,
  ShieldCheck,
  ChevronRight,
  Clock3,
  Zap,
  X,
  Eye,
  Crosshair,
  Check,
  Download,
  RotateCcw,
  Target,
  Sparkles,
  Users,
  BarChart3,
  LogOut,
  AlertTriangle,
  MoveUpRight,
} from "lucide-react";
import {
  AGENTS,
  FEATURE_LABELS,
  nameOf,
  roleName,
  type Mode,
  type AgentId,
  type Feature,
  type Approach,
  type Reply,
  type PublicMatch,
  type RecordEntry,
  type Tell,
  type Measurement,
} from "./game/engine.js";
type Page = "play" | "memory" | "usage" | "settings";
type State = {
  testMode: boolean;
  csrf: string;
  mode: Mode;
  auth: {
    activeId: string | null;
    connected: boolean;
    sharing: boolean;
    profiles: {
      id: string;
      label: string;
      connected: boolean;
      sharing: boolean;
      needsWelcome: boolean;
    }[];
  };
  history: RecordEntry[];
  tells: Tell[];
  match: PublicMatch | null;
  benchmark: Measurement | null;
  catalog: { slug: string; display_name: string }[];
  planPaused: boolean;
  stats: {
    rounds: number;
    wins: number;
    points: number;
    roleSamples: { citizen: number; mafia: number };
    averageMs: number | null;
    averageTokens: number | null;
    measuredCalls: number;
    unknownUsageCalls: number;
    totalTokens: number;
    realCalls: number;
  };
};
const usageUrl = "https://chatgpt.com/settings/usage";
const ms = (n: number | null) =>
  n === null ? "미측정" : (n / 1000).toFixed(2) + "초";
const pct = (n: number) => (n * 100).toFixed(0) + "%";
function Portrait({ id, small = false }: { id: AgentId; small?: boolean }) {
  return (
    <img
      className={small ? "portrait small" : "portrait"}
      src={"/assets/" + id + ".svg"}
      alt={AGENTS.find((a) => a.id === id)!.name + "의 초상"}
    />
  );
}
function ChatGPTButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="chatgpt-button" onClick={onClick}>
      <img src="/assets/chatgpt-logo-white.svg" alt="" />
      Continue with ChatGPT
    </button>
  );
}
export default function App() {
  const [mode, setMode] = useState<Mode>(
    new URLSearchParams(location.search).has("connected")
      ? "chatgpt"
      : sessionStorage.getItem("tell-mode") === "chatgpt"
        ? "chatgpt"
        : "practice",
  );
  const [state, setState] = useState<State | null>(null);
  const [page, setPage] = useState<Page>("play");
  const [model, setModel] = useState("");
  const [memory, setMemory] = useState(true);
  const [target, setTarget] = useState<AgentId | null>(null);
  const [approach, setApproach] = useState<Approach>("observe");
  const [reply, setReply] = useState<Reply>("hold");
  const [plan, setPlan] = useState<Feature | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"rules" | "delete" | null>(null);
  const [hideResult, setHideResult] = useState(false);
  const modelAttempt = useRef<string | null>(null);
  const csrf = useRef("");
  async function api(url: string, body?: unknown) {
    const r = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-Tell-CSRF": csrf.current },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok)
      throw new Error(data.error + (data.code ? " [" + data.code + "]" : ""));
    return data;
  }
  async function refresh(nextMode: Mode = mode) {
    const data: State = await api("/api/state?mode=" + nextMode);
    csrf.current = data.csrf;
    setState(data);
    if (!model && data.catalog.length) setModel(data.catalog[0].slug);
    return data;
  }
  async function run(work: () => Promise<void>, message = "처리 중") {
    setBusy(true);
    setBusyText(message);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    sessionStorage.setItem("tell-mode", mode);
    setState(null);
    setTarget(null);
    setPlan(null);
    setHideResult(false);
    refresh(mode).catch((e) => setError(e.message));
  }, [mode]);
  useEffect(() => {
    const errorCode = new URLSearchParams(location.search).get("auth_error");
    if (errorCode)
      setError("로그인을 완료하지 못했습니다. (" + errorCode + ")");
    if (location.search) history.replaceState(null, "", location.pathname);
  }, []);
  useEffect(() => {
    if (
      state?.auth.sharing &&
      state.auth.activeId &&
      modelAttempt.current !== state.auth.activeId
    ) {
      modelAttempt.current = state.auth.activeId;
      loadModels();
    }
  }, [state?.auth.activeId, state?.auth.sharing]);
  useEffect(() => {
    if (
      state?.match &&
      state.match.stage !== "finished" &&
      state.match.mode !== mode
    )
      setMode(state.match.mode);
  }, [state?.match?.mode]);
  async function loadModels() {
    await run(async () => {
      const data = await api("/api/models", {});
      setModel(data.models[0]?.slug || "");
      await refresh();
    }, "계정에서 사용할 수 있는 모델을 확인 중");
  }
  async function signIn(accountId?: string, consent = false) {
    await run(async () => {
      const data = await api("/api/auth/start", { accountId, consent });
      location.assign(data.url);
    }, "ChatGPT 로그인으로 이동 중");
  }
  async function start() {
    setTarget(null);
    setPlan(null);
    setApproach("observe");
    setReply("hold");
    setHideResult(false);
    await run(async () => {
      setState(
        await api("/api/game/start", { mode, model, memoryEnabled: memory }),
      );
    }, "테이블을 준비하는 중");
  }
  async function action(
    actionName: string,
    extra: Record<string, unknown> = {},
  ) {
    if (!state?.match) return;
    await run(
      async () => {
        const data = await api("/api/game/action", {
          matchId: state.match!.id,
          action: actionName,
          ...extra,
        });
        setState(data);
      },
      mode === "chatgpt" && ["opening", "reply"].includes(actionName)
        ? "네 라이벌이 당신의 선택을 읽는 중"
        : "다음 수를 준비하는 중",
    );
  }
  if (!state)
    return (
      <div className="loading-app">
        <img src="/assets/mark.svg" alt="" />
        <p>TELL 테이블을 준비하고 있습니다.</p>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  const current = state.match;
  const playing = current && current.stage !== "finished";
  const result = current?.stage === "finished" && !hideResult;
  const activeProfile = state.auth.profiles.find(
    (p) => p.id === state.auth.activeId,
  );
  const welcome = activeProfile?.needsWelcome;
  const navigation: { id: Page; label: string; icon: typeof CircleDot }[] = [
    { id: "play", label: "플레이", icon: CircleDot },
    { id: "memory", label: "라이벌의 노트", icon: BookOpen },
    { id: "usage", label: "플레이 기록", icon: BarChart3 },
    { id: "settings", label: "설정", icon: SlidersHorizontal },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="TELL 홈">
          <img src="/assets/mark.svg" alt="" />
          <span>
            TELL<span className="brand-dot">.</span>
            <small>THEY REMEMBER YOU</small>
          </span>
        </a>
        <div className="nav-label">YOUR NEXT MOVE</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={"nav-item " + (page === n.id ? "active" : "")}
              aria-label={n.label}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.id === "memory" && state.tells.length > 0 && (
                <b className="nav-count">{state.tells.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-symbol">
            <Fingerprint size={25} />
          </div>
          <strong>라이벌은 기억합니다.</strong>
          <p>
            당신의 다음 수는
            <br />
            지난 수와 같을까요?
          </p>
          <div className="mini-stats">
            <span>
              <b>{String(state.stats.rounds).padStart(2, "0")}</b>플레이한 판
            </span>
            <span>
              <b>{String(state.tells.length).padStart(2, "0")}</b>발견된 텔
            </span>
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-dot" />
            기억은 이 기기에
          </div>
          <button className="help-link" onClick={() => setModal("rules")}>
            게임 방법 <ArrowUpRight size={14} />
          </button>
          <small>
            LOCAL EDITION <span>v0.1</span>
          </small>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            TELL <ChevronRight size={12} />
            <span>{navigation.find((n) => n.id === page)!.label}</span>
          </div>
          <div className="topbar-right">
            <span className="mode-chip">
              <span className="status-dot" />
              {state.testMode
                ? "QA 테스트 저장소"
                : mode === "practice"
                  ? "연습 · 로컬 규칙 AI"
                  : "ChatGPT 모드"}
            </span>
            <button
              className="icon-button"
              title="설정"
              aria-label="설정 열기"
              onClick={() => setPage("settings")}
            >
              <SlidersHorizontal size={17} />
            </button>
            <div className="user-mark">Y</div>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <button aria-label="오류 안내 닫기" onClick={() => setError("")}>
              <X size={17} />
            </button>
          </div>
        )}
        {page === "play" && !playing && !result && (
          <div className="lobby">
            <div className="hero-copy">
              <div className="eyebrow">
                <span /> A GAME OF SECOND GUESSES
              </div>
              <h1>
                당신의 습관이,
                <br />
                다음 판의 <em>단서</em>가 된다.
              </h1>
              <p>
                네 명의 AI 라이벌. 다섯 개의 의심.
                <br />
                그들은 당신을 읽고, 당신은 읽힌 자신을 속입니다.
              </p>
              <div className="hero-meta">
                <span>
                  <Users size={15} /> 5인 테이블
                </span>
                <i />
                <span>
                  <Clock3 size={15} /> 목표 1–3분 / 판
                </span>
                <i />
                <span>
                  <Crosshair size={15} /> 클릭으로만 플레이
                </span>
              </div>
            </div>
            <div className="table-section">
              <div className="section-label">
                <span>
                  <span className="pulse-dot" />
                  오늘의 테이블
                </span>
                <small>FOUR MINDS. ONE SECRET.</small>
              </div>
              <div className="rivals-row">
                {AGENTS.map((a, i) => (
                  <div
                    key={a.id}
                    className="rival-lobby"
                    style={{ "--accent": a.color } as React.CSSProperties}
                  >
                    <div className="rival-art">
                      <span className="seat-number">0{i + 1}</span>
                      <Portrait id={a.id} />
                      <span className="rival-tag">{a.tag}</span>
                    </div>
                    <div className="rival-description">
                      <h3>
                        {a.name}
                        <span>
                          <span className="status-dot" />
                          준비
                        </span>
                      </h3>
                      <p>{a.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="lobby-bottom">
              <div className="join-card">
                <div>
                  <div className="eyebrow small-label">
                    YOUR SEAT IS WAITING
                  </div>
                  <h2>
                    {playing ? "진행 중인 테이블" : "이번에는 어떤 당신일까요?"}
                  </h2>
                  <p>
                    {state.stats.rounds === 0
                      ? "첫 판은 탐색. 판이 쌓이면, 습관이 읽히기 시작합니다."
                      : state.tells.length
                        ? "라이벌이 " +
                          state.tells.length +
                          "개의 습관을 기억합니다. 다음 수를 바꿔 보세요."
                        : "시민·마피아 각각 두 판부터 역할에 따른 차이를 찾습니다."}
                  </p>
                </div>
                <div className="join-actions">
                  {mode === "chatgpt" && !state.auth.sharing ? (
                    <ChatGPTButton onClick={() => signIn(activeProfile?.id)} />
                  ) : (
                    <button
                      className="primary-button"
                      onClick={start}
                      disabled={
                        mode === "chatgpt" && (!model || state.planPaused)
                      }
                    >
                      테이블에 앉기 <ArrowRight size={18} />
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() =>
                      setMode(mode === "practice" ? "chatgpt" : "practice")
                    }
                  >
                    {mode === "practice"
                      ? "내 ChatGPT 플랜으로 플레이"
                      : "로그인 없이 연습하기"}{" "}
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              </div>
              <div className="promise-card">
                <Fingerprint size={28} />
                <h3>말투보다, 선택.</h3>
                <p>
                  역할에 따라 달라지는 행동만
                  <br />
                  라이벌의 단서가 됩니다.
                </p>
                <button onClick={() => setPage("memory")}>
                  내 텔 살펴보기 <MoveUpRight size={13} />
                </button>
              </div>
            </div>
            <div className="lobby-footer">
              <ShieldCheck size={14} />
              <span>연습과 ChatGPT 기록은 각각 저장됩니다.</span>
              <span className="right">기억을 끄고 비교할 수도 있습니다.</span>
            </div>
          </div>
        )}
        {page === "play" && playing && (
          <div className="game-screen">
            <div className="game-heading">
              <div>
                <div className="eyebrow">
                  ROUND {String(current.round).padStart(2, "0")} · THE READING
                  ROOM
                </div>
                <h2>
                  한 명의 마피아.
                  <br className="mobile-only" /> 이번엔 누구일까요?
                </h2>
              </div>
              <div className={"role-pill " + current.role}>
                <span>{current.role === "mafia" ? "◆" : "◇"}</span> 당신은{" "}
                {roleName(current.role)}
                <small>
                  {current.role === "mafia"
                    ? "들키지 않고 살아남으세요"
                    : "마피아를 찾아내세요"}
                </small>
              </div>
            </div>
            <div className="round-steps">
              {["역할 확인", "첫 선택", "응수", "최종 투표"].map((s, i) => (
                <div
                  key={s}
                  className={
                    ["brief", "opening", "reply", "vote"].indexOf(
                      current.stage,
                    ) >= i
                      ? "reached"
                      : ""
                  }
                >
                  <span>{i + 1}</span>
                  {s}
                </div>
              ))}
              <small>기억 {current.memoryEnabled ? "ON" : "OFF"}</small>
            </div>
            <div className="game-layout">
              <div className="game-table">
                <div className="players-grid">
                  {AGENTS.map((a) => (
                    <button
                      key={a.id}
                      className={
                        "player-card " + (target === a.id ? "selected" : "")
                      }
                      onClick={() => setTarget(a.id)}
                      disabled={current.stage === "brief"}
                      style={{ "--accent": a.color } as React.CSSProperties}
                    >
                      <div className="player-art">
                        <Portrait id={a.id} />
                        {target === a.id && (
                          <span className="selected-mark">
                            <Check size={14} />
                          </span>
                        )}
                      </div>
                      <strong>
                        {a.name}
                        <small>{a.tag}</small>
                      </strong>
                      <div
                        className={
                          "clue " +
                          (current.clues[a.id] > 0.6 ? "uncertain" : "")
                        }
                      >
                        {current.clues[a.id] > 0.6
                          ? "엇갈린 알리바이"
                          : current.clues[a.id] > 0.3
                            ? "미확인 알리바이"
                            : "부분 확인된 알리바이"}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="your-alibi">
                  <Eye size={15} /> 당신의 공개 단서{" "}
                  <b>
                    {current.clues.you > 0.6
                      ? "엇갈린 알리바이"
                      : current.clues.you > 0.3
                        ? "미확인 알리바이"
                        : "부분 확인된 알리바이"}
                  </b>
                  <small>
                    알리바이는 불완전하며, 역할을 확정하지 않습니다.
                  </small>
                </div>
                <div className="conversation">
                  <div className="section-label">
                    <span>테이블의 목소리</span>
                    <small>공개 발언</small>
                  </div>
                  {current.decisions.length === 0 ? (
                    <div className="conversation-empty">
                      <CircleDot size={25} />
                      <p>당신의 첫 수를 기다립니다.</p>
                      <small>
                        먼저 지목할지, 지켜볼지. 작은 선택도 단서가 됩니다.
                      </small>
                    </div>
                  ) : (
                    current.decisions
                      .filter(
                        (d) => d.stage === (current.stage === "reply" ? 1 : 2),
                      )
                      .map((d) => (
                        <div className="speech" key={d.agentId + "-" + d.stage}>
                          <Portrait id={d.agentId} small />
                          <div>
                            <div className="speech-name">
                              {nameOf(d.agentId)}
                              {d.evidence && (
                                <span>
                                  <BookOpen size={11} /> 기억을 꺼냄
                                </span>
                              )}
                            </div>
                            <p>{d.text}</p>
                            {d.evidence && (
                              <div className="evidence-cites">
                                실제 기록{" "}
                                {d.evidence.cites.slice(-8).map((r) => (
                                  <button
                                    key={r}
                                    onClick={() => setPage("memory")}
                                  >
                                    #{r}
                                  </button>
                                ))}
                                <small>
                                  당신의 의심 {d.evidence.delta > 0 ? "+" : ""}
                                  {pct(d.evidence.delta)}
                                </small>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
              <aside className="action-panel">
                <div className="eyebrow">YOUR MOVE</div>
                {current.stage === "brief" ? (
                  <>
                    <h3>
                      당신의 역할을
                      <br />
                      확인해 주세요.
                    </h3>
                    <div className={"secret-card " + current.role}>
                      <span>{current.role === "mafia" ? "◆" : "◇"}</span>
                      <h2>{roleName(current.role)}</h2>
                      <p>
                        {current.role === "mafia"
                          ? "표를 다른 사람에게 돌리세요. 동률이면 마피아가 탈출합니다."
                          : "최종 투표에서 마피아가 단독 최다표를 받으면 승리합니다."}
                      </p>
                    </div>
                    <p className="panel-hint">
                      두 번의 토론, 한 번의 투표.
                      <br />
                      역할은 마지막에 모두 공개됩니다.
                    </p>
                    <button
                      className="primary-button full"
                      onClick={() => action("reveal")}
                    >
                      역할 확인, 시작 <ArrowRight size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <h3>
                      {current.stage === "opening"
                        ? "첫 수를 골라 주세요."
                        : current.stage === "reply"
                          ? "읽힌 나를 바꿀 시간."
                          : "마지막 한 표입니다."}
                    </h3>
                    <p className="panel-hint">
                      {current.stage === "opening"
                        ? "테이블에서 한 명을 고르고, 행동을 선택하세요."
                        : current.stage === "reply"
                          ? "라이벌의 지목을 보고 입장을 정하세요."
                          : "토론에서 지목한 사람과 달라도 괜찮습니다."}
                    </p>
                    {current.stage === "opening" && (
                      <div className="choice-list">
                        {(
                          [
                            {
                              id: "accuse",
                              label: "먼저 지목한다",
                              sub: "내가 의심하는 사람을 공개",
                              icon: Crosshair,
                            },
                            {
                              id: "observe",
                              label: "한발 물러서 관망한다",
                              sub: "내 의심은 아직 보류",
                              icon: Eye,
                            },
                            {
                              id: "defend",
                              label: "내 결백부터 주장한다",
                              sub: "내 역할은 시민이라고 주장",
                              icon: ShieldCheck,
                            },
                          ] as const
                        ).map((c) => (
                          <button
                            key={c.id}
                            className={approach === c.id ? "chosen" : ""}
                            onClick={() => setApproach(c.id)}
                          >
                            <c.icon size={17} />
                            <span>
                              {c.label}
                              <small>{c.sub}</small>
                            </span>
                            <span className="radio-dot" />
                          </button>
                        ))}
                      </div>
                    )}
                    {current.stage === "reply" && (
                      <div className="choice-list">
                        {(
                          [
                            {
                              id: "hold",
                              label: "첫 지목을 유지한다",
                              sub:
                                nameOf(current.opening!.target) + "에게 그대로",
                              icon: Target,
                            },
                            {
                              id: "switch",
                              label: "다른 사람으로 바꾼다",
                              sub: "테이블에서 새 대상을 선택",
                              icon: RotateCcw,
                            },
                            {
                              id: "follow",
                              label: "다수의 지목을 따른다",
                              sub: nameOf(current.majorityTarget) + "에게 합류",
                              icon: Users,
                            },
                          ] as const
                        ).map((c) => (
                          <button
                            key={c.id}
                            className={reply === c.id ? "chosen" : ""}
                            onClick={() => setReply(c.id)}
                          >
                            <c.icon size={17} />
                            <span>
                              {c.label}
                              <small>{c.sub}</small>
                            </span>
                            <span className="radio-dot" />
                          </button>
                        ))}
                      </div>
                    )}
                    {current.stage === "opening" &&
                      current.memoryEnabled &&
                      state.tells.length > 0 && (
                        <div className="deception-plan">
                          <span>
                            <Sparkles size={13} /> 텔 역이용 계획{" "}
                            <small>선택 사항</small>
                          </span>
                          <button
                            className={!plan ? "plan-active" : ""}
                            onClick={() => setPlan(null)}
                          >
                            이번엔 자연스럽게
                          </button>
                          {state.tells.map((t) => (
                            <button
                              className={plan === t.id ? "plan-active" : ""}
                              key={t.id}
                              onClick={() => setPlan(t.id)}
                            >
                              {t.label}로 속이기
                            </button>
                          ))}
                          {plan && (
                            <p>
                              현재 역할과 반대인 인상을 심어 보세요. 기억 때문에
                              실제 오판 투표가 바뀌면 +75점을 얻습니다.
                            </p>
                          )}
                        </div>
                      )}
                    <div className="target-summary">
                      <span>
                        {current.stage === "vote"
                          ? "최종 투표 대상"
                          : "선택한 대상"}
                      </span>
                      <strong>
                        {current.stage === "reply" && reply !== "switch"
                          ? nameOf(
                              reply === "hold"
                                ? current.opening!.target
                                : current.majorityTarget,
                            )
                          : target
                            ? nameOf(target)
                            : "테이블에서 선택"}
                      </strong>
                    </div>
                    <button
                      className="primary-button full"
                      disabled={
                        current.stage === "reply"
                          ? reply === "switch" &&
                            (!target || target === current.opening!.target)
                          : !target
                      }
                      onClick={() =>
                        action(
                          current.stage === "opening"
                            ? "opening"
                            : current.stage === "reply"
                              ? "reply"
                              : "vote",
                          current.stage === "opening"
                            ? { approach, target, plan }
                            : current.stage === "reply"
                              ? {
                                  reply,
                                  target: target || current.opening!.target,
                                }
                              : { target },
                        )
                      }
                    >
                      {current.stage === "vote"
                        ? "이 사람에게 투표"
                        : "선택 확정"}{" "}
                      <ArrowRight size={16} />
                    </button>
                  </>
                )}
                <div className="provider-note">
                  {mode === "chatgpt" && !current.localFallback ? (
                    <>
                      <Zap size={12} />
                      <span>Using ChatGPT plan</span>
                      <a href={usageUrl} target="_blank" rel="noreferrer">
                        Manage usage
                      </a>
                    </>
                  ) : (
                    <>
                      <CircleDot size={12} />
                      <span>로컬 규칙 AI · 토큰 사용 없음</span>
                    </>
                  )}
                </div>
              </aside>
            </div>
          </div>
        )}
        {page === "play" && result && (
          <div className="results-screen">
            <div className="eyebrow">
              ROUND {current.round} · AFTER THE REVEAL
            </div>
            <div className="result-title">
              <div
                className={"result-emblem " + (current.won ? "win" : "lose")}
              >
                {current.won ? <Check size={35} /> : <Eye size={35} />}
              </div>
              <div>
                <h1>
                  {current.won
                    ? "이번 수는 당신의 승리."
                    : "이번엔 라이벌의 승리."}
                </h1>
                <p>
                  {current.eliminated
                    ? nameOf(current.eliminated) +
                      "에게 최다표. " +
                      roleName(current.roles![current.eliminated]) +
                      "였습니다."
                    : "동률로 마피아가 탈출했습니다."}{" "}
                  <span>당신은 {roleName(current.role)}</span>
                </p>
              </div>
              <b className="points">
                +
                {(current.won ? 100 : 25) +
                  (current.record?.deception?.success ? 75 : 0)}
                <small>POINTS</small>
              </b>
            </div>
            <div className="reveal-row">
              {(["you", ...AGENTS.map((a) => a.id)] as const).map((id) => (
                <div
                  key={id}
                  className={current.roles![id] === "mafia" ? "mafia" : ""}
                >
                  <span>{nameOf(id)}</span>
                  <strong>{roleName(current.roles![id])}</strong>
                  <small>투표 → {nameOf(current.votes[id]!)}</small>
                </div>
              ))}
            </div>
            <div className="result-section">
              <div className="section-label">
                <span>
                  <Fingerprint size={18} /> AI가 본 당신
                </span>
                <small>기억은 확률일 뿐, 정답이 아닙니다.</small>
              </div>
              <div className="readings-grid">
                {current.record!.decisions.map((d) => (
                  <div className="reading-card" key={d.agentId}>
                    <div>
                      <Portrait id={d.agentId} small />
                      <span>
                        <strong>{nameOf(d.agentId)}</strong>
                        <small>
                          {AGENTS.find((a) => a.id === d.agentId)!.tag}
                        </small>
                      </span>
                      <b
                        className={
                          d.target === d.withoutMemory ? "" : "changed"
                        }
                      >
                        {d.target === d.withoutMemory
                          ? "투표 유지"
                          : "기억이 투표를 바꿈"}
                      </b>
                    </div>
                    <p>
                      {d.evidence ? (
                        <>
                          {d.evidence.tell.label}를{" "}
                          {d.evidence.value ? "선택" : "선택하지 않음"}.<br />
                          당신의 의심{" "}
                          <b>
                            {pct(d.baseline.you!)} → {pct(d.probabilities.you!)}
                          </b>
                        </>
                      ) : current.memoryEnabled ? (
                        "이번 선택에 적용할 역할별 텔은 없습니다."
                      ) : (
                        "이 판에서는 텔 기억을 사용하지 않았습니다."
                      )}
                    </p>
                    <div className="vote-comparison">
                      <span>
                        기억 OFF <b>{nameOf(d.withoutMemory)}</b>
                      </span>
                      <ArrowRight size={13} />
                      <span>
                        {current.memoryEnabled ? "기억 ON" : "실제 투표 (OFF)"}{" "}
                        <b>{nameOf(d.target)}</b>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {current.record?.deception && (
              <div
                className={
                  "deception-result " +
                  (current.record.deception.success ? "success" : "")
                }
              >
                <Sparkles size={20} />
                <div>
                  <strong>
                    {current.record.deception.success
                      ? "가짜 텔이 통했습니다. +75점"
                      : current.record.deception.matched
                        ? "반대 역할의 인상은 심었지만, 투표까지 바꾸진 못했습니다."
                        : "이번 계획은 오판 투표로 이어지지 않았습니다."}
                  </strong>
                  <p>
                    {current.record.deception.success
                      ? current.record.deception.changedVotes
                          .map((id) => nameOf(id))
                          .join(", ") +
                        "의 투표가 기억 때문에 틀린 방향으로 바뀌었습니다."
                      : "결과는 선택 기록에 남습니다. 다음 판에서는 다른 수를 시도해 보세요."}
                  </p>
                </div>
              </div>
            )}
            <div className="new-memory">
              <BookOpen size={19} />
              <div>
                <strong>
                  {state.tells.length
                    ? state.tells.length +
                      "개의 역할별 텔이 라이벌의 노트에 있습니다."
                    : "라이벌이 당신의 선택을 한 판 더 배웠습니다."}
                </strong>
                <p>
                  시민 {state.stats.roleSamples.citizen}판 · 마피아{" "}
                  {state.stats.roleSamples.mafia}판.{" "}
                  {state.tells.length
                    ? "역할을 바꿔 같은 행동을 하면, 그들의 추측도 흔들립니다."
                    : "각 역할 두 판부터 차이가 충분한 행동만 텔로 인정합니다."}
                </p>
              </div>
              <button className="text-button" onClick={() => setPage("memory")}>
                기록 보기 <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="result-footer">
              <span>
                <Clock3 size={14} />
                {ms(current.record!.elapsedMs)}
                <i /> API {current.metrics.length}회<i />
                {current.metrics.some((m) => m.totalTokens !== null)
                  ? current.metrics.reduce(
                      (s, m) => s + (m.totalTokens || 0),
                      0,
                    ) + " tokens"
                  : "토큰 " + (mode === "practice" ? "사용 없음" : "미집계")}
              </span>
              <button
                className="secondary-button"
                onClick={() => setHideResult(true)}
              >
                테이블로 돌아가기
              </button>
              <button className="primary-button" onClick={start}>
                다음 판, 다르게 두기 <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
        {page === "memory" && (
          <div className="content-page">
            <div className="eyebrow">THE RIVALS' NOTEBOOK</div>
            <h1>그들이 읽은 당신.</h1>
            <p className="page-intro">
              성격은 라이벌의 방식. 텔은 역할에 따라 달라진 당신의 선택입니다.
            </p>
            <div className="memory-progress">
              <Fingerprint size={29} />
              <div>
                <strong>
                  {state.tells.length
                    ? "기록에 근거한 " + state.tells.length + "개의 가설"
                    : "아직 당신을 읽는 중입니다."}
                </strong>
                <p>
                  시민 {state.stats.roleSamples.citizen}/2판 이상 · 마피아{" "}
                  {state.stats.roleSamples.mafia}/2판 이상에서 비교합니다.
                </p>
              </div>
              <span>{state.stats.rounds}판의 기록</span>
            </div>
            {state.tells.length === 0 ? (
              <div className="empty-notebook">
                <BookOpen size={40} />
                <h3>습관을 성급히 단정하지 않습니다.</h3>
                <p>
                  각 역할을 두 번 이상 경험하고, 선택 비율에 차이가 생기면
                  <br />
                  라이벌이 과거 기록을 근거로 의심하기 시작합니다. 보통
                  5판째부터.
                </p>
                <button
                  className="secondary-button"
                  onClick={() => setPage("play")}
                >
                  테이블로 가기 <ArrowRight size={15} />
                </button>
              </div>
            ) : (
              <div className="tells-grid">
                {state.tells.map((t) => (
                  <div key={t.id} className="tell-card">
                    <div className="tell-heading">
                      <span>
                        <Fingerprint size={17} />
                        {t.label}
                      </span>
                      <small>가설 · 표본 {t.mafia.n + t.citizen.n}판</small>
                    </div>
                    <div className="role-rate">
                      <span>마피아</span>
                      <div>
                        <i style={{ width: pct(t.mafia.hits / t.mafia.n) }} />
                      </div>
                      <b>
                        {t.mafia.hits}/{t.mafia.n}판
                      </b>
                    </div>
                    <div className="role-rate citizen">
                      <span>시민</span>
                      <div>
                        <i
                          style={{ width: pct(t.citizen.hits / t.citizen.n) }}
                        />
                      </div>
                      <b>
                        {t.citizen.hits}/{t.citizen.n}판
                      </b>
                    </div>
                    <p>
                      이 선택을 하면 <b>{roleName(t.favoredRole)}일 가능성</b>을
                      높게 봅니다. 적은 표본은 완화하고, 확정 판단은 하지
                      않습니다.
                    </p>
                    <div className="tell-observers">
                      관찰하는 라이벌{" "}
                      {AGENTS.filter((a) =>
                        (a.interests as readonly string[]).includes(t.id),
                      ).map((a) => (
                        <span key={a.id}>{a.name}</span>
                      ))}
                    </div>
                    <small className="source-rounds">
                      근거:{" "}
                      {[...t.mafia.rounds, ...t.citizen.rounds]
                        .sort((a, b) => a - b)
                        .slice(-10)
                        .map((n) => "#" + n)
                        .join(" · ")}
                    </small>
                  </div>
                ))}
              </div>
            )}
            <div className="section-label history-heading">
              <span>판별 선택 기록</span>
              <a
                className="text-button"
                href={"/api/memory/export?mode=" + mode}
              >
                <Download size={14} /> 내보내기
              </a>
            </div>
            {state.history.length ? (
              <div className="history-table">
                <div className="history-header">
                  <span>판</span>
                  <span>역할</span>
                  <span>첫 수</span>
                  <span>응수</span>
                  <span>결과</span>
                </div>
                {state.history
                  .slice(-20)
                  .reverse()
                  .map((r) => (
                    <div key={r.round}>
                      <b>#{r.round}</b>
                      <span className={r.humanRole}>
                        {roleName(r.humanRole)}
                      </span>
                      <span>
                        {r.features.firstAccuse
                          ? "선제 지목"
                          : r.features.selfDefend
                            ? "결백 주장"
                            : "관망"}
                      </span>
                      <span>
                        {r.features.followMajority
                          ? "다수 추종"
                          : r.features.switchTarget
                            ? "지목 변경"
                            : "지목 유지"}
                      </span>
                      <span>
                        {r.won ? "승리" : "패배"}
                        {r.deception?.success ? " · 역이용 성공" : ""}
                      </span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="muted">아직 완료한 판이 없습니다.</p>
            )}
          </div>
        )}
        {page === "usage" && (
          <div className="content-page">
            <div className="eyebrow">EVERY MOVE COUNTS</div>
            <h1>작은 판, 쌓이는 변화.</h1>
            <p className="page-intro">
              실측 값만 표시합니다. 연습 기록과 ChatGPT 호출은 구분됩니다.
            </p>
            <div className="stat-cards">
              <div>
                <span>완료한 판</span>
                <b>
                  {state.stats.rounds}
                  <small>판</small>
                </b>
              </div>
              <div>
                <span>승리</span>
                <b>
                  {state.stats.wins}
                  <small>회</small>
                </b>
              </div>
              <div>
                <span>판당 평균 시간</span>
                <b>
                  {state.stats.averageMs === null
                    ? "—"
                    : (state.stats.averageMs / 60000).toFixed(1)}
                  <small>분</small>
                </b>
              </div>
              <div>
                <span>판당 평균 토큰</span>
                <b>
                  {state.stats.averageTokens === null
                    ? "—"
                    : Math.round(state.stats.averageTokens).toLocaleString()}
                </b>
              </div>
            </div>
            <div className="usage-card">
              <div>
                <Zap size={23} />
                <h3>ChatGPT plan usage</h3>
                <p>
                  {mode === "practice"
                    ? "연습 모드는 OpenAI에 요청을 보내지 않습니다."
                    : "실측 " +
                      state.stats.measuredCalls +
                      "회 · 집계 토큰 " +
                      state.stats.totalTokens.toLocaleString() +
                      " · 미집계 호출 " +
                      state.stats.unknownUsageCalls +
                      "회"}
                </p>
              </div>
              <a
                className="secondary-button"
                href={usageUrl}
                target="_blank"
                rel="noreferrer"
              >
                Manage usage <ArrowUpRight size={15} />
              </a>
            </div>
            <div className="latency-card">
              <div className="section-label">
                <span>
                  <Clock3 size={17} /> 1회 응답 속도 실측
                </span>
                <small>현재 계정 · 선택한 모델</small>
              </div>
              <div className="latency-values">
                <div>
                  <span>첫 텍스트 토큰까지</span>
                  <b>{ms(state.benchmark?.ttftMs ?? null)}</b>
                </div>
                <div>
                  <span>완료 이벤트까지</span>
                  <b>{ms(state.benchmark?.completionMs ?? null)}</b>
                </div>
                <div>
                  <span>사용 토큰</span>
                  <b>{state.benchmark?.totalTokens ?? "미집계"}</b>
                </div>
              </div>
              <p className="muted">
                {state.benchmark
                  ? "모델: " +
                    state.benchmark.model +
                    " · " +
                    (state.benchmark.completed
                      ? "실제 Responses API 완료 응답"
                      : "완료되지 않은 요청")
                  : "ChatGPT로 연결한 뒤 측정할 수 있습니다. 측정 1회도 본인의 플랜 사용량에 포함됩니다."}
              </p>
              <button
                className="secondary-button"
                disabled={!state.auth.sharing || !model || Boolean(playing)}
                onClick={() =>
                  run(async () => {
                    await api("/api/benchmark", { model });
                    await refresh();
                  }, "실제 API 응답 속도를 측정 중")
                }
              >
                응답 속도 측정 <ArrowRight size={14} />
              </button>
            </div>
            <p className="footnote">
              한 판은 최대 2회 호출. 8,000 집계 토큰 이후 추가 호출을 멈춥니다.
              API 출력 토큰의 절대 상한은 지원되지 않아, 25초 시간 제한과 출력
              길이 보호를 함께 적용합니다. 중단된 요청의 사용량은 미집계될 수
              있습니다.
            </p>
          </div>
        )}
        {page === "settings" && (
          <div className="content-page">
            <div className="eyebrow">YOUR TABLE, YOUR RULES</div>
            <h1>다음 판을 준비하세요.</h1>
            <div className="settings-card">
              <div className="settings-row">
                <div>
                  <h3>플레이 모드</h3>
                  <p>모드별로 선택 기록과 텔을 따로 저장합니다.</p>
                </div>
                <div className="segmented">
                  <button
                    className={mode === "practice" ? "selected" : ""}
                    disabled={Boolean(playing)}
                    onClick={() => setMode("practice")}
                  >
                    연습
                  </button>
                  <button
                    className={mode === "chatgpt" ? "selected" : ""}
                    disabled={Boolean(playing)}
                    onClick={() => setMode("chatgpt")}
                  >
                    ChatGPT
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <h3>라이벌의 텔 기억</h3>
                  <p>다음 판부터 적용. 꺼도 내 선택은 기록됩니다.</p>
                </div>
                <button
                  className={"toggle " + (memory ? "on" : "")}
                  role="switch"
                  aria-checked={memory}
                  aria-label="텔 기억 사용"
                  onClick={() => setMemory(!memory)}
                >
                  <span />
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <h3>ChatGPT 계정</h3>
                  <p>
                    {activeProfile
                      ? activeProfile.label +
                        " · " +
                        (state.auth.sharing
                          ? "플랜 사용 연결됨"
                          : "플랜 사용 권한 없음")
                      : "본인의 Plus / Pro 플랜으로 AI 요청을 처리합니다."}
                  </p>
                </div>
                <ChatGPTButton
                  onClick={() =>
                    signIn(
                      activeProfile?.id,
                      !state.auth.sharing && Boolean(activeProfile),
                    )
                  }
                />
              </div>
              {state.auth.profiles.length > 0 && (
                <div className="account-actions">
                  {state.auth.profiles.map((p) => (
                    <button
                      className="secondary-button"
                      key={p.id}
                      onClick={() => signIn(p.id)}
                    >
                      {p.label}로 다시 연결
                    </button>
                  ))}
                  <button className="text-button" onClick={() => signIn()}>
                    다른 계정 추가 <ArrowUpRight size={14} />
                  </button>
                  {state.auth.connected && (
                    <button
                      className="text-button"
                      onClick={() =>
                        run(async () => {
                          const data = await api("/api/auth/logout", {});
                          modelAttempt.current = null;
                          setModel("");
                          await refresh();
                          if (!data.revoked)
                            setError(
                              "로컬 연결은 해제했습니다. 원격 해제는 확인하지 못했으므로 ChatGPT 설정에서도 앱 연결을 해제해 주세요.",
                            );
                        })
                      }
                    >
                      <LogOut size={14} /> 연결 해제
                    </button>
                  )}
                </div>
              )}
              <div className="settings-row">
                <div>
                  <h3>AI 모델</h3>
                  <p>현재 계정이 제공하는 모델 목록을 사용합니다.</p>
                </div>
                <div className="model-picker">
                  <select
                    aria-label="AI 모델 선택"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={!state.auth.sharing}
                  >
                    {state.catalog.length === 0 ? (
                      <option value="">먼저 ChatGPT로 연결</option>
                    ) : (
                      state.catalog.map((m) => (
                        <option key={m.slug} value={m.slug}>
                          {m.display_name}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    className="icon-button"
                    disabled={!state.auth.sharing}
                    aria-label="모델 목록 새로고침"
                    onClick={loadModels}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              </div>
              {state.auth.sharing && (
                <div className="using-plan">
                  <span>Using ChatGPT plan</span>
                  <a href={usageUrl} target="_blank" rel="noreferrer">
                    Manage usage <ArrowUpRight size={13} />
                  </a>
                </div>
              )}
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <div>
                  <h3>기억과 개인정보</h3>
                  <p>
                    게임 선택·역할·결과만 이 PC에 저장합니다. 대사 호출에는 관련
                    텔 요약을 전송합니다.
                    <br />
                    로그인에 필요한 식별자와 토큰은 게임 기록과 분리해서
                    보호합니다. 이메일과 이름은 따로 저장하지 않습니다.
                  </p>
                </div>
                <ShieldCheck size={26} className="muted" />
              </div>
              <div className="settings-row">
                <div>
                  <h3>
                    {mode === "practice" ? "연습" : "ChatGPT"} 기록 초기화
                  </h3>
                  <p>이 모드의 모든 판과 텔을 삭제합니다.</p>
                </div>
                <button
                  className="danger-button"
                  onClick={() => setModal("delete")}
                  disabled={Boolean(playing)}
                >
                  기록 삭제
                </button>
              </div>
              {playing && (
                <div className="settings-row">
                  <div>
                    <h3>진행 중인 판 포기</h3>
                    <p>끝내지 않은 판은 텔 표본에 포함하지 않습니다.</p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      run(async () => {
                        await api("/api/game/abandon", {});
                        await refresh();
                        setPage("play");
                      })
                    }
                  >
                    판 포기하기
                  </button>
                </div>
              )}
            </div>
            <div className="settings-footer">
              TELL Rivals · 오픈소스 로컬 에디션 <span>MIT LICENSE</span>
            </div>
          </div>
        )}
      </main>
      {busy && (
        <div className="busy-overlay" role="status">
          <div className="busy-spinner" />
          <strong>{busyText}</strong>
          <p>선택은 한 번만 처리됩니다. 잠시 기다려 주세요.</p>
        </div>
      )}
      {(modal || welcome || current?.aiError) && !busy && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            {current?.aiError ? (
              <>
                <AlertTriangle size={30} className="gold" />
                <h2 id="modal-title">ChatGPT 응답이 멈췄습니다.</h2>
                <p>{current.aiError}</p>
                <p>
                  판과 선택은 저장했습니다. 이 판의 남은 진행을 로컬 규칙 AI로
                  이어갈 수 있습니다.
                </p>
                <a
                  className="primary-button full"
                  href={usageUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Manage usage <ArrowUpRight size={15} />
                </a>
                <button
                  className="secondary-button full"
                  onClick={() => action("ack-error")}
                >
                  확인하고 로컬 대사로 이어가기
                </button>
              </>
            ) : welcome ? (
              <>
                <img
                  className="welcome-logo"
                  src="/assets/chatgpt-logo-white.svg"
                  alt="ChatGPT"
                />
                <h2 id="modal-title">You're using your ChatGPT plan</h2>
                <p>
                  이 앱의 AI 요청은 본인의 ChatGPT 플랜 또는 허용한 크레딧을
                  사용합니다. 게임 이용료는 없습니다.
                </p>
                <p>
                  앱별 사용 한도와 연결은 ChatGPT 설정에서 관리할 수 있습니다.
                </p>
                <a
                  className="text-button"
                  href={usageUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Manage usage <ArrowUpRight size={14} />
                </a>
                <button
                  className="primary-button full"
                  onClick={() =>
                    run(async () => {
                      await api("/api/auth/welcome", {});
                      await refresh();
                    })
                  }
                >
                  Got it
                </button>
              </>
            ) : modal === "delete" ? (
              <>
                <h2 id="modal-title">이 모드의 기록을 삭제할까요?</h2>
                <p>
                  {mode === "practice" ? "연습" : "ChatGPT"} 모드의{" "}
                  {state.stats.rounds}판과 발견한 텔이 초기화됩니다. 다른 모드
                  기록은 유지됩니다.
                </p>
                <button
                  className="danger-button full"
                  onClick={() =>
                    run(async () => {
                      await api("/api/memory/clear", { mode });
                      setModal(null);
                      await refresh();
                    })
                  }
                >
                  이 모드의 기록 삭제
                </button>
                <button
                  className="secondary-button full"
                  onClick={() => setModal(null)}
                >
                  취소
                </button>
              </>
            ) : (
              <>
                <button
                  className="modal-close icon-button"
                  aria-label="게임 방법 닫기"
                  onClick={() => setModal(null)}
                >
                  <X size={18} />
                </button>
                <div className="eyebrow">HOW TO PLAY</div>
                <h2 id="modal-title">읽히고, 다시 속이세요.</h2>
                <ol className="rules-list">
                  <li>
                    <b>당신과 네 라이벌 중 한 명이 마피아.</b>
                    <p>
                      시민은 마피아를 찾고, 마피아는 살아남습니다. 알리바이는
                      확실한 증거가 아닙니다.
                    </p>
                  </li>
                  <li>
                    <b>두 번 선택하고, 한 번 투표.</b>
                    <p>
                      지목·관망·결백 주장 후, 유지·변경·다수 추종을 선택하세요.
                      단독 최다표 한 명이 추방됩니다. 동률이면 마피아 승리.
                    </p>
                  </li>
                  <li>
                    <b>각 역할 두 판부터 습관이 단서로.</b>
                    <p>
                      역할은 두 판씩 균형 배정됩니다. 반복해서 다르게 행동하면
                      대개 5판째부터 텔이 등장합니다. 기록에 차이가 없으면
                      억지로 만들지 않습니다.
                    </p>
                  </li>
                  <li>
                    <b>읽힌 습관을 역이용.</b>
                    <p>
                      발견된 텔로 반대 역할의 인상을 심으세요. 기억 때문에 실제
                      투표가 틀린 방향으로 바뀌면 +75점.
                    </p>
                  </li>
                </ol>
                <button
                  className="primary-button full"
                  onClick={() => setModal(null)}
                >
                  좋아, 다음 수를 두자 <ArrowRight size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
