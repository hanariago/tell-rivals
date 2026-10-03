import {
  ArrowRight,
  BookOpen,
  Clock3,
  Fingerprint,
  HelpCircle,
  MousePointer2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AGENTS } from "../game/engine.js";

type Props = {
  rounds: number;
  tells: number;
  sharing: boolean;
  ready: boolean;
  paused: boolean;
  onPractice: () => void;
  onChatGPT: () => void;
  onSignIn: () => void;
  onRules: () => void;
  onNotebook: () => void;
};

export default function Lobby(p: Props) {
  return (
    <div className="lobby">
      <section className="lobby-hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="status-dot" /> 클릭으로 즐기는 짧은 심리전
          </div>
          <h1>
            마피아는 한 명.
            <br />
            <em>당신은 누구를 믿을까요?</em>
          </h1>
          <p>
            네 명의 라이벌 사이에서 마피아를 찾으세요.
            <br />
            판이 쌓이면, 당신의 습관도 그들의 단서가 됩니다.
          </p>
          <div className="hero-meta">
            <span>
              <Users size={16} /> 나 + 라이벌 4명
            </span>
            <span>
              <Clock3 size={16} /> 목표 1–3분
            </span>
            <span>
              <MousePointer2 size={16} /> 채팅 입력 없음
            </span>
          </div>
          <div className="start-box">
            <h2>
              {p.rounds
                ? "다음 판, 다른 수를 둬 보세요."
                : "처음이라면, 연습 한 판부터."}
            </h2>
            <p>
              {p.rounds
                ? `${p.rounds}판을 완료했어요. ${p.tells ? `라이벌은 ${p.tells}개의 역할별 습관을 기억합니다.` : "아직 역할별 습관을 비교하고 있어요."}`
                : "로그인 없이 룰을 익힐 수 있어요. 선택은 클릭으로만 합니다."}
            </p>
            <div className="start-actions">
              <button className="primary-button" onClick={p.onPractice}>
                연습 게임 시작 <ArrowRight size={18} />
              </button>
              {p.sharing ? (
                <button
                  className="secondary-button"
                  disabled={!p.ready || p.paused}
                  onClick={p.onChatGPT}
                >
                  ChatGPT로 게임 시작 <ArrowRight size={16} />
                </button>
              ) : (
                <button className="chatgpt-button" onClick={p.onSignIn}>
                  <img src="/assets/chatgpt-logo-white.svg" alt="" />
                  Continue with ChatGPT
                </button>
              )}
            </div>
            <small>
              {p.sharing
                ? p.paused
                  ? "ChatGPT 사용 한도로 새 호출이 멈췄어요. 설정에서 사용량을 확인해 주세요."
                  : p.ready
                    ? "ChatGPT 연결 완료. 본인의 플랜 사용량으로 플레이합니다."
                    : "계정의 모델 목록을 확인하고 있어요. 설정에서도 확인할 수 있습니다."
                : "ChatGPT로 플레이하려면 Continue with ChatGPT 버튼으로 로그인하세요. 본인의 플랜 사용량을 씁니다."}
            </small>
          </div>
        </div>
        <div className="rivals-table">
          <div className="table-caption">
            <span>오늘의 라이벌</span>
            <small>성격도, 눈여겨보는 선택도 달라요.</small>
          </div>
          <div className="rivals-row">
            {AGENTS.map((a, i) => (
              <article className="rival-lobby" key={a.id}>
                <div className="rival-art">
                  <span className="seat-number">0{i + 1}</span>
                  <img
                    className="portrait"
                    src={`/assets/${a.id}.svg`}
                    alt={`${a.name}의 초상`}
                  />
                </div>
                <div className="rival-description">
                  <h3>
                    {a.name}
                    <span>{a.tag}</span>
                  </h3>
                  <p>{a.focus}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="table-note">
            <Fingerprint size={20} />
            <p>
              라이벌은 당신의 <b>게임 속 선택</b>만 기억해요.
              <br />
              기억은 이 기기에 저장됩니다.
            </p>
          </div>
        </div>
      </section>
      <section className="how-strip" aria-label="한 판 진행 방법">
        <div className="section-label">
          <h2>한 판은 이렇게 흘러가요.</h2>
          <button className="text-button" onClick={p.onRules}>
            <HelpCircle size={16} /> 자세한 게임 방법
          </button>
        </div>
        <ol>
          <li>
            <span>1</span>
            <div>
              <h3>내 역할 확인</h3>
              <p>
                시민이면 마피아를 찾고,
                <br />
                마피아면 표를 다른 사람에게 돌려요.
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>두 번의 토론 선택</h3>
              <p>
                한 명을 고르고 행동을 선택해요.
                <br />
                라이벌의 반응을 보고 생각을 바꿔도 돼요.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>마지막 한 표</h3>
              <p>
                가장 많은 표를 받은 한 명을 추방해요.
                <br />
                마피아를 잡으면 시민이 이깁니다.
              </p>
            </div>
          </li>
        </ol>
      </section>
      <section className="tell-explainer">
        <BookOpen size={26} />
        <div>
          <h2>“텔”은 역할에 따라 달라지는 습관이에요.</h2>
          <p>
            예를 들어 <b>마피아일 때만 먼저 지목</b>했다면, 다음 판에 라이벌이
            그 기록으로 당신을 의심할 수 있어요. 시민·마피아를 각각 두 판 이상
            경험한 뒤 차이가 생기면 기억이 등장합니다. 읽혔다면, 다음 판엔
            일부러 행동을 바꿔 보세요.
          </p>
        </div>
        <button className="text-button" onClick={p.onNotebook}>
          내 습관 노트 <ArrowRight size={16} />
        </button>
      </section>
      <div className="lobby-footer">
        <ShieldCheck size={15} />
        연습과 ChatGPT 모드는 기록을 따로 저장해요. 기억을 꺼서 비교할 수도
        있습니다.
      </div>
    </div>
  );
}
