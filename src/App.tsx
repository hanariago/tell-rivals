import { useEffect, useRef, useState } from "react";
import Lobby from "./ui/Lobby.js";
import PlayBoard from "./ui/PlayBoard.js";
import {
  ArrowUpRight,
  ArrowRight,
  Fingerprint,
  CircleDot,
  BookOpen,
  SlidersHorizontal,
  ShieldCheck,
  Clock3,
  Zap,
  X,
  Eye,
  Check,
  Download,
  RotateCcw,
  Sparkles,
  BarChart3,
  LogOut,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import {
  AGENTS,
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
  const [notebookRound, setNotebookRound] = useState<number | null>(null);
  const modelAttempt = useRef<string | null>(null);
  const csrf = useRef("");
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const activeProfile = state?.auth.profiles.find(
    (p) => p.id === state.auth.activeId,
  );
  const welcome = activeProfile?.needsWelcome;
  const dialogOpen =
    Boolean(modal || welcome || state?.match?.aiError) && !busy;
  async function api(url: string, body?: unknown) {
    const r = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-Tell-CSRF": csrf.current },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => {
      throw new Error(
        "게임 서버에 연결할 수 없습니다. 폴더의 play.cmd를 실행한 뒤 다시 시도해 주세요.",
      );
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
  useEffect(() => {
    setTarget(null);
    setReply("hold");
    if (state?.match) {
      window.scrollTo({ top: 0, behavior: "instant" });
      stageHeading.current?.focus({ preventScroll: true });
    }
  }, [state?.match?.id, state?.match?.stage]);
  useEffect(() => {
    if (page === "memory" && notebookRound !== null) {
      const row = document.getElementById(`record-${notebookRound}`);
      row?.scrollIntoView({ block: "center", behavior: "instant" });
      row?.focus({ preventScroll: true });
    } else window.scrollTo({ top: 0, behavior: "instant" });
  }, [page, notebookRound, hideResult]);
  function openNotebook(round?: number) {
    setNotebookRound(round ?? null);
    setPage("memory");
  }
  useEffect(() => {
    if (!dialogOpen || !dialogRef.current) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const controls = () => [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href], select:not(:disabled), summary",
      ),
    ];
    (
      dialog.querySelector<HTMLElement>("[data-autofocus]") || controls()[0]
    )?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && modal) {
        event.preventDefault();
        setModal(null);
      }
      if (event.key === "Tab") {
        const items = controls();
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    dialog.addEventListener("keydown", onKey);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [dialogOpen, modal]);
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
  async function start(nextMode: Mode = mode) {
    if (nextMode !== mode) setMode(nextMode);
    setTarget(null);
    setPlan(null);
    setApproach("observe");
    setReply("hold");
    setHideResult(false);
    await run(async () => {
      setState(
        await api("/api/game/start", {
          mode: nextMode,
          model,
          memoryEnabled: memory,
        }),
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
        {error && (
          <button
            className="primary-button"
            onClick={() => refresh().catch((e) => setError(e.message))}
          >
            다시 연결하기
          </button>
        )}
      </div>
    );
  const current = state.match;
  const playing = current && current.stage !== "finished";
  const result = current?.stage === "finished" && !hideResult;
  const latestRecord = state.history.at(-1);
  const navigation: { id: Page; label: string; icon: typeof CircleDot }[] = [
    { id: "play", label: "게임", icon: CircleDot },
    { id: "memory", label: "습관 노트", icon: BookOpen },
    { id: "usage", label: "플레이 기록", icon: BarChart3 },
    { id: "settings", label: "설정", icon: SlidersHorizontal },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar" inert={busy || dialogOpen}>
        <a className="brand" href="/" aria-label="TELL 홈">
          <img src="/assets/mark.svg" alt="" />
          <span>
            TELL<span className="brand-dot">.</span>
            <small>나를 읽는 라이벌</small>
          </span>
        </a>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={"nav-item " + (page === n.id ? "active" : "")}
              aria-label={n.label}
              aria-current={page === n.id ? "page" : undefined}
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
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-dot" />
            기억은 이 기기에
          </div>
          <button className="help-link" onClick={() => setModal("rules")}>
            <HelpCircle size={17} /> 게임 방법
          </button>
        </div>
      </aside>
      <main className="workspace" inert={busy || dialogOpen}>
        <header className="topbar">
          <div className="breadcrumb">
            {page !== "play" && playing ? (
              <button className="text-button" onClick={() => setPage("play")}>
                <ArrowRight size={15} /> 진행 중인 게임으로 돌아가기
              </button>
            ) : (
              <span>{navigation.find((n) => n.id === page)!.label}</span>
            )}
          </div>
          <div className="topbar-right">
            <span className="mode-chip">
              <span className="status-dot" />
              {state.testMode
                ? "QA 테스트 저장소"
                : mode === "practice"
                  ? "로그인 없는 연습"
                  : "ChatGPT로 플레이"}
            </span>
            <button
              className="icon-button"
              title="설정"
              aria-label="설정 열기"
              onClick={() => setPage("settings")}
            >
              <SlidersHorizontal size={17} />
            </button>
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
          <Lobby
            rounds={state.stats.rounds}
            tells={state.tells.length}
            sharing={state.auth.sharing}
            ready={Boolean(model)}
            paused={state.planPaused}
            onPractice={() => start("practice")}
            onChatGPT={() => start("chatgpt")}
            onSignIn={() => signIn(activeProfile?.id)}
            onRules={() => setModal("rules")}
            onNotebook={() => openNotebook()}
          />
        )}
        {page === "play" && playing && (
          <PlayBoard
            current={current}
            mode={mode}
            target={target}
            approach={approach}
            reply={reply}
            plan={plan}
            tells={state.tells}
            headingRef={stageHeading}
            onTarget={setTarget}
            onApproach={setApproach}
            onReply={(value) => {
              setReply(value);
              if (value === "switch") setTarget(null);
            }}
            onPlan={setPlan}
            onAction={action}
            onNotebook={openNotebook}
            onRules={() => setModal("rules")}
          />
        )}
        {page === "play" && result && (
          <div className="results-screen">
            <div className="eyebrow">{current.round}번째 판 · 역할 공개</div>
            <div className="result-title">
              <div
                className={"result-emblem " + (current.won ? "win" : "lose")}
              >
                {current.won ? <Check size={35} /> : <Eye size={35} />}
              </div>
              <div>
                <h1 ref={stageHeading} tabIndex={-1}>
                  {current.won
                    ? "이겼어요! 다음 수는 뭘까요?"
                    : "이번 판은 졌어요. 다음엔 다르게."}
                </h1>
                <p>
                  {current.eliminated
                    ? nameOf(current.eliminated) +
                      "의 역할은 " +
                      roleName(current.roles![current.eliminated]) +
                      (current.roles![current.eliminated] === "mafia"
                        ? "였어요. 가장 많은 표를 받아 추방됐습니다."
                        : "이었어요. 시민을 추방해 마피아가 살아남았습니다.")
                    : "표가 동률이라 마피아가 살아남았어요."}{" "}
                  <span>당신은 {roleName(current.role)}</span>
                </p>
              </div>
              <b className="points">
                +
                {(current.won ? 100 : 25) +
                  (current.record?.deception?.success ? 75 : 0)}
                <small>획득한 점수</small>
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
              <p className="result-intro">
                과거의 습관을 몰랐을 때의 투표와 이번 실제 투표를 비교해요.
                기록이 더 쌓이면 이 차이가 나타납니다.
              </p>
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
                          {d.evidence.value
                            ? "선택했어요"
                            : "선택하지 않았어요"}
                          .<br />
                          {current.roles![d.agentId] === "mafia"
                            ? "마피아가 내게 표를 돌릴 확률 "
                            : "나를 의심해 지목할 확률 "}
                          <b>
                            {pct(d.baseline.you!)} → {pct(d.probabilities.you!)}
                          </b>
                        </>
                      ) : current.memoryEnabled ? (
                        "이번에는 과거의 습관이 판단에 쓰이지 않았어요. 공개 단서와 이번 선택으로 판단했습니다."
                      ) : (
                        "이 판에서는 텔 기억을 사용하지 않았습니다."
                      )}
                    </p>
                    <div className="vote-comparison">
                      <span>
                        과거 기억이 없었다면 <b>{nameOf(d.withoutMemory)}</b>
                      </span>
                      <ArrowRight size={13} />
                      <span>
                        이번 실제 투표 <b>{nameOf(d.target)}</b>
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
                        ? "다른 역할처럼 보였지만, 시민 라이벌의 투표까지 속이지는 못했어요."
                        : "이번 계획은 오판 투표로 이어지지 않았습니다."}
                  </strong>
                  <p>
                    {current.record.deception.success
                      ? current.record.deception.changedVotes
                          .map((id) => nameOf(id))
                          .join(", ") +
                        "(시민)의 투표가 기억 때문에 틀린 방향으로 바뀌었습니다."
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
                    : "라이벌이 이번 선택도 기억했어요. 아직 습관을 비교하는 중입니다."}
                </strong>
                <p>
                  시민 {state.stats.roleSamples.citizen}판 · 마피아{" "}
                  {state.stats.roleSamples.mafia}판.{" "}
                  {state.tells.length
                    ? "역할을 바꿔 같은 행동을 하면, 그들의 추측도 흔들립니다."
                    : "시민과 마피아를 각각 두 판 이상 경험한 뒤, 역할에 따라 달라진 선택을 찾아요."}
                </p>
              </div>
              <button className="text-button" onClick={() => setPage("memory")}>
                습관 노트 보기 <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="result-footer">
              <span>
                <Clock3 size={14} />
                {ms(current.record!.elapsedMs)}
                <i /> AI 호출 {current.metrics.length}회<i />
                {current.metrics.some((m) => m.totalTokens !== null)
                  ? current.metrics.reduce(
                      (s, m) => s + (m.totalTokens || 0),
                      0,
                    ) + " 토큰"
                  : "토큰 " + (mode === "practice" ? "사용 없음" : "미집계")}
              </span>
              <button
                className="secondary-button"
                onClick={() => setHideResult(true)}
              >
                첫 화면으로
              </button>
              <button className="primary-button" onClick={() => start()}>
                한 판 더 시작 <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
        {page === "memory" && (
          <div className="content-page">
            <div className="eyebrow">라이벌의 습관 노트</div>
            <h1>어떤 선택을 기억하고 있을까요?</h1>
            <p className="page-intro">
              ‘텔’은 시민일 때와 마피아일 때 다르게 반복한 선택이에요. 예를 들어
              마피아일 때만 먼저 지목했다면, 그 행동이 다음 판의 의심 근거가
              됩니다.
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
                  지금까지 시민 {state.stats.roleSamples.citizen}판 · 마피아{" "}
                  {state.stats.roleSamples.mafia}판. 각 역할 두 판 이상부터
                  습관을 비교해요.
                </p>
              </div>
              <span>{state.stats.rounds}판의 기록</span>
            </div>
            {state.tells.length === 0 ? (
              <div className="empty-notebook">
                <BookOpen size={40} />
                <h3>
                  {state.stats.roleSamples.citizen >= 2 &&
                  state.stats.roleSamples.mafia >= 2
                    ? "두 역할의 선택이 아직 충분히 다르지 않아요."
                    : "아직 비교할 기록이 충분하지 않아요."}
                </h3>
                <p>
                  시민과 마피아를 각각 두 번 이상 경험해 보세요. 두 역할에서
                  선택이 달라지면 보통 5판째부터 라이벌이 그 기록을 꺼냅니다.
                  같은 행동을 했다면 기록이 충분해도 습관을 억지로 만들지
                  않아요.
                </p>
                <button
                  className="secondary-button"
                  onClick={() => setPage("play")}
                >
                  게임으로 돌아가기 <ArrowRight size={15} />
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
                  <span>첫 번째 토론</span>
                  <span>두 번째 토론</span>
                  <span>결과</span>
                </div>
                {(notebookRound === null
                  ? state.history.slice(-20)
                  : state.history.filter(
                      (r) =>
                        r.round === notebookRound ||
                        r.round > state.history.length - 20,
                    )
                )
                  .slice()
                  .reverse()
                  .map((r) => (
                    <div
                      key={r.round}
                      id={`record-${r.round}`}
                      tabIndex={-1}
                      className={
                        notebookRound === r.round ? "selected-record" : ""
                      }
                      aria-label={
                        notebookRound === r.round
                          ? `${r.round}판: 라이벌이 인용한 실제 선택 기록`
                          : undefined
                      }
                    >
                      <b>#{r.round}</b>
                      <span className={r.humanRole}>
                        {roleName(r.humanRole)}
                      </span>
                      <span>
                        {r.features.firstAccuse
                          ? "의심 공개"
                          : r.features.selfDefend
                            ? "결백 주장"
                            : "지켜보기"}
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
            <div className="eyebrow">플레이 기록과 사용량</div>
            <h1>몇 판을 했고, 얼마나 썼을까요?</h1>
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
                <h3>ChatGPT 플랜 사용량</h3>
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
                  <Clock3 size={17} /> 별도 응답 속도 측정
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
                  : state.auth.sharing
                    ? "아직 별도 속도 측정을 하지 않았어요. 측정 1회도 본인의 플랜 사용량에 포함됩니다."
                    : "ChatGPT로 로그인한 뒤 측정할 수 있어요. 측정 1회도 본인의 플랜 사용량에 포함됩니다."}
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
            {latestRecord && latestRecord.metrics.length > 0 && (
              <details className="call-history">
                <summary>
                  {latestRecord.round}번째 판의 AI 응답 시간과 토큰 보기
                </summary>
                {latestRecord.metrics.map((m, i) => (
                  <div className="call-row" key={i}>
                    <strong>
                      {i === 0 ? "첫 번째 토론" : "두 번째 토론"} · {m.model}
                    </strong>
                    <span>
                      첫 텍스트까지 <b>{ms(m.ttftMs)}</b>
                    </span>
                    <span>
                      {m.completed ? "완료까지" : "요청이 멈추기까지"}{" "}
                      <b>{ms(m.completionMs)}</b>
                    </span>
                    <span>
                      입력 {m.inputTokens ?? "미집계"} · 출력{" "}
                      {m.outputTokens ?? "미집계"}
                    </span>
                    <span>
                      총 토큰 <b>{m.totalTokens ?? "미집계"}</b>
                    </span>
                  </div>
                ))}
              </details>
            )}
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
            <div className="eyebrow">게임 설정</div>
            <h1>계정과 기억을 관리하세요.</h1>
            <p className="page-intro">
              ChatGPT 로그인, AI 모델 선택, 기억 사용 여부를 여기서 바꿀 수
              있어요.
            </p>
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
                  <h3>라이벌이 과거 습관을 기억하게 하기</h3>
                  <p>
                    끄면 다음 판에서 과거 습관을 판단에 쓰지 않아요. 선택 기록은
                    계속 쌓입니다.
                  </p>
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
            ref={dialogRef}
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
                  data-autofocus
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
                  data-autofocus
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
                <div className="eyebrow">처음 하는 사람을 위한 안내</div>
                <h2 id="modal-title">게임은 어떻게 하나요?</h2>
                <ol className="rules-list">
                  <li>
                    <b>나와 라이벌 네 명, 마피아는 딱 한 명.</b>
                    <p>
                      내 역할이 시민이면 마피아를 찾으세요. 마피아라면 다른
                      사람에게 표를 돌리세요. 인물 카드의 알리바이는 불완전한
                      단서예요. 그것만으로 정답을 알 수는 없습니다.
                    </p>
                  </li>
                  <li>
                    <b>사람과 행동을 고르며 두 번 토론해요.</b>
                    <p>
                      첫 토론에서 마음속으로 의심하는 한 명을 고른 뒤, 의심
                      공개·지켜보기·내 결백 주장 중 하나를 선택하세요. 라이벌의
                      반응을 읽고 두 번째 토론에서 대상을 유지하거나 바꿉니다.
                      글을 입력할 필요는 없어요.
                    </p>
                  </li>
                  <li>
                    <b>마지막에는 추방할 사람에게 한 표.</b>
                    <p>
                      다섯 명의 표를 합쳐 혼자 가장 많은 표를 받은 한 명이
                      추방됩니다. 그 사람이 마피아면 시민 승리. 시민이
                      추방되거나 최다표가 동률이면 마피아 승리예요.
                    </p>
                  </li>
                  <li>
                    <b>여러 판을 하면, 습관이 읽히기 시작해요.</b>
                    <p>
                      시민과 마피아를 각각 두 판 이상 경험한 뒤, 역할에 따라
                      달라진 선택만 ‘텔’이라는 습관으로 기억해요. 예를 들어
                      마피아일 때만 먼저 의심을 공개했다면, 다음 판에 그
                      기록으로 지목당할 수 있습니다. 행동을 바꿔 그 추측을 속여
                      보세요.
                    </p>
                  </li>
                </ol>
                <button
                  className="primary-button full"
                  onClick={() => setModal(null)}
                >
                  알겠어요 · 게임으로 돌아가기 <ArrowRight size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
