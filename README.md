# TELL — 나를 읽는 라이벌

짧은 판이 쌓일수록 네 AI 라이벌이 당신의 **역할별 선택 차이**를 기억하는, PC 로컬 소셜 디덕션 게임입니다. 텍스트 입력 없이 지목·선택·투표로 플레이합니다.

## 실행

Node.js 22 이상이 필요합니다. 설치된 의존성과 고정 버전은 `package-lock.json`을 사용합니다.

```powershell
cd D:\codex\game_newone\tell-rivals
npm ci
npm run build
npm start
```

브라우저에서 **http://127.0.0.1:4317** 을 엽니다. `localhost`를 사용하지 마세요. Windows에서는 `start.ps1`로 설치·빌드·실행을 한 번에 할 수 있습니다. 개발 서버는 `npm run dev`입니다.

```powershell
# 포트 변경은 선택 사항입니다. 로그인 콜백도 같은 포트로 자동 구성됩니다.
$env:TELL_PORT = '4319'
npm start
```

## 플레이

1. 로그인 없는 **연습**으로 플레이하거나, 설정에서 **Continue with ChatGPT**로 본인의 계정을 연결하고 플랜 사용을 허용합니다.
2. ChatGPT 모드에서는 계정이 제공하는 모델을 고릅니다. 첫 연결 때 플랜 사용 안내가 한 번 표시됩니다.
3. 역할 확인 → 첫 선택 → 응수 → 최종 투표. 5인 중 마피아 1명. 단독 최다표가 마피아면 시민 승리, 다른 사람 또는 동률이면 마피아 승리입니다.
4. 플레이어 역할은 두 판씩 균형 배정합니다. 시민/마피아 각각 두 판 후 행동 차이가 충분하면 **5판째부터** 라이벌이 기록을 인용합니다. 차이가 없으면 텔을 만들지 않습니다.
5. 발견된 텔에 대해 **역이용 계획**을 선택하고 반대 역할의 인상을 심어 보세요. 기억 때문에 실제 오판 투표가 바뀌면 +75점입니다. 종료 후 **AI가 본 당신**에서 기억 ON/OFF의 의심 확률과 투표를 비교합니다.

