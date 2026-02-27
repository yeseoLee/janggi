# 프론트엔드 문서 (React + Vite)

## 1. 범위
프론트엔드는 다음 기능의 사용자 UI와 클라이언트 게임 흐름 제어를 담당합니다.
- 인증(로그인/회원가입/로그아웃)
- 메인 로비 및 모드 진입
- 온라인/친선/AI/혼자 두기 대국 UI
- 대국 기록 목록 + 복기 화면
- 소셜 탭(친구, 친구 요청, 악당)
- 메인 실시간 채팅
- 프로필/언어 설정

Docker 구성에서는 정적 SPA(Nginx)로 동작하며,
- 백엔드 REST + Socket.IO (`/api`, `/socket.io`)
- 채팅 Socket.IO (`/chat/socket.io`)
에 연결됩니다.

## 2. 기술 스택
- React 19
- React Router
- Axios
- Socket.IO Client
- Vite
- Plain CSS (토스트/모달 중심 피드백)

## 3. 라우팅 및 인증 가드
주요 라우팅은 `src/App.jsx`에 정의되어 있습니다.

### 3.1 라우트
- `/` 메인 메뉴 (미로그인 시 인증 진입 화면)
- `/login`
- `/register`
- `/game?mode=online|friendly|ai|solo`
- `/replay` (`/records` 별칭)
- `/replay/:id`
- `/profile`
- `/social`
- `/social/friend/:friendId/records`

### 3.2 접근 제어
- `ProtectedRoute`로 대국/프로필/소셜 접근을 인증 상태로 제한합니다.
- `AuthContext`가 로컬 토큰 복원 후 `/api/user/me`로 유저 상태를 동기화합니다.

### 3.3 새로고침 복구 게이트
`ReloadRouteGate`는 새로고침 시 UI 유실/경로 유실 문제를 방지합니다.
- 마지막 경로를 sessionStorage에 저장
- 하드 리로드 시:
  - `/game...` 경로였으면 해당 대국 화면으로 복귀
  - 그 외 화면이면 `/`로 이동

## 4. 세션 및 중복 로그인 처리
`src/context/AuthContext.jsx` + 앱 전역 강제 로그아웃 모달로 처리합니다.

- 백엔드 JWT에 세션 식별자(`sid`) 포함
- 중복 로그인 감지(`DUPLICATE_LOGIN` 또는 `session_terminated`) 시:
  - 강제 로그아웃 모달 표시
  - 확인 시 토큰/유저 정리
  - 로그인 화면으로 이동

게임 소켓 연결 상태에서도 동일 정책이 적용됩니다.

## 5. 메인 메뉴 및 모드 진입
`src/pages/MainMenu.jsx`

### 5.1 모드 진입 UX
메인 카드 버튼:
- AI 대국
- 혼자 두기
- 친선 대국
- 승강급 대국(온라인)

브라우저 기본 alert/confirm 대신 모달/토스트를 사용합니다.

### 5.2 승강급 진행 패널
메인에서 승강급 기준 진행 정보를 표시합니다.
- 현재 급/단
- 승강급 전적(승/패)
- 승률
- 승급/강등까지 남은 횟수 진행 바

### 5.3 실시간 채팅 카드
메인 최근 대국 기록 하단에 채팅 UI를 제공합니다.
- 단일 로비 채팅방
- 현재 접속 인원 표시
- 실시간 메시지 수신/전송
- 정원 초과/연결 오류 토스트 처리

## 6. 보드 컴포넌트 및 대국 흐름
핵심 로직은 `src/components/Board.jsx`에 있습니다.

### 6.1 지원 모드
- `online` (승강급)
- `friendly` (친선)
- `ai`
- `solo` (혼자 두기)
- `replay` (복기)

### 6.2 포진 선택 및 대국 시작
- 포진 선택 UI는 중앙 정렬 모달 기반
- 포진 선택 제한 시간: `20초`
- 제한 시간 초과 시 매칭 취소/동기화
- 대국 시작 요약 모달은 `5초` 자동 확인(애니메이션 포함)

### 6.3 시간제(초읽기 포함)
서버 `clock_sync`를 기준으로 클라이언트 표시 시간을 계산합니다.
- 기본 생각 시간: 5분
- 초읽기: 30초 3회
- UI에서 기본 시간 + 남은 초읽기 횟수를 함께 표시

### 6.4 자동 종료 규칙 UI 반영
다음 종료 조건을 UI에서 처리/표시합니다.
- 양측 연속 한수쉼 -> 점수승부
- 점수 10점 이하 발생 -> 점수승부
- 200수 도달 -> 점수승부
- 시간 초과 -> 시간패
- 기권/외통/점수승부

결과 문구는 “누가 이겼는지”보다 “어떻게 승/패했는지” 중심으로 표시합니다.

### 6.5 복기 모드 특성
- 복기 모드에서는 대국 종료 모달을 띄우지 않음
- 스텝 단위 이동(이전/다음)
- 신규/레거시 기보 포맷 모두 재생 지원

### 6.6 보드 표시 옵션
설정 패널에서 다음 옵션 지원:
- 시점(초/한)
- 기물 색 반전
- 상대 기물 회전
- 보드 확대(`janggi_board_zoomed` 로컬 저장)

## 7. 소셜 기능 (클라이언트)
`src/pages/SocialPage.jsx`, `useFriendlyMatchSocket`

### 7.1 친구 기능
- 유저 검색
- 친구 신청
- 받은/보낸 신청 목록
- 수락/거절
- 친구 삭제

### 7.2 친선 대국
- 친구 상태에서만 초대 가능
- 초대 수신/수락/거절 모달
- 수락 후 매치 준비 완료 모달 -> 친선 대국 진입

### 7.3 악당 기능
- 악당 등록/해제
- 악당 관계 유저와 매칭/초대 차단

### 7.4 친구 기보 보기
- 친구별 대국 기록 화면으로 이동 가능

## 8. 대국 기록/복기 UI
`src/pages/ReplayList.jsx`, `src/pages/ReplayPage.jsx`

- 모드 필터 제공:
  - 승강급 대국
  - 친선 대국
  - AI 대국
- 결과 배지는 사용자 관점(win/loss) + 종료 방식 기반으로 표시
- 복기 페이지에서 move_log를 프레임으로 재구성

## 9. 다국어(i18n)
`src/context/LanguageContext.jsx`

- 지원 언어: `ko`, `en`
- 기본 언어: `ko`
- 저장 키: `janggi_language`

## 10. 중요 파일
- `src/App.jsx` – 라우팅, 리로드 복구, 강제 로그아웃 모달
- `src/context/AuthContext.jsx` – 토큰/세션 수명주기
- `src/pages/MainMenu.jsx` – 모드 카드, 진행 패널, 최근 대국, 채팅
- `src/pages/SocialPage.jsx` – 소셜 UI
- `src/pages/ReplayList.jsx` – 모드별 대국 기록 필터
- `src/components/Board.jsx` – 대국 상태 머신 + 모달 UI
- `src/hooks/useFriendlyMatchSocket.js`
- `src/hooks/useLobbyChatSocket.js`

## 11. 실행/빌드
```bash
cd frontend
npm install
npm run dev
npm run build
npm run preview
```

Docker Compose 기준 frontend는 `80` 포트로 서비스됩니다.
