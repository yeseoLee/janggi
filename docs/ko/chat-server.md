# 채팅 서버 문서 (로비 실시간 채팅)

## 1. 범위
`chat-server`는 메인 화면 로비용 실시간 채팅(단일 채팅방)을 제공합니다.

핵심 요구사항:
- 채팅방 1개
- 최대 접속 인원 제한
- 서버 메시지 10분 보관 후 자동 삭제
- 현재 접속 인원 실시간 표시

진입점: `chat-server/server.js`

## 2. 런타임 스택
- Express + HTTP
- Socket.IO (경로: `/chat/socket.io`)
- JWT 기반 소켓 인증

## 3. 접속 모델

### 3.1 인증
소켓 handshake에서 JWT 토큰을 받아 검증합니다.
토큰 없거나 유효하지 않으면 즉시 연결 종료합니다.

### 3.2 정원 제한
- `connectedUsers` 맵으로 유니크 유저 수를 관리합니다.
- 정원 초과(`CHAT_MAX_USERS`) 상태에서 신규 유저 접속 시:
  - `chat_room_full` 전송
  - 소켓 연결 종료

### 3.3 접속 인원 브로드캐스트
접속/종료 시 `chat_presence` 이벤트로
- `onlineCount`
- `maxUsers`
를 전체에 방송합니다.

## 4. 메시지 저장 정책
메시지는 메모리에만 저장합니다.

- 보관 시간: `CHAT_RETENTION_MS` (기본 10분)
- 30초마다 오래된 메시지 정리
- 기준 시간보다 오래된 메시지는 자동 삭제

## 5. Socket 이벤트

### 5.1 Server -> Client
- `chat_init`
  - 초기 메시지 목록
  - 현재 접속 인원
  - 룸 메타 정보
- `chat_presence`
  - 접속 인원 변경
- `chat_message`
  - 새 메시지 브로드캐스트
- `chat_room_full`
  - 정원 초과

### 5.2 Client -> Server
- `chat_send`
  - payload: `{ text }`
  - ack: `{ ok: true }` 또는 오류 (`EMPTY_MESSAGE` 등)

## 6. 입력 정제
- 메시지 텍스트: trim + 최대 길이 제한(`CHAT_MAX_MESSAGE_LENGTH`)
- 닉네임: trim + 최대 20자 제한

## 7. 헬스 체크
`GET /chat/health` 응답:
- `ok`
- `onlineCount`
- `messageCount`
- `retentionMs`
- `maxUsers`

## 8. 환경 변수
- `PORT` (기본 `4100`)
- `JWT_SECRET` (백엔드와 동일 값 필요)
- `CHAT_MAX_USERS` (기본 `1000`)
- `CHAT_RETENTION_MS` (기본 `600000`)
- `CHAT_MAX_MESSAGE_LENGTH` (기본 `300`)

## 9. 프론트 연동
프론트는 다음으로 연결합니다.
- Socket path: `/chat/socket.io`
- auth: `{ token, nickname }`

Docker 환경에서는 frontend Nginx가 `/chat/socket.io`를 `chat-server:4100`으로 프록시합니다.

## 10. 실행
```bash
cd chat-server
npm install
npm start
```

기본 포트: `4100`
