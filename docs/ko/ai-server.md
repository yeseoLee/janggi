# AI 서버 문서 (Fairy-Stockfish 래퍼)

## 1. 범위
`ai-server`는 Janggi 엔진(Fairy-Stockfish)을 HTTP API로 감싼 전용 서비스입니다.

주요 역할:
- 장기 엔진 프로세스 장기 실행
- 엔진 명령 직렬화(큐 기반)
- 백엔드가 호출하기 쉬운 `/move` API 제공
- 변형(variant)과 탐색 시간 설정 환경변수화

진입점: `ai-server/server.js`

## 2. 런타임 설계

### 2.1 엔진 초기화 순서
프로세스 시작 후 다음 UCI 명령으로 초기화합니다.
1. `uci`
2. `setoption name UCI_Variant value janggi`
3. `isready`

엔진 종료/오류 시 대기 중 요청은 실패 처리됩니다.

### 2.2 명령 직렬화 큐
내부 `enqueue` 큐로 요청을 직렬화하여, 다중 요청이 동시에 와도 `position/go` 명령이 섞이지 않도록 보장합니다.

## 3. HTTP API

### 3.1 `GET /health`
반환 항목:
- `ok`
- `initialized`
- `variant`
- `pid`

### 3.2 `POST /move`
요청 본문:
- `fen` (필수)
- `movetime` (선택)
- `depth` (선택)

응답:
- `bestmove`
- `ponder` (없으면 `null`)

검증:
- `fen` 누락/빈 문자열 -> `400`
- 엔진 연산 실패 -> `500`

## 4. 시간/깊이 처리
- `movetime`은 100ms~5000ms 범위로 clamp
- 백엔드가 `depth`를 전달하면 depth 기반 탐색으로 실행
- 명령 유형에 따라 엔진 응답 대기 timeout을 다르게 적용

## 5. 환경 변수
- `PORT` (기본 `4000`)
- `STOCKFISH_PATH` (기본 `/usr/local/bin/fairy-stockfish`)
- `AI_VARIANT` (기본 `janggi`)
- `AI_MOVE_TIME_MS` (기본 `700`)

## 6. Docker 빌드 포인트
`ai-server/Dockerfile`은 멀티스테이지로 동작합니다.
- 빌드 스테이지에서 Fairy-Stockfish 소스 빌드
- `TARGETARCH`에 맞는 아키텍처 옵션 선택
- 런타임 이미지에 바이너리만 복사

즉, 호스트 엔진 설치 없이 Compose 단독 실행이 가능합니다.

## 7. 연동 방식
백엔드의 `POST /api/ai/move`가 이 서버를 호출합니다.

- 백엔드: 보드 상태를 Janggi FEN으로 변환
- AI 서버: 엔진 탐색 후 `bestmove` 반환

AI 서버는 유저/대국 상태를 저장하지 않는 계산 전용 서비스입니다.

## 8. 실행
```bash
cd ai-server
npm install
npm start
```

기본 포트: `4000`
