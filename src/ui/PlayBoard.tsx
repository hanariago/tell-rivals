import {
  ArrowRight,
  BookOpen,
  Check,
  CircleDot,
  Crosshair,
  Eye,
  HelpCircle,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import {
  AGENTS,
  nameOf,
  roleName,
  type AgentId,
  type Approach,
  type Feature,
  type Mode,
  type PublicMatch,
  type Reply,
  type Tell,
} from "../game/engine.js";

type Props = {
  current: PublicMatch;
  mode: Mode;
  target: AgentId | null;
  approach: Approach;
  reply: Reply;
  plan: Feature | null;
  tells: Tell[];
  headingRef: RefObject<HTMLHeadingElement | null>;
  onTarget: (id: AgentId) => void;
  onApproach: (value: Approach) => void;
  onReply: (value: Reply) => void;
  onPlan: (value: Feature | null) => void;
  onAction: (name: string, data?: Record<string, unknown>) => void;
  onNotebook: (round?: number) => void;
  onRules: () => void;
};
const pct = (n: number) => `${Math.round(n * 100)}%`;
function clue(n: number) {
  return n > 0.6
    ? "엇갈린 알리바이"
    : n > 0.3
      ? "미확인 알리바이"
      : "부분 확인된 알리바이";
}

export default function PlayBoard(p: Props) {
  const { current: c } = p;
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const phase = ["brief", "opening", "reply", "vote"].indexOf(c.stage);
  const selected =
    c.stage === "reply" && p.reply !== "switch"
      ? p.reply === "hold"
        ? c.opening!.target
        : c.majorityTarget
      : p.target;
  const choosing =
    c.stage === "opening" ||
    c.stage === "vote" ||
    (c.stage === "reply" && p.reply === "switch");
  const canConfirm =
    Boolean(selected) &&
    !(
      c.stage === "reply" &&
      p.reply === "switch" &&
      selected === c.opening!.target
    );
  const final = c.stage === "vote";
  const confirmLabel = final
    ? `${selected ? nameOf(selected) : "대상"}에게 투표하고 결과 보기`
    : c.stage === "opening"
      ? "첫 선택 확정 · 라이벌 반응 보기"
      : "두 번째 선택 확정 · 투표로 이동";
  return (
    <div className="game-screen" data-stage={c.stage}>
      <div className="game-heading">
        <div>
          <div className="eyebrow">{c.round}번째 판 · 마피아 1명, 시민 4명</div>
          <h2 ref={p.headingRef} tabIndex={-1}>
            {c.stage === "brief"
              ? "당신만 아는 역할을 확인하세요."
              : final
                ? "이제, 마지막 한 표예요."
                : c.stage === "opening"
                  ? "누구를 의심할지, 어떻게 말할지."
                  : "라이벌의 반응을 보고 다시 선택하세요."}
          </h2>
        </div>
        <button className="text-button" onClick={p.onRules}>
          <HelpCircle size={17} /> 게임 방법
        </button>
      </div>
      <div className="round-steps" aria-label="현재 진행 단계">
        {["역할 확인", "첫 번째 토론", "두 번째 토론", "최종 투표"].map(
          (s, i) => (
            <div
              className={phase === i ? "current" : phase > i ? "reached" : ""}
              aria-current={phase === i ? "step" : undefined}
              key={s}
            >
              <span>{phase > i ? <Check size={14} /> : i + 1}</span>
              <b>{s}</b>
            </div>
          ),
        )}
      </div>
      {c.stage === "brief" ? (
        <section className="brief-layout">
          <div className={`secret-card ${c.role}`}>
            <div className="role-card-top">이번 판의 나</div>
            <span>
              {c.role === "mafia" ? (
                <Eye size={52} />
              ) : (
                <ShieldCheck size={52} />
              )}
            </span>
            <h2>{roleName(c.role)}</h2>
            <p>
              {c.role === "mafia"
                ? "들키지 않고, 다른 사람에게 표를 돌리세요."
                : "네 명 중 숨어 있는 마피아를 찾아내세요."}
            </p>
            <small>다른 라이벌의 역할은 마지막에 공개됩니다.</small>
          </div>
          <div className="brief-copy">
            <div className="eyebrow">이번 판의 목표</div>
            <h3>
              {c.role === "mafia"
                ? "당신만 추방되지 않으면 승리."
                : "최다표로 마피아를 추방하면 승리."}
            </h3>
            <p>
              {c.role === "mafia"
                ? "시민인 척 의심할 사람을 고르세요. 최종 투표에서 다른 사람이 추방되거나 동률이 나면 당신이 이깁니다."
                : "인물 카드의 알리바이와 라이벌의 발언을 보고 판단하세요. 최종 투표에서 마피아가 혼자 가장 많은 표를 받으면 시민이 이깁니다."}
            </p>
            <div className="brief-rule">
              <b>두 번 선택하고, 한 번 투표해요.</b>
              <p>
                확실한 정답을 몰라도 괜찮아요. 첫 토론 뒤에 대상을 바꿀 수
                있습니다. 동률이면 마피아가 이겨요.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => p.onAction("reveal")}
            >
              역할 확인했어요 · 토론 시작 <ArrowRight size={18} />
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className={`role-reminder ${c.role}`}>
            <span>
              {c.role === "mafia" ? (
                <Eye size={18} />
              ) : (
                <ShieldCheck size={18} />
              )}{" "}
              나는 <b>{roleName(c.role)}</b>
            </span>
            <p>
              {c.role === "mafia"
                ? "나 대신 다른 사람이 추방되도록 표를 돌리세요."
                : "마피아가 누구인지 생각하며 선택하세요."}
            </p>
            <small>습관 기억 {c.memoryEnabled ? "켜짐" : "꺼짐"}</small>
          </div>
          <div className="game-layout">
            <div className="game-table">
              <section className="selection-area" aria-label="지목할 인물 선택">
                <div className="section-label">
                  <h3>
                    {final
                      ? "투표할 한 명을 골라주세요."
                      : choosing
                        ? "1. 의심하는 한 명을 골라주세요."
                        : "이번에 지목할 사람"}
                  </h3>
                  <span className="step-chip">
                    {selected
                      ? `${nameOf(selected)} 선택됨`
                      : "아직 선택하지 않았어요"}
                  </span>
                </div>
                <p className="selection-instruction">
                  {c.stage === "reply" && p.reply !== "switch"
                    ? "행동 선택에서 ‘다른 사람으로 바꾸기’를 고르면 대상을 바꿀 수 있어요."
                    : c.stage === "reply"
                      ? `처음 고른 ${nameOf(c.opening!.target)} 대신 다른 카드를 눌러주세요.`
                      : "아래 인물 카드를 클릭하세요. 알리바이는 단서일 뿐, 역할의 정답은 아니에요."}
                </p>
                <div className="players-grid">
                  {AGENTS.map((a) => (
                    <button
                      key={a.id}
                      aria-label={`${a.name} 선택`}
                      aria-pressed={selected === a.id}
                      className={`player-card ${selected === a.id ? "selected" : ""}`}
                      disabled={
                        !choosing ||
                        (c.stage === "reply" && a.id === c.opening!.target)
                      }
                      onClick={() => p.onTarget(a.id)}
                    >
                      <div className="player-art">
                        <img
                          className="portrait"
                          src={`/assets/${a.id}.svg`}
                          alt=""
                        />
                        <span className="selected-mark">
                          {selected === a.id ? <Check size={17} /> : <span />}
                        </span>
                      </div>
                      <strong>
                        {a.name}
                        <small>{a.tag}</small>
                      </strong>
                      <span
                        className={`clue ${c.clues[a.id] > 0.6 ? "uncertain" : ""}`}
                      >
                        {clue(c.clues[a.id])}
                      </span>
                      <small className="card-action">
                        {c.stage === "reply" &&
                        p.reply === "switch" &&
                        a.id === c.opening!.target
                          ? "처음 선택한 사람"
                          : selected === a.id
                            ? "이 사람을 선택했어요"
                            : choosing
                              ? "눌러서 선택"
                              : "아직 선택하지 않음"}
                      </small>
                    </button>
                  ))}
                </div>
                <div className="your-alibi">
                  <Eye size={16} />
                  <span>
                    라이벌에게 보이는 내 단서: <b>{clue(c.clues.you)}</b>
                  </span>
                </div>
              </section>
              <section className="conversation" aria-label="라이벌의 발언">
                <div className="section-label">
                  <h3>
                    {c.stage === "opening"
                      ? "라이벌의 반응은 선택 뒤에 나와요."
                      : "라이벌은 이렇게 생각해요."}
                  </h3>
                  <small>
                    {c.stage === "reply"
                      ? "첫 토론 뒤의 지목"
                      : final
                        ? "최종 투표 전의 지목"
                        : "아직 토론 전"}
                  </small>
                </div>
                {c.decisions.length === 0 ? (
                  <div className="conversation-empty">
                    <CircleDot size={25} />
                    <p>
                      먼저 인물과 행동을 고르고 <b>‘첫 선택 확정’</b>을
                      눌러주세요.
                    </p>
                  </div>
                ) : (
                  <div className="speech-grid">
                    {c.decisions
                      .filter((d) => d.stage === (c.stage === "reply" ? 1 : 2))
                      .map((d) => (
                        <article
                          className="speech"
                          key={`${d.agentId}-${d.stage}`}
                        >
                          <div className="speech-name">
                            <img
                              className="portrait small"
                              src={`/assets/${d.agentId}.svg`}
                              alt=""
                            />
                            <b>{nameOf(d.agentId)}</b>
                            <span className="suspect-label">
                              지목 → {nameOf(d.target)}
                            </span>
                          </div>
                          <details
                            className="speech-details"
                            open={!compact || Boolean(d.evidence)}
                          >
                            <summary>발언과 근거 보기</summary>
                            <p>{d.text}</p>
                            {d.evidence && (
                              <div className="evidence-cites">
                                <span>
                                  <BookOpen size={12} /> 기억의 근거
                                </span>
                                {d.evidence.cites.slice(-8).map((r) => (
                                  <button
                                    key={r}
                                    aria-label={`${r}판의 선택 기록 보기`}
                                    onClick={() => p.onNotebook(r)}
                                  >
                                    {r}판
                                  </button>
                                ))}
                                <small>
                                  나를 지목할 확률 변화{" "}
                                  {d.evidence.delta > 0 ? "+" : ""}
                                  {pct(d.evidence.delta)}p
                                </small>
                              </div>
                            )}
                          </details>
                        </article>
                      ))}
                  </div>
                )}
              </section>
            </div>
            <aside className="action-panel" aria-label="이번 턴의 행동 선택">
              <div className="eyebrow">
                {final
                  ? "마지막 선택"
                  : c.stage === "opening"
                    ? "첫 번째 토론"
                    : "두 번째 토론"}
              </div>
              <h3>
                {final ? "한 표를 확정하세요." : "2. 어떤 행동을 할까요?"}
              </h3>
              <p className="panel-hint">
                {final
                  ? "토론 때와 다른 사람에게 투표해도 돼요. 확정하면 바로 역할과 결과를 공개합니다."
                  : c.stage === "opening"
                    ? "의심하는 사람을 공개할지, 잠시 숨길지 선택해요. ‘지켜보기’가 기본으로 선택되어 있어요."
                    : "그대로 갈 수도, 대상을 바꿀 수도 있어요. 바꾸려면 다른 인물도 선택해 주세요."}
              </p>
              {c.stage === "opening" && (
                <div className="choice-list">
                  {[
                    {
                      id: "accuse",
                      label: "의심을 공개하기",
                      sub: selected
                        ? `${nameOf(selected)} 쪽이 의심된다고 말해요.`
                        : "선택한 사람이 의심된다고 말해요.",
                      icon: Crosshair,
                    },
                    {
                      id: "observe",
                      label: "지켜보기",
                      sub: "의심하는 사람을 아직 말하지 않아요.",
                      icon: Eye,
                    },
                    {
                      id: "defend",
                      label: "내 결백 주장하기",
                      sub: "내가 시민이라고 먼저 말해요.",
                      icon: ShieldCheck,
                    },
                  ].map((v) => (
                    <button
                      key={v.id}
                      className={p.approach === v.id ? "chosen" : ""}
                      aria-pressed={p.approach === v.id}
                      onClick={() => p.onApproach(v.id as Approach)}
                    >
                      <v.icon size={19} />
                      <span>
                        {v.label}
                        <small>{v.sub}</small>
                      </span>
                      <span className="radio-dot" />
                    </button>
                  ))}
                </div>
              )}
              {c.stage === "reply" && (
                <div className="choice-list">
                  {[
                    {
                      id: "hold",
                      label: `${nameOf(c.opening!.target)} 지목 유지하기`,
                      sub: "처음 마음속으로 고른 사람을 계속 의심해요.",
                      icon: Target,
                    },
                    {
                      id: "switch",
                      label: "다른 사람으로 바꾸기",
                      sub: "처음과 다른 인물 카드를 골라주세요.",
                      icon: RotateCcw,
                    },
                    {
                      id: "follow",
                      label: `다수의 지목 따르기`,
                      sub: `나를 제외한 최다 지목인 ${nameOf(c.majorityTarget)} 쪽으로 합류해요.`,
                      icon: Users,
                    },
                  ].map((v) => (
                    <button
                      key={v.id}
                      className={p.reply === v.id ? "chosen" : ""}
                      aria-pressed={p.reply === v.id}
                      onClick={() => p.onReply(v.id as Reply)}
                    >
                      <v.icon size={19} />
                      <span>
                        {v.label}
                        <small>{v.sub}</small>
                      </span>
                      <span className="radio-dot" />
                    </button>
                  ))}
                </div>
              )}
              <div className="target-summary">
                <span>{final ? "내 최종 투표" : "내가 고른 사람"}</span>
                <strong>
                  {selected ? nameOf(selected) : "인물 카드를 눌러주세요"}
                </strong>
                {!final && (
                  <small>
                    {c.stage === "opening"
                      ? p.approach === "accuse"
                        ? "의심을 공개할게요."
                        : p.approach === "observe"
                          ? "지금은 마음속으로만 의심할게요."
                          : "내가 시민이라고 주장할게요."
                      : p.reply === "hold"
                        ? "처음 지목을 유지할게요."
                        : p.reply === "follow"
                          ? "다수가 지목하는 사람을 따를게요."
                          : "지목할 사람을 바꿀게요."}
                  </small>
                )}
              </div>
              <button
                className="primary-button full"
                disabled={!canConfirm}
                onClick={() =>
                  p.onAction(
                    final
                      ? "vote"
                      : c.stage === "opening"
                        ? "opening"
                        : "reply",
                    c.stage === "opening"
                      ? { approach: p.approach, target: p.target, plan: p.plan }
                      : final
                        ? { target: p.target }
                        : {
                            reply: p.reply,
                            target: p.target || c.opening!.target,
                          },
                  )
                }
              >
                {confirmLabel}
                <ArrowRight size={17} />
              </button>
              {!canConfirm && (
                <p className="selection-help" role="status">
                  {c.stage === "reply"
                    ? "처음과 다른 인물 카드를 하나 골라야 확정할 수 있어요."
                    : "인물 카드 한 명을 선택하면 버튼이 활성화돼요."}
                </p>
              )}
              {p.plan && c.stage === "opening" && (
                <p className="planned-tell">
                  역이용 계획: {p.tells.find((t) => t.id === p.plan)?.label}
                </p>
              )}
              {c.stage === "opening" &&
                c.memoryEnabled &&
                p.tells.length > 0 && (
                  <details className="deception-plan">
                    <summary>
                      <Sparkles size={16} /> 기억을 역이용하고 싶다면{" "}
                      <small>선택 사항</small>
                    </summary>
                    <p>
                      현재 역할과 반대인 습관을 보여주세요. 시민 라이벌이 기억
                      때문에 오판 투표를 하면 +75점이에요.
                    </p>
                    <button
                      className={!p.plan ? "plan-active" : ""}
                      onClick={() => p.onPlan(null)}
                    >
                      이번엔 계획 없이
                    </button>
                    {p.tells.map((t) => (
                      <button
                        className={p.plan === t.id ? "plan-active" : ""}
                        key={t.id}
                        onClick={() => p.onPlan(t.id)}
                      >
                        {t.label}로 속이기
                      </button>
                    ))}
                  </details>
                )}
              <div className="provider-note">
                {p.mode === "chatgpt" && !c.localFallback ? (
                  <>
                    <Zap size={13} />
                    <span>Using ChatGPT plan</span>
                    <a
                      href="https://chatgpt.com/settings/usage"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Manage usage
                    </a>
                  </>
                ) : (
                  <>
                    <CircleDot size={13} />
                    <span>로그인 없는 연습 · AI 호출 비용 없음</span>
                  </>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
