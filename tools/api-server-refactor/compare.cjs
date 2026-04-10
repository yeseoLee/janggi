const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { once } = require('node:events');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_BACKEND_DIR = process.env.BASELINE_BACKEND_DIR || '/tmp/janggi-api-server-baseline/api-server';
const PROJECT = process.env.REFACTOR_BENCH_PROJECT || 'janggi-api-server-refactor';
const PORTS = {
  baseline: 3301,
  refactor: 3302,
};
const COMPOSE_PATH = path.join(os.tmpdir(), 'janggi-api-server-refactor-compose.yml');
const REPORTS_DIR = path.join(ROOT, 'reports');
const RAW_RESULTS_PATH = path.join(REPORTS_DIR, 'api-server-refactor-results.json');
const REPORT_PATH = path.join(REPORTS_DIR, 'api-server-refactor-report.md');

const frontendRequire = createRequire(path.join(ROOT, 'frontend', 'package.json'));
const { io } = frontendRequire('socket.io-client');

const BOARD = (() => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[0][0] = { team: 'han', type: 'cha' };
  board[0][1] = { team: 'han', type: 'ma' };
  board[0][2] = { team: 'han', type: 'sang' };
  board[0][3] = { team: 'han', type: 'sa' };
  board[0][5] = { team: 'han', type: 'sa' };
  board[0][6] = { team: 'han', type: 'sang' };
  board[0][7] = { team: 'han', type: 'ma' };
  board[0][8] = { team: 'han', type: 'cha' };
  board[1][4] = { team: 'han', type: 'wang' };
  board[2][1] = { team: 'han', type: 'po' };
  board[2][7] = { team: 'han', type: 'po' };
  board[3][0] = { team: 'han', type: 'jol' };
  board[3][2] = { team: 'han', type: 'jol' };
  board[3][4] = { team: 'han', type: 'jol' };
  board[3][6] = { team: 'han', type: 'jol' };
  board[3][8] = { team: 'han', type: 'jol' };
  board[6][0] = { team: 'cho', type: 'jol' };
  board[6][2] = { team: 'cho', type: 'jol' };
  board[6][4] = { team: 'cho', type: 'jol' };
  board[6][6] = { team: 'cho', type: 'jol' };
  board[6][8] = { team: 'cho', type: 'jol' };
  board[7][1] = { team: 'cho', type: 'po' };
  board[7][7] = { team: 'cho', type: 'po' };
  board[8][4] = { team: 'cho', type: 'wang' };
  board[9][0] = { team: 'cho', type: 'cha' };
  board[9][1] = { team: 'cho', type: 'ma' };
  board[9][2] = { team: 'cho', type: 'sang' };
  board[9][3] = { team: 'cho', type: 'sa' };
  board[9][5] = { team: 'cho', type: 'sa' };
  board[9][6] = { team: 'cho', type: 'sang' };
  board[9][7] = { team: 'cho', type: 'ma' };
  board[9][8] = { team: 'cho', type: 'cha' };
  return board;
})();

function logStep(message) {
  console.log(`[refactor-compare] ${message}`);
}