본인의 ChatGPT 플랜 사용량이 필요하며 API 키는 사용하지 않습니다. 플랜 사용 가능 여부는 계정·워크스페이스·OpenAI 정책에 따릅니다. 앱 자체 이용료는 없습니다. **[ChatGPT 사용량 관리](https://chatgpt.com/settings/usage)** 에서 연결과 사용 한도를 관리하세요.

## 실제 측정

설정에서 계정 연결과 모델 선택을 마친 뒤, **플레이 기록 → 응답 속도 측정**을 누릅니다. 실제 Responses SSE의 첫 `response.output_text.delta`까지 걸린 시간과 `response.completed`까지 걸린 시간을 각각 기록합니다. 이 측정도 플랜을 사용합니다. 판별 토큰과 시간은 완료한 판에만 집계하고, 사용량이 없는/중단된 호출은 `미집계`로 표시합니다.

현재 검증 결과와 미확인 사항은 [REPORT.md](REPORT.md)에 있습니다. 실제 계정 로그인·API 응답 측정이 완료되기 전에는 라이브 통합 성공을 주장하지 않습니다.

## 기억과 개인정보

기본 Windows 경로는 `%LOCALAPPDATA%\TellRivals`입니다. macOS/Linux는 `~/.local/share/tell-rivals`입니다.

- `game/practice.json`, `game/chatgpt.json`: 모드별 구조화된 선택, 공개된 역할, 결과, 실제 투표 비교, 호출 측정.
- `game/current.json`: 중간에 종료한 판 복구. 끝나지 않은 판은 텔 학습에 포함하지 않습니다.
- `game/benchmark.json`: 최근 실제 응답 시간 측정.
- `auth/accounts.credential`: 인증에 필요한 검증된 subject/client 등록, 토큰, 부여된 scope. Windows DPAPI로 현재 OS 사용자에 귀속하여 암호화합니다. macOS/Linux는 소유자 전용 파일 권한(0600)입니다.
- `auth/host.json`: 설치별로 한 번 생성하는 임의 host ID. 게임 기록과 계정을 연결하는 데 쓰지 않습니다.

대화 원문으로 텔을 추출하지 않습니다. 게임 밖의 행동·브라우징·개인정보를 수집하지 않습니다. 이름과 이메일은 따로 저장하지 않으며, OAuth의 ID 토큰에는 인증 제공자가 발행한 프로필 claim이 포함될 수 있습니다. 토큰은 브라우저, 로그, 소스 저장소에 전달하지 않습니다.

**원본 텔 기록의 저장은 로컬**입니다. ChatGPT 대사를 호출할 때 해당 턴에 필요한 제한된 텔 요약과 공개 발언을 OpenAI에 전송하며 모든 요청은 `store:false`입니다. 이는 네트워크 전송 자체가 없다는 의미가 아닙니다.

UI에서 JSON 내보내기, 모드별 기억 삭제, 기억 끄기, 계정 재연결/추가/해제가 가능합니다. 원격 토큰 폐기를 확인하지 못했을 경우 ChatGPT 설정에서도 앱 연결을 해제하도록 안내합니다.

## 구조

- `src/game/engine.ts`: 역할, 턴, 구조화된 선택, 확률 정책, 투표, 승패. 저장/API 구현에 의존하지 않습니다.
- `src/game/provider.ts`: `AiProvider` 경계와 허용된 대사 톤 응답 검증. 모델 자유 텍스트는 표시하지 않습니다.
- `server/ai.ts`: ChatGPT Responses 호출, SSE 완료/실패 처리, 실측, 호출 보호.
- `server/storage.ts`: `TellStore` 경계와 로컬 원자적 저장. AI 어댑터와 별개입니다.
- `server/auth.ts`: 동적 OSS OAuth, state/nonce/PKCE, JWKS 검증, 등록별 계정, 갱신과 폐기.
- `src/App.tsx`: 클릭 전용 한국어 UI.

캐릭터의 **판단과 실제 투표는 확률 정책 코드**가 담당합니다. 기억이 해당 확률에 영향을 줍니다. ChatGPT는 이미 검증된 판단/기록에 맞는 대사 톤을 선택하고, 코드가 수치·기록 번호를 결합합니다. LLM이 과거를 창작하거나 현재 숨은 역할을 볼 수 없습니다. 이 첫 버전은 자유 대화형 LLM 플레이어가 아닙니다.

향후 웹 호스팅 전환 시 `AiProvider`와 `TellStore` 구현을 교체할 수 있습니다. 다만 **현재 OSS ChatGPT 인증 경로를 원격 서비스로 그대로 전용할 수 있다고 가정하지 않습니다**. Sites의 방문자 플랜 호출 가능 여부와 정책은 [REPORT.md](REPORT.md)를 참고하세요.

## 검증

```powershell
npm run check
```

빌드, 19개의 의미 있는 엔진/저장/보안/API/스트림 테스트, 독립된 1,000개 시드 시뮬레이션을 실행합니다. 테스트 임시 저장소는 `.local` 하위에 있고 실사용 기록과 분리됩니다. `artifacts/simulation.json`은 **합성 오프라인 검증 결과**이며 사람의 플레이나 실제 API 측정값이 아닙니다.

`TELL_DATA_DIR`로 별도 저장소를 지정할 수 있습니다. UI QA용 저장소는 `TELL_TEST_MODE=1`을 함께 설정하면 화면에 **QA 테스트 저장소**가 표시됩니다. 사용자 저장소에 합성 기억을 주입하는 기능은 없습니다.

## 라이선스

코드와 직접 제작한 SVG 캐릭터는 [MIT](LICENSE)입니다. OpenAI/ChatGPT 로고 및 명칭은 OpenAI의 상표이며 MIT 허가에 포함되지 않습니다. 공식 로그인 에셋 출처와 아이콘 고지는 [ASSETS.md](ASSETS.md)를 참고하세요.
