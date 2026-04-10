const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { once } = require('node:events');
const frontendRequire = createRequire(path.join(__dirname, '..', 'frontend', 'package.json'));
const { io } = frontendRequire('socket.io-client');

function logStep(message) {
  console.log(`[equivalence] ${message}`);
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(baseUrl, pathname, { method = 'GET', token, body, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: controller.signal,
    body: body ? JSON.stringify(body) : undefined,
  });
  clearTimeout(timer);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_err) {
    json = text;
  }
  return { status: response.status, json };
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetchJson(baseUrl, '/api/ready-check');
      if (response.status === 404) {
        return;
      }
    } catch (_err) {}
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function waitForAI(baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetchJson(baseUrl, '/health');
      if (response.status === 200) {
        return;
      }
    } catch (_err) {}
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for AI ${baseUrl}`);
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (['token', 'started_at', 'ended_at', 'played_at', 'created_at', 'updated_at', 'at', 'room', 'roomId', 'inviteId', 'matchId', 'deadlineAt', 'startedAt', 'updatedAt', 'pid', 'id'].includes(key)) {
        continue;
      }
      if (key === 'moves' && typeof entry === 'string') {
        try {
          output[key] = normalizeValue(JSON.parse(entry));
          continue;
        } catch (_err) {}
      }
      output[key] = normalizeValue(entry);
    }
    return output;
  }
  return value;
}

function createSocket(baseUrl, token) {
  return io(baseUrl, {
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

async function registerAndLogin(baseUrl, username, nickname) {
  const password = 'pw1234';
  const register = await fetchJson(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: { username, password, nickname },
  });
  assert.equal(register.status, 201);
  const login = await fetchJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(login.status, 200);
  return login.json;
}

async function prepareUsers(baseUrl, prefix) {
  const names = ['alice', 'bob', 'charlie', 'dave', 'eve', 'frank', 'grace', 'heidi', 'ivan', 'judy'];
  const users = {};
  for (const name of names) {
    users[name] = await registerAndLogin(baseUrl, `${prefix}_${name}`, `${prefix}-${name}`);
  }
  return users;
}

async function setupFriendly(users, baseUrl) {
  const alice = users.alice;
  const bob = users.bob;

  await fetchJson(baseUrl, '/api/social/friends', {
    method: 'POST',
    token: alice.token,
    body: { targetUserId: bob.user.id },
  });
  const requests = await fetchJson(baseUrl, '/api/social/friend-requests', {
    token: bob.token,
  });
  const requestId = requests.json.incoming[0].id;
  await fetchJson(baseUrl, `/api/social/friend-requests/${requestId}/accept`, {
    method: 'POST',
    token: bob.token,
  });
}

async function runBackendScenario(baseUrl, prefix) {
  logStep(`waiting for backend ${prefix}`);
  await waitForServer(baseUrl);
  logStep(`preparing users for ${prefix}`);
  const users = await prepareUsers(baseUrl, prefix);
  logStep(`setting up friends for ${prefix}`);
  await setupFriendly(users, baseUrl);

  logStep(`running REST flow for ${prefix}`);
  const me = await fetchJson(baseUrl, '/api/user/me', { token: users.alice.token });
  const search = await fetchJson(baseUrl, '/api/social/users/search?q=bob', { token: users.alice.token });
  const friends = await fetchJson(baseUrl, '/api/social/friends', { token: users.alice.token });
  const villainsAdd = await fetchJson(baseUrl, '/api/social/villains', {
    method: 'POST',
    token: users.alice.token,
    body: { targetUserId: users.charlie.user.id },
  });
  const villains = await fetchJson(baseUrl, '/api/social/villains', { token: users.alice.token });
  const villainsDelete = await fetchJson(baseUrl, `/api/social/villains/${users.charlie.user.id}`, {
    method: 'DELETE',
    token: users.alice.token,
  });
  const spend = await fetchJson(baseUrl, '/api/coins/spend-ai-match', {
    method: 'POST',
    token: users.alice.token,
  });
  const recharge = await fetchJson(baseUrl, '/api/coins/recharge', {
    method: 'POST',
    token: users.alice.token,
  });
  const aiMove = await fetchJson(baseUrl, '/api/ai/move', {
    method: 'POST',
    token: users.alice.token,
    body: { board: BOARD, turn: 'cho', aiTier: 0 },
  });
  const aiSave = await fetchJson(baseUrl, '/api/games/ai', {
    method: 'POST',
    token: users.alice.token,
    body: {
      myTeam: 'cho',
      winnerTeam: 'cho',
      choSetup: 'won',
      hanSetup: 'won',
      moveLog: [{ type: 'move', turn: 'cho', from: { r: 6, c: 0 }, to: { r: 5, c: 0 }, at: new Date().toISOString() }],
      resultType: 'checkmate',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      aiTier: 0,
    },
  });

  logStep(`opening ranked sockets for ${prefix}`);
  const aliceSocket = createSocket(baseUrl, users.alice.token);
  const bobSocket = createSocket(baseUrl, users.bob.token);
  await Promise.all([once(aliceSocket, 'connect'), once(bobSocket, 'connect')]);

  const aliceUserInfo = { ...users.alice.user, rank: '17급' };
  const bobUserInfo = { ...users.bob.user, rank: '18급' };
  const aliceMatchFound = waitForEvent(aliceSocket, 'match_found');
  const bobMatchFound = waitForEvent(bobSocket, 'match_found');
  aliceSocket.emit('find_match', aliceUserInfo);
  bobSocket.emit('find_match', bobUserInfo);
  const aliceMatch = await aliceMatchFound;
  const bobMatch = await bobMatchFound;

  logStep(`playing ranked socket flow for ${prefix}`);
  const room = aliceMatch.room;
  const choSocket = aliceMatch.team === 'cho' ? aliceSocket : bobSocket;
  const hanSocket = aliceMatch.team === 'han' ? aliceSocket : bobSocket;
  const choMatch = aliceMatch.team === 'cho' ? aliceMatch : bobMatch;
  const hanMatch = aliceMatch.team === 'han' ? aliceMatch : bobMatch;

  const setupTimerSync = waitForEvent(hanSocket, 'setup_timer_sync');
  hanSocket.emit('setup_phase_started', { room, team: 'han' });
  const setupTimerPayload = await setupTimerSync;
  const opponentSetupForCho = waitForEvent(choSocket, 'opponent_setup');
  hanSocket.emit('submit_setup', { room, team: 'han', setupType: 'won' });
  await opponentSetupForCho;
  const opponentSetupForHan = waitForEvent(hanSocket, 'opponent_setup');
  const choClockSync = waitForEvent(choSocket, 'clock_sync');
  choSocket.emit('submit_setup', { room, team: 'cho', setupType: 'won' });
  await opponentSetupForHan;
  const clockSyncPayload = await choClockSync;

  const moveRelay = waitForEvent(choSocket === aliceSocket ? bobSocket : aliceSocket, 'move');
  choSocket.emit('move', { room, move: { from: { r: 6, c: 0 }, to: { r: 5, c: 0 } } });
  const movePayload = await moveRelay;
  const passRelay = waitForEvent(choSocket, 'pass_turn');
  hanSocket.emit('pass', { room });
  const passPayload = await passRelay;
  const gameOverAlice = waitForEvent(aliceSocket, 'game_over');
  const gameOverBob = waitForEvent(bobSocket, 'game_over');
  choSocket.emit('resign', { room });
  const onlineGameOver = await Promise.all([gameOverAlice, gameOverBob]);

  aliceSocket.disconnect();
  bobSocket.disconnect();

  logStep(`opening friendly sockets for ${prefix}`);
  const inviteSender = createSocket(baseUrl, users.alice.token);
  const inviteReceiver = createSocket(baseUrl, users.bob.token);
  await Promise.all([once(inviteSender, 'connect'), once(inviteReceiver, 'connect')]);
  const inviteReceived = waitForEvent(inviteReceiver, 'friendly_invite_received');
  const inviteAck = await emitAck(inviteSender, 'friendly_invite_send', { targetUserId: users.bob.user.id });
  const invitePayload = await inviteReceived;
  const matchReadyForSender = waitForEvent(inviteSender, 'friendly_match_ready');
  const matchReadyForReceiver = waitForEvent(inviteReceiver, 'friendly_match_ready');
  const acceptAck = await emitAck(inviteReceiver, 'friendly_invite_accept', { inviteId: invitePayload.inviteId });
  const senderReady = await matchReadyForSender;
  const receiverReady = await matchReadyForReceiver;
  const senderJoinFound = waitForEvent(inviteSender, 'match_found');
  const receiverJoinFound = waitForEvent(inviteReceiver, 'match_found');
  const senderJoinAck = await emitAck(inviteSender, 'join_friendly_match', { matchId: senderReady.matchId });
  const receiverJoinAck = await emitAck(inviteReceiver, 'join_friendly_match', { matchId: receiverReady.matchId });
  const senderFriendlyMatch = await senderJoinFound;
  const receiverFriendlyMatch = await receiverJoinFound;
  inviteSender.disconnect();
  inviteReceiver.disconnect();

  logStep(`collecting replay data for ${prefix}`);
  const friendGames = await fetchJson(baseUrl, `/api/social/friends/${users.bob.user.id}/games`, {
    token: users.alice.token,
  });
  const games = await fetchJson(baseUrl, '/api/games', { token: users.alice.token });
  const aiGame = games.json.find((game) => game.game_mode === 'ai');
  const detail = await fetchJson(baseUrl, `/api/games/${aiGame.id}`, { token: users.alice.token });

  const deleteFriend = await fetchJson(baseUrl, `/api/social/friends/${users.bob.user.id}`, {
    method: 'DELETE',
    token: users.alice.token,
  });
  const deleteAccount = await fetchJson(baseUrl, '/api/auth/me', {
    method: 'DELETE',
    token: users.judy.token,
  });

  return normalizeValue({
    me: me.json,
    search: search.json,
    friends: friends.json,
    villainsAdd: villainsAdd.json,
    villains: villains.json,
    villainsDelete: villainsDelete.json,
    spend: spend.json,
    recharge: recharge.json,
    aiMove: aiMove.json,
    aiSave: aiSave.json,
    onlineMatch: {
      choTeam: choMatch.team,
      hanTeam: hanMatch.team,
      setupTimerPayload,
      clockSyncPayload,
      movePayload,
      passPayload,
      onlineGameOver,
    },
    friendly: {
      inviteAck,
      invitePayload,
      acceptAck,
      senderReady,
      receiverReady,
      senderJoinAck,
      receiverJoinAck,
      senderFriendlyMatch,
      receiverFriendlyMatch,
    },
    friendGames: friendGames.json,
    games: games.json,
    detail: detail.json,
    deleteFriend: deleteFriend.json,
    deleteAccount: deleteAccount.json,
  });
}

async function compareAI() {
  const fakeNodeBaseUrl = 'http://127.0.0.1:4202';
  const fakeGoBaseUrl = 'http://127.0.0.1:4203';
  const realNodeBaseUrl = 'http://127.0.0.1:4102';
  const realGoBaseUrl = 'http://127.0.0.1:4103';
  const fen = 'rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1';
  const body = {
    fen,
    depth: 4,
    movetime: 500,
    skillLevel: 0,
    useLimitStrength: false,
    uciElo: 1500,
  };

  logStep('waiting for fake ai servers');
  await Promise.all([waitForAI(fakeNodeBaseUrl), waitForAI(fakeGoBaseUrl)]);

  logStep('comparing fake ai health');
  const nodeHealth = await fetchJson(fakeNodeBaseUrl, '/health');
  const goHealth = await fetchJson(fakeGoBaseUrl, '/health');
  assert.equal(nodeHealth.status, 200);
  assert.equal(goHealth.status, 200);
  assert.deepEqual(normalizeValue(goHealth.json), normalizeValue(nodeHealth.json));

  logStep('comparing fake ai move');
  const nodeMove = await fetchJson(fakeNodeBaseUrl, '/move', { method: 'POST', body });
  const goMove = await fetchJson(fakeGoBaseUrl, '/move', { method: 'POST', body });
  assert.equal(nodeMove.status, 200);
  assert.equal(goMove.status, 200);
  assert.deepEqual(normalizeValue(goMove.json), normalizeValue(nodeMove.json));
  console.log('AI fake-engine equivalence passed');

  logStep('waiting for real ai servers');
  await Promise.all([waitForAI(realNodeBaseUrl), waitForAI(realGoBaseUrl)]);
  const realNodeHealth = await fetchJson(realNodeBaseUrl, '/health');
  const realGoHealth = await fetchJson(realGoBaseUrl, '/health');
  assert.equal(realNodeHealth.status, 200);
  assert.equal(realGoHealth.status, 200);

  logStep('running real ai smoke');
  const realNodeMove = await fetchJson(realNodeBaseUrl, '/move', { method: 'POST', body });
  const realGoMove = await fetchJson(realGoBaseUrl, '/move', { method: 'POST', body });
  assert.equal(realNodeMove.status, 200);
  assert.equal(realGoMove.status, 200);
  assert.equal(typeof realNodeMove.json.bestmove, 'string');
  assert.equal(typeof realGoMove.json.bestmove, 'string');
  console.log('AI real-engine smoke passed');
}

async function main() {
  logStep('starting backend equivalence');
  const runPrefix = `equiv_${Date.now()}`;
  const nodeSummary = await runBackendScenario('http://127.0.0.1:3101', runPrefix);
  const goSummary = await runBackendScenario('http://127.0.0.1:3102', runPrefix);
  assert.deepEqual(goSummary, nodeSummary);
  console.log('Backend equivalence passed');
  await compareAI();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