function sh(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl(kind) {
  return `http://127.0.0.1:${PORTS[kind]}`;
}

function ensureBaseline() {
  if (!fs.existsSync(BASELINE_BACKEND_DIR)) {
    throw new Error(`Baseline api-server snapshot not found at ${BASELINE_BACKEND_DIR}`);
  }
}

function writeComposeFile() {
  const compose = `services:
  postgres-baseline:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: janggi_user
      POSTGRES_PASSWORD: janggi_password
      POSTGRES_DB: janggi_db
    volumes:
      - ${path.join(BASELINE_BACKEND_DIR, 'init.sql')}:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U janggi_user -d janggi_db"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 5s

  postgres-refactor:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: janggi_user
      POSTGRES_PASSWORD: janggi_password
      POSTGRES_DB: janggi_db
    volumes:
      - ${path.join(ROOT, 'api-server', 'init.sql')}:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U janggi_user -d janggi_db"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 5s

  mock-ai:
    build: ${path.join(ROOT, 'tools', 'api-server-refactor', 'mock-ai')}

  api-server-baseline:
    build: ${BASELINE_BACKEND_DIR}
    environment:
      DB_HOST: postgres-baseline
      DB_USER: janggi_user
      DB_PASSWORD: janggi_password
      DB_NAME: janggi_db
      DB_PORT: 5432
      PORT: 3000
      AI_SERVICE_URL: http://mock-ai:4101
      AI_MOVE_TIME_MS: 700
      JWT_SECRET: secret_key
    depends_on:
      postgres-baseline:
        condition: service_healthy
      mock-ai:
        condition: service_started
    ports:
      - "${PORTS.baseline}:3000"

  api-server-refactor:
    build: ${path.join(ROOT, 'api-server')}
    environment:
      DB_HOST: postgres-refactor
      DB_USER: janggi_user
      DB_PASSWORD: janggi_password
      DB_NAME: janggi_db
      DB_PORT: 5432
      PORT: 3000
      AI_SERVICE_URL: http://mock-ai:4101
      AI_MOVE_TIME_MS: 700
      JWT_SECRET: secret_key
    depends_on:
      postgres-refactor:
        condition: service_healthy
      mock-ai:
        condition: service_started
    ports:
      - "${PORTS.refactor}:3000"
`;
  fs.writeFileSync(COMPOSE_PATH, compose);
}

function dockerCompose(args, options = {}) {
  return sh('docker', ['compose', '-p', PROJECT, '-f', COMPOSE_PATH, ...args], options);
}

async function fetchJson(baseUrlValue, pathname, { method = 'GET', token, body, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrlValue}${pathname}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer(baseUrlValue) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetchJson(baseUrlValue, '/api/ready-check');
      if (response.status === 404) {
        return;
      }
    } catch {}
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${baseUrlValue}`);
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if ([
        'token', 'started_at', 'ended_at', 'played_at', 'created_at', 'updated_at',
        'at', 'room', 'roomId', 'inviteId', 'matchId', 'deadlineAt', 'startedAt',
        'updatedAt', 'id', 'pid', 'cancelledBy',
      ].includes(key)) {
        continue;
      }
      if (key === 'moves' && typeof entry === 'string') {
        try {
          output[key] = normalizeValue(JSON.parse(entry));
          continue;
        } catch {}
      }
      output[key] = normalizeValue(entry);
    }
    return output;
  }
  return value;
}

function sortByJson(values) {
  return [...values].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function simplifyMatchFound(payload) {
  return {
    mode: payload?.mode || null,
    opponent: normalizeValue(payload?.opponent || null),
  };
}

function simplifyReady(payload) {
  return {
    opponent: normalizeValue(payload?.opponent || null),
  };
}

function simplifySetupTimer(payload) {
  return payload ? { durationMs: payload.durationMs } : null;
}

function simplifyOpponentSetup(payload) {
  return payload ? { setupType: payload.setupType } : null;
}

function simplifyMove(payload) {
  return normalizeValue(payload);
}

function simplifyPass(payload) {
  return payload ? { present: true } : null;
}

function simplifyGameOver(payload) {
  return payload ? normalizeValue(payload) : null;
}

function simplifyFriendGamesResponse(response) {
  return {
    status: response.status,
    json: {
      friend: normalizeValue(response.json?.friend || null),
      games: (response.json?.games || []).map((game) => ({
        game_mode: game.game_mode,
        result_type: game.result_type,
        move_count: game.move_count,
        my_result: game.my_result,
        opponent_name: game.opponent_name,
        winner_name: game.winner_name,
        loser_name: game.loser_name,
      })),
    },
  };
}

function createSocket(baseUrlValue, token) {
  return io(baseUrlValue, {
    auth: { token },
    reconnection: false,
    timeout: 5000,
  });
}

function waitForEvent(socket, eventName, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timer);
      socket.off(eventName, onEvent);
      resolve(payload);
    };
    socket.on(eventName, onEvent);
  });
}

function emitAck(socket, eventName, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ack ${eventName}`)), timeoutMs);
    socket.emit(eventName, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function registerUser(baseUrlValue, username, nickname) {
  const password = 'pw1234';
  const register = await fetchJson(baseUrlValue, '/api/auth/register', {
    method: 'POST',
    body: { username, password, nickname },
  });
  const login = await fetchJson(baseUrlValue, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(register.status, 201);
  assert.equal(login.status, 200);
  return { password, register, login, token: login.json.token, user: login.json.user };
}

async function prepareUsers(baseUrlValue, prefix, names) {
  const users = {};
  for (const name of names) {
    users[name] = await registerUser(baseUrlValue, `${prefix}_${name}`, `${prefix}-${name}`);
  }
  return users;
}

async function createFriendRequest(baseUrlValue, requester, addressee) {
  const requestResponse = await fetchJson(baseUrlValue, '/api/social/friends', {
    method: 'POST',
    token: requester.token,
    body: { targetUserId: addressee.user.id },
  });
  const requests = await fetchJson(baseUrlValue, '/api/social/friend-requests', {
    token: addressee.token,
  });
  return {
    requestResponse,
    incomingRequests: requests,
    requestId: requests.json.incoming[0]?.id,
  };
}

async function makeFriends(baseUrlValue, requester, addressee) {
  const step = await createFriendRequest(baseUrlValue, requester, addressee);
  const accept = await fetchJson(baseUrlValue, `/api/social/friend-requests/${step.requestId}/accept`, {
    method: 'POST',
    token: addressee.token,
  });
  return { ...step, accept };
}

async function rejectFriendRequest(baseUrlValue, requester, addressee) {
  const step = await createFriendRequest(baseUrlValue, requester, addressee);
  const reject = await fetchJson(baseUrlValue, `/api/social/friend-requests/${step.requestId}/reject`, {
    method: 'POST',
    token: addressee.token,
  });
  return { ...step, reject };
}

async function connectPair(baseUrlValue, leftToken, rightToken) {
  const left = createSocket(baseUrlValue, leftToken);
  const right = createSocket(baseUrlValue, rightToken);
  await Promise.all([once(left, 'connect'), once(right, 'connect')]);
  return { left, right };
}

function closeSockets(...sockets) {
  for (const socket of sockets) {
    if (socket) socket.disconnect();
  }
}

async function setupGame(room, socketsByTeam) {
  const timerHan = waitForEvent(socketsByTeam.han, 'setup_timer_sync');
  socketsByTeam.han.emit('setup_phase_started', { room, team: 'han' });
  const hanTimerPayload = await timerHan;

  const choOpponentSetup = waitForEvent(socketsByTeam.cho, 'opponent_setup');
  socketsByTeam.han.emit('submit_setup', { room, team: 'han', setupType: 'won' });
  const hanSetupSeenByCho = await choOpponentSetup;

  const timerCho = waitForEvent(socketsByTeam.cho, 'setup_timer_sync');
  socketsByTeam.cho.emit('setup_phase_started', { room, team: 'cho' });
  const choTimerPayload = await timerCho;

  const hanOpponentSetup = waitForEvent(socketsByTeam.han, 'opponent_setup');
  const clockSyncHan = waitForEvent(socketsByTeam.han, 'clock_sync');
  const clockSyncCho = waitForEvent(socketsByTeam.cho, 'clock_sync');
  socketsByTeam.cho.emit('submit_setup', { room, team: 'cho', setupType: 'won' });

  return {
    hanTimerPayload: simplifySetupTimer(hanTimerPayload),
    hanSetupSeenByCho: simplifyOpponentSetup(hanSetupSeenByCho),
    choTimerPayload: simplifySetupTimer(choTimerPayload),
    choSetupSeenByHan: simplifyOpponentSetup(await hanOpponentSetup),
    clockSync: sortByJson([normalizeValue(await clockSyncHan), normalizeValue(await clockSyncCho)]),
  };
}

function byTeam(socketA, matchFoundA, socketB, matchFoundB) {
  return {
    [matchFoundA.team]: socketA,
    [matchFoundB.team]: socketB,
  };
}

async function runFriendlyDeclineScenario(baseUrlValue, leftUser, rightUser) {
  const { left, right } = await connectPair(baseUrlValue, leftUser.token, rightUser.token);
  try {
    const inviteReceived = waitForEvent(right, 'friendly_invite_received');
    const sendAck = await emitAck(left, 'friendly_invite_send', { targetUserId: rightUser.user.id });
    const receivedPayload = await inviteReceived;
    const declinedEvent = waitForEvent(left, 'friendly_invite_declined');
    const declineAck = await emitAck(right, 'friendly_invite_decline', { inviteId: receivedPayload.inviteId });
    return {
      sendAck,
      receivedPayload,
      declineAck,
      declinedPayload: normalizeValue(await declinedEvent),
    };
  } finally {
    closeSockets(left, right);
  }
}

async function runFriendlyCancelScenario(baseUrlValue, leftUser, rightUser) {
  const { left, right } = await connectPair(baseUrlValue, leftUser.token, rightUser.token);
  try {
    const inviteReceived = waitForEvent(right, 'friendly_invite_received');
    const sendAck = await emitAck(left, 'friendly_invite_send', { targetUserId: rightUser.user.id });
    const receivedPayload = await inviteReceived;
    const leftReady = waitForEvent(left, 'friendly_match_ready');
    const rightReady = waitForEvent(right, 'friendly_match_ready');
    const acceptAck = await emitAck(right, 'friendly_invite_accept', { inviteId: receivedPayload.inviteId });
    const readyLeft = await leftReady;
    const readyRight = await rightReady;
    const leftMatchFound = waitForEvent(left, 'match_found');
    const rightMatchFound = waitForEvent(right, 'match_found');
    const joinAckLeft = await emitAck(left, 'join_friendly_match', { matchId: readyLeft.matchId });
    const joinAckRight = await emitAck(right, 'join_friendly_match', { matchId: readyRight.matchId });
    const matchFoundLeft = await leftMatchFound;
    const matchFoundRight = await rightMatchFound;
    const cancelledLeft = waitForEvent(left, 'match_cancelled');
    const cancelledRight = waitForEvent(right, 'match_cancelled');
    left.emit('cancel_match', { room: matchFoundLeft.room, reason: 'cancelled' });
    return {
      sendAck,
      receivedPayload: normalizeValue(receivedPayload),
      acceptAck,
      ready: sortByJson([simplifyReady(readyLeft), simplifyReady(readyRight)]),
      joinAck: sortByJson([normalizeValue(joinAckLeft), normalizeValue(joinAckRight)]),
      matchFound: sortByJson([simplifyMatchFound(matchFoundLeft), simplifyMatchFound(matchFoundRight)]),
      cancelled: sortByJson([normalizeValue(await cancelledLeft), normalizeValue(await cancelledRight)]),
    };
  } finally {
    closeSockets(left, right);
  }
}

async function runFriendlyScoreScenario(baseUrlValue, leftUser, rightUser) {
  const { left, right } = await connectPair(baseUrlValue, leftUser.token, rightUser.token);
  try {
    const inviteReceived = waitForEvent(right, 'friendly_invite_received');
    const sendAck = await emitAck(left, 'friendly_invite_send', { targetUserId: rightUser.user.id });
    const receivedPayload = await inviteReceived;
    const leftReady = waitForEvent(left, 'friendly_match_ready');
    const rightReady = waitForEvent(right, 'friendly_match_ready');
    const acceptAck = await emitAck(right, 'friendly_invite_accept', { inviteId: receivedPayload.inviteId });
    const readyLeft = await leftReady;
    const readyRight = await rightReady;
    const leftMatchFound = waitForEvent(left, 'match_found');
    const rightMatchFound = waitForEvent(right, 'match_found');
    await emitAck(left, 'join_friendly_match', { matchId: readyLeft.matchId });
    await emitAck(right, 'join_friendly_match', { matchId: readyRight.matchId });
    const matchFoundLeft = await leftMatchFound;
    const matchFoundRight = await rightMatchFound;
    const sockets = byTeam(left, matchFoundLeft, right, matchFoundRight);
    const winnerTeam = matchFoundRight.team;
    const setup = await setupGame(matchFoundLeft.room, sockets);

    const moveSeen = waitForEvent(sockets.han, 'move');
    sockets.cho.emit('move', { room: matchFoundLeft.room, move: { from: { r: 6, c: 0 }, to: { r: 5, c: 0 } } });
    const movePayload = await moveSeen;

    const passSeen = waitForEvent(sockets.cho, 'pass_turn');
    sockets.han.emit('pass', { room: matchFoundLeft.room });
    const passPayload = await passSeen;

    const gameOverCho = waitForEvent(sockets.cho, 'game_over');
    const gameOverHan = waitForEvent(sockets.han, 'game_over');
    sockets.cho.emit('finish_by_rule', { room: matchFoundLeft.room, winner: winnerTeam, type: 'score' });

    return {
      sendAck,
      receivedPayload: normalizeValue(receivedPayload),
      acceptAck,
      matchFound: sortByJson([simplifyMatchFound(matchFoundLeft), simplifyMatchFound(matchFoundRight)]),
      setup,
      movePayload: simplifyMove(movePayload),
      passPayload: simplifyPass(passPayload),
      gameOver: sortByJson([
        { type: (await gameOverCho).type },
        { type: (await gameOverHan).type },
      ]),
    };
  } finally {
    closeSockets(left, right);
  }
}

async function runRankedScenario(baseUrlValue, leftUser, rightUser, finishKind) {
  const { left, right } = await connectPair(baseUrlValue, leftUser.token, rightUser.token);
  try {
    const leftMatchFound = waitForEvent(left, 'match_found');
    const rightMatchFound = waitForEvent(right, 'match_found');
    left.emit('find_match', { ...leftUser.user, rank: '17급', wins: 5, losses: 1 });
    right.emit('find_match', { ...rightUser.user, rank: '18급', wins: 1, losses: 5 });

    const matchFoundLeft = await leftMatchFound;
    const matchFoundRight = await rightMatchFound;
    const room = matchFoundLeft.room;
    const sockets = byTeam(left, matchFoundLeft, right, matchFoundRight);
    const setup = await setupGame(room, sockets);

    let movePayload = null;
    let passPayload = null;
    if (finishKind === 'resign') {
      const moveSeen = waitForEvent(sockets.han, 'move');
      sockets.cho.emit('move', { room, move: { from: { r: 6, c: 0 }, to: { r: 5, c: 0 } } });
      movePayload = await moveSeen;

      const passSeen = waitForEvent(sockets.cho, 'pass_turn');
      sockets.han.emit('pass', { room });
      passPayload = await passSeen;
    }

    const gameOverCho = waitForEvent(sockets.cho, 'game_over');
    const gameOverHan = finishKind === 'disconnect'
      ? null
      : waitForEvent(sockets.han, 'game_over');

    if (finishKind === 'resign') {
      sockets.han.emit('resign', { room });
    } else if (finishKind === 'checkmate') {
      sockets.cho.emit('checkmate', { room, winner: 'han' });
    } else if (finishKind === 'disconnect') {
      sockets.han.disconnect();
    } else {
      throw new Error(`Unknown finish kind ${finishKind}`);
    }

    return {
      matchFound: sortByJson([simplifyMatchFound(matchFoundLeft), simplifyMatchFound(matchFoundRight)]),
      setup,
      movePayload: simplifyMove(movePayload),
      passPayload: simplifyPass(passPayload),
      gameOver: sortByJson(
        [simplifyGameOver(await gameOverCho), gameOverHan ? simplifyGameOver(await gameOverHan) : null].filter(Boolean),
      ),
    };
  } finally {
    closeSockets(left, right);
  }
}

async function runScenario(baseUrlValue, prefix) {
  await waitForServer(baseUrlValue);

  const registerSample = await registerUser(baseUrlValue, `${prefix}_sample`, `${prefix}-sample`);
  const users = await prepareUsers(baseUrlValue, prefix, ['alice', 'bob', 'charlie', 'dave', 'eve', 'frank', 'grace', 'heidi', 'ivan', 'judy']);

  const accepted = await makeFriends(baseUrlValue, users.alice, users.bob);
  const rejected = await rejectFriendRequest(baseUrlValue, users.charlie, users.dave);
  await makeFriends(baseUrlValue, users.grace, users.heidi);
  await makeFriends(baseUrlValue, users.ivan, users.judy);
  await makeFriends(baseUrlValue, users.eve, users.frank);

  const me = await fetchJson(baseUrlValue, '/api/user/me', { token: users.alice.token });
  const search = await fetchJson(baseUrlValue, '/api/social/users/search?q=bob', { token: users.alice.token });
  const friends = await fetchJson(baseUrlValue, '/api/social/friends', { token: users.alice.token });
  const villainsAdd = await fetchJson(baseUrlValue, '/api/social/villains', {
    method: 'POST',
    token: users.alice.token,
    body: { targetUserId: users.charlie.user.id },
  });
  const villains = await fetchJson(baseUrlValue, '/api/social/villains', { token: users.alice.token });
  const villainsDelete = await fetchJson(baseUrlValue, `/api/social/villains/${users.charlie.user.id}`, {
    method: 'DELETE',
    token: users.alice.token,
  });
  const spend = await fetchJson(baseUrlValue, '/api/coins/spend-ai-match', {
    method: 'POST',
    token: users.alice.token,
  });
  const recharge = await fetchJson(baseUrlValue, '/api/coins/recharge', {
    method: 'POST',
    token: users.alice.token,
  });
  const aiMove = await fetchJson(baseUrlValue, '/api/ai/move', {
    method: 'POST',
    token: users.alice.token,
    body: { board: BOARD, turn: 'cho', aiTier: 0 },
  });
  const aiSave = await fetchJson(baseUrlValue, '/api/games/ai', {
    method: 'POST',
    token: users.alice.token,
    body: {
      myTeam: 'cho',
      winnerTeam: 'cho',
      choSetup: 'won',
      hanSetup: 'won',
      moveLog: [{ type: 'move', turn: 'cho', from: { r: 6, c: 0 }, to: { r: 5, c: 0 }, at: new Date('2026-04-10T12:00:00Z').toISOString() }],
      resultType: 'checkmate',
      startedAt: new Date('2026-04-10T12:00:00Z').toISOString(),
      endedAt: new Date('2026-04-10T12:10:00Z').toISOString(),
      aiTier: 0,
    },
  });

  logStep(`friendly decline scenario for ${baseUrlValue}`);
  const friendlyDecline = await runFriendlyDeclineScenario(baseUrlValue, users.grace, users.heidi);
  logStep(`friendly cancel scenario for ${baseUrlValue}`);
  const friendlyCancel = await runFriendlyCancelScenario(baseUrlValue, users.grace, users.heidi);
  logStep(`friendly score scenario for ${baseUrlValue}`);
  const friendlyScore = await runFriendlyScoreScenario(baseUrlValue, users.ivan, users.judy);
  logStep(`ranked resign scenario for ${baseUrlValue}`);
  const rankedResign = await runRankedScenario(baseUrlValue, users.alice, users.bob, 'resign');
  logStep(`ranked checkmate scenario for ${baseUrlValue}`);
  const rankedCheckmate = await runRankedScenario(baseUrlValue, users.charlie, users.dave, 'checkmate');
  logStep(`ranked disconnect scenario for ${baseUrlValue}`);
  const rankedDisconnect = await runRankedScenario(baseUrlValue, users.eve, users.frank, 'disconnect');

  const friendGames = simplifyFriendGamesResponse(await fetchJson(baseUrlValue, `/api/social/friends/${users.judy.user.id}/games`, {
    token: users.ivan.token,
  }));
  const games = await fetchJson(baseUrlValue, '/api/games', { token: users.alice.token });
  const gameDetail = await fetchJson(baseUrlValue, `/api/games/${games.json[0].id}`, { token: users.alice.token });
  const deleteFriend = await fetchJson(baseUrlValue, `/api/social/friends/${users.bob.user.id}`, {
    method: 'DELETE',
    token: users.alice.token,
  });
  const deleteMe = await fetchJson(baseUrlValue, '/api/auth/me', {
    method: 'DELETE',
    token: registerSample.token,
  });
  const noRoute = await fetchJson(baseUrlValue, '/api/ready-check');

  return {
    rest: {
      register: registerSample.register,
      login: registerSample.login,
      me,
      search,
      addFriend: accepted.requestResponse,
      acceptFriend: accepted.accept,
      rejectFriend: rejected.reject,
      friendRequestsIncoming: accepted.incomingRequests,
      friends,
      villainsAdd,
      villains,
      villainsDelete,
      spend,
      recharge,
      aiMove,
      aiSave,
      friendGames,
      games,
      gameDetail,
      deleteFriend,
      deleteMe,
      noRoute,
    },
    socket: {
      friendlyDecline,
      friendlyCancel,
      friendlyScore,
      rankedResign,
      rankedCheckmate,
      rankedDisconnect,
    },
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(values) {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    avg: values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1),
  };
}

async function timeHttpRequest(baseUrlValue, pathname, options) {
  const start = performance.now();
  const result = await fetchJson(baseUrlValue, pathname, options);
  return { durationMs: performance.now() - start, result };
}

async function benchmarkHTTP(baseUrlValue, prefix) {
  let counter = 0;
  const unique = () => `${prefix}_${Date.now()}_${counter++}`;
  const fixedTimestamps = {
    startedAt: new Date('2026-04-10T12:00:00Z').toISOString(),
    endedAt: new Date('2026-04-10T12:10:00Z').toISOString(),
  };

  const scenarios = {
    register: async () => {
      const name = unique();
      return timeHttpRequest(baseUrlValue, '/api/auth/register', {
        method: 'POST',
        body: { username: `${name}_user`, password: 'pw1234', nickname: `${name}-nick` },
      });
    },
    login: async () => {
      const name = unique();
      await registerUser(baseUrlValue, `${name}_user`, `${name}-nick`);
      return timeHttpRequest(baseUrlValue, '/api/auth/login', {
        method: 'POST',
        body: { username: `${name}_user`, password: 'pw1234' },
      });
    },
    me: async () => {
      const name = unique();
      const user = await registerUser(baseUrlValue, `${name}_user`, `${name}-nick`);
      return timeHttpRequest(baseUrlValue, '/api/user/me', { token: user.token });
    },
    search: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      return timeHttpRequest(baseUrlValue, '/api/social/users/search?q=beta', { token: users.alpha.token });
    },
    friendRequests: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      await createFriendRequest(baseUrlValue, users.alpha, users.beta);
      return timeHttpRequest(baseUrlValue, '/api/social/friend-requests', { token: users.beta.token });
    },
    friends: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      await makeFriends(baseUrlValue, users.alpha, users.beta);
      return timeHttpRequest(baseUrlValue, '/api/social/friends', { token: users.alpha.token });
    },
    acceptFriend: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      const request = await createFriendRequest(baseUrlValue, users.alpha, users.beta);
      return timeHttpRequest(baseUrlValue, `/api/social/friend-requests/${request.requestId}/accept`, {
        method: 'POST',
        token: users.beta.token,
      });
    },
    rejectFriend: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      const request = await createFriendRequest(baseUrlValue, users.alpha, users.beta);
      return timeHttpRequest(baseUrlValue, `/api/social/friend-requests/${request.requestId}/reject`, {
        method: 'POST',
        token: users.beta.token,
      });
    },
    villainsAdd: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      return timeHttpRequest(baseUrlValue, '/api/social/villains', {
        method: 'POST',
        token: users.alpha.token,
        body: { targetUserId: users.beta.user.id },
      });
    },
    villains: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      await fetchJson(baseUrlValue, '/api/social/villains', {
        method: 'POST',
        token: users.alpha.token,
        body: { targetUserId: users.beta.user.id },
      });
      return timeHttpRequest(baseUrlValue, '/api/social/villains', { token: users.alpha.token });
    },
    villainsDelete: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      await fetchJson(baseUrlValue, '/api/social/villains', {
        method: 'POST',
        token: users.alpha.token,
        body: { targetUserId: users.beta.user.id },
      });
      return timeHttpRequest(baseUrlValue, `/api/social/villains/${users.beta.user.id}`, {
        method: 'DELETE',
        token: users.alpha.token,
      });
    },
    spend: async () => {
      const name = unique();
      const user = await registerUser(baseUrlValue, `${name}_user`, `${name}-nick`);
      return timeHttpRequest(baseUrlValue, '/api/coins/spend-ai-match', { method: 'POST', token: user.token });
    },
    recharge: async () => {
      const name = unique();
      const user = await registerUser(baseUrlValue, `${name}_user`, `${name}-nick`);
      return timeHttpRequest(baseUrlValue, '/api/coins/recharge', { method: 'POST', token: user.token });
    },
    aiMove: async () => {
      const name = unique();
      const user = await registerUser(baseUrlValue, `${name}_user`, `${name}-nick`);
      return timeHttpRequest(baseUrlValue, '/api/ai/move', {
        method: 'POST',
        token: user.token,
        body: { board: BOARD, turn: 'cho', aiTier: 0 },
      });
    },
    gamesAI: async () => {
      const name = unique();
      const user = await registerUser(baseUrlValue, `${name}_user`, `${name}-nick`);
      return timeHttpRequest(baseUrlValue, '/api/games/ai', {
        method: 'POST',
        token: user.token,
        body: {
          myTeam: 'cho',
          winnerTeam: 'cho',
          choSetup: 'won',
          hanSetup: 'won',
          moveLog: [{ type: 'move', turn: 'cho', from: { r: 6, c: 0 }, to: { r: 5, c: 0 }, at: fixedTimestamps.startedAt }],
          resultType: 'checkmate',
          startedAt: fixedTimestamps.startedAt,
          endedAt: fixedTimestamps.endedAt,
          aiTier: 0,
        },
      });
    },
    friendGames: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      await makeFriends(baseUrlValue, users.alpha, users.beta);
      return timeHttpRequest(baseUrlValue, `/api/social/friends/${users.beta.user.id}/games`, { token: users.alpha.token });
    },
    games: async () => {
      const name = unique();
      const user = await registerUser(baseUrlValue, `${name}_user`, `${name}-nick`);
      await fetchJson(baseUrlValue, '/api/games/ai', {
        method: 'POST',
        token: user.token,
        body: {
          myTeam: 'cho',
          winnerTeam: 'cho',
          choSetup: 'won',
          hanSetup: 'won',
          moveLog: [{ type: 'move', turn: 'cho', from: { r: 6, c: 0 }, to: { r: 5, c: 0 }, at: fixedTimestamps.startedAt }],
          resultType: 'checkmate',
          startedAt: fixedTimestamps.startedAt,
          endedAt: fixedTimestamps.endedAt,
          aiTier: 0,
        },
      });
      return timeHttpRequest(baseUrlValue, '/api/games', { token: user.token });
    },
    gameDetail: async () => {
      const name = unique();
      const user = await registerUser(baseUrlValue, `${name}_user`, `${name}-nick`);
      await fetchJson(baseUrlValue, '/api/games/ai', {
        method: 'POST',
        token: user.token,
        body: {
          myTeam: 'cho',
          winnerTeam: 'cho',
          choSetup: 'won',
          hanSetup: 'won',
          moveLog: [{ type: 'move', turn: 'cho', from: { r: 6, c: 0 }, to: { r: 5, c: 0 }, at: fixedTimestamps.startedAt }],
          resultType: 'checkmate',
          startedAt: fixedTimestamps.startedAt,
          endedAt: fixedTimestamps.endedAt,
          aiTier: 0,
        },
      });
      const games = await fetchJson(baseUrlValue, '/api/games', { token: user.token });
      return timeHttpRequest(baseUrlValue, `/api/games/${games.json[0].id}`, { token: user.token });
    },
    deleteFriend: async () => {
      const name = unique();
      const users = await prepareUsers(baseUrlValue, name, ['alpha', 'beta']);
      await makeFriends(baseUrlValue, users.alpha, users.beta);
      return timeHttpRequest(baseUrlValue, `/api/social/friends/${users.beta.user.id}`, {
        method: 'DELETE',
        token: users.alpha.token,
      });
    },
    deleteMe: async () => {
      const name = unique();
      const user = await registerUser(baseUrlValue, `${name}_user`, `${name}-nick`);
      return timeHttpRequest(baseUrlValue, '/api/auth/me', { method: 'DELETE', token: user.token });
    },
    noRoute: async () => timeHttpRequest(baseUrlValue, '/api/ready-check'),
  };

  const results = {};
  for (const [name, fn] of Object.entries(scenarios)) {
    const samples = [];
    for (let i = 0; i < 2; i += 1) {
      const { durationMs } = await fn();
      samples.push(durationMs);
    }
    results[name] = summarize(samples);
  }
  return results;
}

