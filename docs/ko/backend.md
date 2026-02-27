# 백엔드 문서 (Express + Socket.IO + PostgreSQL)

## 1. 범위
백엔드는 서비스의 권한/상태 기준(Authoritative) 계층으로 다음을 담당합니다.
- JWT 인증/세션 수명주기
- 유저 정보/회원 탈퇴
- 승강급 매칭 및 실시간 대국 상태 동기화
- 친선 초대/친선 대국 룸 생성
- 소셜 그래프(친구/친구신청/악당)
- 기보 저장/조회 API
- 급수 및 ELO 반영
- AI 연동 중계 API (`/api/ai/move`)

운영 환경에서는 프론트 빌드 산출물 정적 서빙도 수행합니다.

## 2. 런타임 스택
- Node.js + Express
- Socket.IO
- PostgreSQL (`pg`)
- JWT + bcrypt

진입점: `backend/server.js`

## 3. 인증 및 세션 모델

### 3.1 JWT 페이로드
로그인 성공 시 토큰에 다음 정보가 포함됩니다.
- `id` (유저 ID)
- `username`
- `sid` (세션 ID, UUID)

### 3.2 중복 로그인 방지
메모리 맵 `activeSessions`에 유저별 현재 유효 세션과 소켓 목록을 저장합니다.

새 로그인 발생 시:
- 기존 소켓 강제 종료
- 대국 중이면 기권패(대국 전이면 매칭 취소)
- 기존 클라이언트에 `session_terminated` 이벤트 전송

REST 미들웨어도 `sid` 불일치 토큰을 차단하며,
- `401 { code: 'DUPLICATE_LOGIN' }`
응답을 반환합니다.

## 4. 데이터베이스 모델
서버 시작 시 `initDB`에서 테이블 생성/마이그레이션을 수행합니다.

### 4.1 테이블
- `users`
  - 계정: `username`, `password`, `nickname`
  - 전적/랭크: `rank`, `wins`, `losses`, `rank_wins`, `rank_losses`, `rating`
  - 재화: `coins`
- `games`
  - 승/패 유저: `winner_id`, `loser_id`
  - 팀/모드/결과: `winner_team`, `loser_team`, `game_mode`, `result_type`, `move_count`
  - 기보: `moves`(레거시), `move_log`(JSONB), `cho_setup`, `han_setup`
  - 시각 정보: `started_at`, `ended_at`, `played_at`
- `friendships` (양방향 저장)
- `friend_requests` (`pending|accepted|rejected|cancelled`)
- `villains` (악당 관계)

### 4.2 주요 인덱스
- 게임 조회: `idx_games_played_at`, `idx_games_move_count`
- 소셜 조회: 친구/악당/친구신청 관련 인덱스

## 5. REST API

### 5.1 인증/유저
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/user/me`
- `DELETE /api/auth/me` (회원 탈퇴)

### 5.2 소셜
- `GET /api/social/users/search?q=`
- `GET /api/social/friend-requests`
- `GET /api/social/friends`
- `POST /api/social/friends` (친구 신청)
- `POST /api/social/friend-requests/:requestId/accept`
- `POST /api/social/friend-requests/:requestId/reject`
- `DELETE /api/social/friends/:friendId`
- `GET /api/social/villains`
- `POST /api/social/villains`
- `DELETE /api/social/villains/:targetUserId`
- `GET /api/social/friends/:friendId/games`

### 5.3 재화/AI/기보
- `POST /api/coins/spend-ai-match`
- `POST /api/coins/recharge`
- `POST /api/ai/move` (백엔드 -> ai-server 중계)
- `POST /api/games/ai` (AI 대국 기보 저장)
- `GET /api/games`
- `GET /api/games/:id`

## 6. Socket.IO 프로토콜
엔드포인트: `/socket.io`

### 6.1 Client -> Server
- `find_match`
- `friendly_invite_send`
- `friendly_invite_accept`
- `friendly_invite_decline`
- `join_friendly_match`
- `setup_phase_started`
- `submit_setup`
- `cancel_match`
- `move`
- `pass`
- `resign`
- `checkmate`
- `finish_by_rule` (점수승부)

### 6.2 Server -> Client
- `match_found`
- `setup_timer_sync`
- `opponent_setup`
- `clock_sync`
- `move`
- `pass_turn`
- `game_over`
- `match_cancelled`
- `friendly_invite_received`
- `friendly_invite_declined`
- `friendly_match_ready`
- `session_terminated`

## 7. 매칭 및 소셜 제약

### 7.1 승강급 매칭 큐
- 악당 관계인 유저끼리는 매칭하지 않음
- 초/한 배정은 급수/승률 기준 우선 규칙 + 동률 랜덤

### 7.2 친선 대국 흐름
- 친구 관계에서만 초대 가능
- 악당 관계면 초대 차단
- 수락 후 임시 친선 매치 생성, 양측이 `matchId`로 입장

## 8. 포진 선택 타이머 및 시간제

### 8.1 포진 선택 타이머
- 각 선택자 기준 20초 제한
- 대국 시작 전 타임아웃 시 매칭 취소

### 8.2 대국 시간제(초읽기)
서버가 시간의 최종 기준입니다.
- 기본 생각 시간: 5분
- 초읽기: 30초 3회
- 매 수 액션 시 경과 시간 반영, `clock_sync`로 동기화
- 시간 소진 시 `time` 결과로 종료

## 9. 대국 종료 처리
`processGameEnd(roomId, winnerTeam, resultType)`에서 다음을 트랜잭션으로 수행합니다.
- 종료 플래그/타이머 정리
- 승/패 유저 행 잠금(`FOR UPDATE`)
- 누적 승패 + 급수 카운터 갱신
- ELO 반영(`K=32`, 하한치 적용)
- `games` 기보/메타 데이터 저장

지원 결과 타입:
- `resign`
- `time`
- `piece`
- `checkmate`
- `score`
- `unknown`

## 10. 기보 조회 규칙
- `/api/games`는 사용자 관점 필드를 포함합니다.
  - `my_result`, `my_team`, `opponent_name`
- 모드 구분: 승강급/친선/AI
- `/api/games/:id`는 친구 관계 접근 허용 + 레거시 기보 보정 로직 포함

## 11. AI 중계 로직
`POST /api/ai/move`:
- 보드/턴 유효성 검증
- 보드 -> Janggi FEN 변환
- depth/movetime clamp
- ai-server `/move` 호출
- `bestmove` 파싱 후 좌표 반환
- 파싱 불가 시 `pass: true`

## 12. 주요 소스 파일
- `server.js` – API/소켓/게임 수명주기 통합
- `src/rank.js` – 급수 승강급 기준
- `src/coinService.js` – 코인 사용/충전
- `src/aiMove.js` – FEN/엔진 수 변환
- `src/streak.js` – 최다 연승 계산

## 13. 실행/테스트
```bash
cd backend
npm install
npm start
npm test
npm run test:coverage
```

기본 포트: `3000`