function countLoc(dir, patterns) {
  const files = collectFiles(dir, patterns);
  return files.reduce((sum, file) => sum + fs.readFileSync(file, 'utf8').split('\n').length, 0);
}

function collectFiles(dir, patterns) {
  const matchers = patterns.map((pattern) => globToRegex(pattern));
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(dir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (matchers.some((matcher) => matcher.test(relative))) {
        files.push(full);
      }
    }
  }
  visit(dir);
  return files;
}

function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function parseGoDependencies(dir) {
  const goMod = fs.readFileSync(path.join(dir, 'go.mod'), 'utf8');
  let inRequireBlock = false;
  let direct = 0;
  for (const rawLine of goMod.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }
    if (line.startsWith('require ') && !line.includes('// indirect')) {
      direct += 1;
      continue;
    }
    if (inRequireBlock && !line.includes('// indirect')) {
      direct += 1;
    }
  }
  const modules = sh('go', ['list', '-m', 'all'], { cwd: dir }).split('\n').filter(Boolean);
  return {
    direct,
    transitive: Math.max(0, modules.length - 1 - direct),
  };
}

function parseCoverage(dir) {
  const profilePath = path.join(os.tmpdir(), `api-server-cover-${Date.now()}-${Math.random().toString(36).slice(2)}.out`);
  try {
    const packages = sh('go', ['list', './...'], { cwd: dir })
      .split('\n')
      .filter(Boolean)
      .filter((pkg) => !pkg.includes('/cmd/'));
    sh('go', ['test', `-coverprofile=${profilePath}`, ...packages], { cwd: dir });
    const output = sh('go', ['tool', 'cover', `-func=${profilePath}`], { cwd: dir });
    const match = output.match(/total:\s+\(statements\)\s+([0-9.]+)%/);
    return match ? Number(match[1]) : 0;
  } finally {
    if (fs.existsSync(profilePath)) {
      fs.unlinkSync(profilePath);
    }
  }
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

function buildReport(results) {
  const { baselineMetrics, refactorMetrics, httpBenchmark } = results;
  const lines = [];
  lines.push('# API Server Refactor Report', '');
  lines.push(`Generated: ${new Date().toISOString()}`, '');
  lines.push('## Equivalence');
  lines.push('| Check | Result |');
  lines.push('| --- | --- |');
  lines.push(`| Full HTTP + Socket scenario parity | ${results.equivalencePassed ? 'PASS' : 'FAIL'} |`, '');

  lines.push('## Structure');
  lines.push('| Metric | Baseline api-server | Refactored api-server |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Code lines | ${baselineMetrics.loc} | ${refactorMetrics.loc} |`);
  lines.push(`| Code files | ${baselineMetrics.files} | ${refactorMetrics.files} |`);
  lines.push(`| Direct deps | ${baselineMetrics.deps.direct} | ${refactorMetrics.deps.direct} |`);
  lines.push(`| Transitive deps | ${baselineMetrics.deps.transitive} | ${refactorMetrics.deps.transitive} |`);
  lines.push(`| Test coverage | ${baselineMetrics.coverage.toFixed(1)}% | ${refactorMetrics.coverage.toFixed(1)}% |`, '');

  lines.push('## HTTP Latency');
  lines.push('| Endpoint | Baseline p50 | Baseline p95 | Refactor p50 | Refactor p95 |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const [name, baseline] of Object.entries(httpBenchmark.baseline)) {
    const refactor = httpBenchmark.refactor[name];
    lines.push(`| ${name} | ${formatMs(baseline.p50)} | ${formatMs(baseline.p95)} | ${formatMs(refactor.p50)} | ${formatMs(refactor.p95)} |`);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  ensureBaseline();
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  writeComposeFile();

  logStep('starting comparison stack');
  dockerCompose(['up', '--build', '-d']);

  try {
    logStep('waiting for both backends');
    await Promise.all([waitForServer(baseUrl('baseline')), waitForServer(baseUrl('refactor'))]);

    logStep('running equivalence scenario');
    const prefix = `eq_${Date.now()}`;
    const baselineScenario = await runScenario(baseUrl('baseline'), prefix);
    logStep('baseline scenario complete');
    const refactorScenario = await runScenario(baseUrl('refactor'), prefix);
    logStep('refactor scenario complete');
    assert.deepStrictEqual(normalizeValue(refactorScenario), normalizeValue(baselineScenario));
    logStep('equivalence check passed');

    logStep('running HTTP benchmarks');
    const httpBenchmark = {
      baseline: await benchmarkHTTP(baseUrl('baseline'), `bench_base_${Date.now()}`),
      refactor: await benchmarkHTTP(baseUrl('refactor'), `bench_ref_${Date.now()}`),
    };
    logStep('benchmarks complete');

    const baselineMetrics = {
      loc: countLoc(BASELINE_BACKEND_DIR, ['*.go', 'init.sql']),
      files: collectFiles(BASELINE_BACKEND_DIR, ['*.go', 'init.sql']).length,
      deps: parseGoDependencies(BASELINE_BACKEND_DIR),
      coverage: parseCoverage(BASELINE_BACKEND_DIR),
    };
    const refactorMetrics = {
      loc: countLoc(path.join(ROOT, 'api-server'), ['**/*.go', 'init.sql']),
      files: collectFiles(path.join(ROOT, 'api-server'), ['**/*.go', 'init.sql']).length,
      deps: parseGoDependencies(path.join(ROOT, 'api-server')),
      coverage: parseCoverage(path.join(ROOT, 'api-server')),
    };

    const results = {
      equivalencePassed: true,
      baselineMetrics,
      refactorMetrics,
      httpBenchmark,
    };
    fs.writeFileSync(RAW_RESULTS_PATH, JSON.stringify(results, null, 2));
    fs.writeFileSync(REPORT_PATH, buildReport(results));
    logStep(`report written to ${REPORT_PATH}`);
  } finally {
    logStep('stopping comparison stack');
    try {
      dockerCompose(['down', '-v']);
    } catch (error) {
      console.error(error.message);
    }
    if (fs.existsSync(COMPOSE_PATH)) {
      fs.unlinkSync(COMPOSE_PATH);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
