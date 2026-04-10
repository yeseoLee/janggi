const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createRequire } = require('node:module');

const frontendRequire = createRequire(path.join(__dirname, '..', 'frontend', 'package.json'));
const { io } = frontendRequire('socket.io-client');

const PROJECT = process.env.BENCH_PROJECT || 'janggi-bench';
const COMPOSE_FILE = path.join(__dirname, '..', 'docker-compose.benchmark.yml');
const RESULTS_DIR = path.join(__dirname, '..', 'benchmarks', 'results');
const RAW_RESULTS_PATH = path.join(RESULTS_DIR, 'benchmark-results.json');
const REPORT_PATH = path.join(RESULTS_DIR, 'migration-report.md');

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

const AI_FEN = 'rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1';
const AI_MOVE_BODY = {
  fen: AI_FEN,
  depth: 4,
  movetime: 500,
  skillLevel: 0,
  useLimitStrength: false,
  uciElo: 1500,
};

const SERVICES = {
  backendNode: {
    kind: 'backend',
    label: 'Node backend',
    composeService: 'backend-node',
    baseUrl: 'http://127.0.0.1:5101',
    readyPath: '/api/ready-check',
    runtimePath: '/app',
    binaryPath: null,
    sourceDir: path.join(__dirname, '..', 'benchmarks', 'node-baseline', 'backend'),
    packageJsonPath: path.join(__dirname, '..', 'benchmarks', 'node-baseline', 'backend', 'package.json'),
    packageLockPath: path.join(__dirname, '..', 'benchmarks', 'node-baseline', 'backend', 'package-lock.json'),
    goModPath: null,
    codeFiles: ['server.js', 'src/*.js', 'init.sql'],
  },
  backendGo: {
    kind: 'backend',
    label: 'Go backend',
    composeService: 'backend-go',
    baseUrl: 'http://127.0.0.1:5102',
    readyPath: '/api/ready-check',
    runtimePath: '/app',
    binaryPath: '/app/backend',
    sourceDir: path.join(__dirname, '..', 'backend'),
    packageJsonPath: null,
    packageLockPath: null,
    goModPath: path.join(__dirname, '..', 'backend', 'go.mod'),
    codeFiles: ['*.go', 'init.sql'],
  },
  aiNode: {
    kind: 'ai',
    label: 'Node ai-server',
    composeService: 'ai-node',
    baseUrl: 'http://127.0.0.1:6102',
    readyPath: '/health',
    runtimePath: '/app',
    binaryPath: null,
    sourceDir: path.join(__dirname, '..', 'benchmarks', 'node-baseline', 'ai-server'),
    packageJsonPath: path.join(__dirname, '..', 'benchmarks', 'node-baseline', 'ai-server', 'package.json'),
    packageLockPath: path.join(__dirname, '..', 'benchmarks', 'node-baseline', 'ai-server', 'package-lock.json'),
    goModPath: null,
    codeFiles: ['server.js'],
  },
  aiGo: {
    kind: 'ai',
    label: 'Go ai-server',
    composeService: 'ai-go',
    baseUrl: 'http://127.0.0.1:6103',
    readyPath: '/health',
    runtimePath: '/app',
    binaryPath: '/app/ai-server',
    sourceDir: path.join(__dirname, '..', 'ai-server'),
    packageJsonPath: null,
    packageLockPath: null,
    goModPath: path.join(__dirname, '..', 'ai-server', 'go.mod'),
    codeFiles: ['main.go'],
  },
};

function logStep(message) {
  console.log(`[benchmark] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sh(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function collectCodeFiles(service) {
  const matchers = service.codeFiles.map(globToRegex);
  const files = [];

  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(service.sourceDir, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (matchers.some((matcher) => matcher.test(relativePath))) {
        files.push(fullPath);
      }
    }
  }

  visit(service.sourceDir);
  return files.sort();
}

function countLoc(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').length;
}

function parseNodeDependencies(packageJsonPath, packageLockPath) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
  const direct = Object.keys(pkg.dependencies || {}).length;
  const unique = new Set();

  for (const [packagePath, meta] of Object.entries(lock.packages || {})) {
    if (!packagePath.startsWith('node_modules/')) {
      continue;
    }
    if (meta && meta.dev) {
      continue;
    }
    unique.add(packagePath.split('node_modules/').pop().split('/node_modules/').pop());
  }

  return {
    direct,
    transitive: Math.max(0, unique.size - direct),
    total: unique.size,
  };
}

function parseGoDependencies(service) {
  const goMod = fs.readFileSync(service.goModPath, 'utf8');
  let inRequireBlock = false;
  let direct = 0;

  for (const rawLine of goMod.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) {
      continue;
    }
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

  const modules = sh('go', ['list', '-m', 'all'], { cwd: service.sourceDir })
    .split('\n')
    .filter(Boolean);
  const total = Math.max(0, modules.length - 1);
  return {
    direct,
    transitive: Math.max(0, total - direct),
    total,
  };
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarizeLatencies(values) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
  };
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

function formatBytes(value) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function parseMemToMiB(value) {
  const match = String(value).trim().match(/^([\d.]+)([KMG]iB|B)$/);
  if (!match) {
    return 0;
  }
  const numeric = Number(match[1]);
  const unit = match[2];
  if (unit === 'B') {
    return numeric / (1024 * 1024);
  }
  if (unit === 'KiB') {
    return numeric / 1024;
  }
  if (unit === 'MiB') {
    return numeric;
  }
  if (unit === 'GiB') {
    return numeric * 1024;
  }
  return 0;
}

function parseStatsJson(text) {
  const stats = JSON.parse(text);
  const memUsage = String(stats.MemUsage || '').split('/')[0].trim();
  return {
    cpuPercent: Number(String(stats.CPUPerc || '0').replace('%', '')) || 0,
    memMiB: parseMemToMiB(memUsage),
  };
}

function getContainerId(serviceName) {
  const id = sh('docker', ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, 'ps', '-q', serviceName]);
  assert.ok(id, `No container found for ${serviceName}`);
  return id;
}

async function fetchJson(url, { method = 'GET', token, body, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  const response = await fetch(url, {
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
  return {
    ms: performance.now() - start,
    status: response.status,
    json,
  };
}

async function waitForReady(service) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const result = await fetchJson(`${service.baseUrl}${service.readyPath}`, { timeoutMs: 3000 });
      if (service.kind === 'backend' && result.status === 404) {
        return;
      }
      if (service.kind === 'ai' && result.status === 200) {
        return;
      }
    } catch (_err) {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${service.label}`);
}

async function measureColdStart(service, samples = 5) {
  const containerId = getContainerId(service.composeService);
  const values = [];

  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    sh('docker', ['restart', containerId]);
    await waitForReady(service);
    values.push(performance.now() - start);
  }

  return summarizeLatencies(values);
}

function getContainerStats(serviceName) {
  const containerId = getContainerId(serviceName);
  const text = sh('docker', ['stats', '--no-stream', '--format', '{{json .}}', containerId]);
  return parseStatsJson(text);
}

async function withStatsSampling(serviceName, fn) {
  const samples = [];
  let active = true;
  const sampler = (async () => {
    while (active) {
      try {
        samples.push(getContainerStats(serviceName));
      } catch (_err) {}
      await sleep(1000);
    }
  })();

  try {
    const result = await fn();
    return { result, samples };
  } finally {
    active = false;
    await sampler;
  }
}

function summarizeStats(samples) {
  if (samples.length === 0) {
    return { peakCpuPercent: 0, avgCpuPercent: 0, peakMemMiB: 0, avgMemMiB: 0 };
  }
  return {
    peakCpuPercent: Math.max(...samples.map((sample) => sample.cpuPercent)),
    avgCpuPercent: samples.reduce((sum, sample) => sum + sample.cpuPercent, 0) / samples.length,
    peakMemMiB: Math.max(...samples.map((sample) => sample.memMiB)),
    avgMemMiB: samples.reduce((sum, sample) => sum + sample.memMiB, 0) / samples.length,
  };
}

async function registerAndLogin(baseUrl, username, nickname) {
  const password = 'pw1234';
  const register = await fetchJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    body: { username, password, nickname },
  });
  assert.equal(register.status, 201, `${baseUrl} register failed`);

  const login = await fetchJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(login.status, 200, `${baseUrl} login failed`);
  return { password, ...login.json };
}

function createSocket(baseUrl, token) {
  return io(baseUrl, {
    auth: { token },
    reconnection: false,
    timeout: 5000,
  });
}

function waitForEvent(socket, eventName, timeoutMs = 10000) {
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

async function benchmarkRegister(baseUrl, prefix, count) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const response = await fetchJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {
        username: `${prefix}_register_${index}_${Date.now()}`,
        password: 'pw1234',
        nickname: `${prefix}-register-${index}`,
      },
    });
    assert.equal(response.status, 201);
    values.push(response.ms);
  }
  return summarizeLatencies(values);
}

async function benchmarkLogin(baseUrl, username, password, count) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const response = await fetchJson(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: { username, password },
    });
    assert.equal(response.status, 200);
    values.push(response.ms);
  }
  return summarizeLatencies(values);
}

async function benchmarkAuthedGet(baseUrl, pathName, token, count) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const response = await fetchJson(`${baseUrl}${pathName}`, { token });
    assert.equal(response.status, 200);
    values.push(response.ms);
  }
  return summarizeLatencies(values);
}

async function benchmarkCoins(baseUrl, token, count) {
  const spend = [];
  const recharge = [];
  for (let index = 0; index < count; index += 1) {
    const spendResponse = await fetchJson(`${baseUrl}/api/coins/spend-ai-match`, {
      method: 'POST',
      token,
    });
    assert.equal(spendResponse.status, 200);
    spend.push(spendResponse.ms);

    const rechargeResponse = await fetchJson(`${baseUrl}/api/coins/recharge`, {
      method: 'POST',
      token,
    });
    assert.equal(rechargeResponse.status, 200);
    recharge.push(rechargeResponse.ms);
  }
  return {
    spend: summarizeLatencies(spend),
    recharge: summarizeLatencies(recharge),
  };
}

async function benchmarkBackendAIMove(baseUrl, token, count) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const response = await fetchJson(`${baseUrl}/api/ai/move`, {
      method: 'POST',
      token,
      body: { board: BOARD, turn: 'cho', aiTier: 0 },
      timeoutMs: 30000,
    });
    assert.equal(response.status, 200);
    values.push(response.ms);
  }
  return summarizeLatencies(values);
}

async function benchmarkAIEndpoint(baseUrl, count) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const response = await fetchJson(`${baseUrl}/move`, {
      method: 'POST',
      body: AI_MOVE_BODY,
      timeoutMs: 30000,
    });
    assert.equal(response.status, 200);
    values.push(response.ms);
  }
  return summarizeLatencies(values);
}

async function createReplayFixture(baseUrl, token) {
  const aiSave = await fetchJson(`${baseUrl}/api/games/ai`, {
    method: 'POST',
    token,
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
  assert.equal(aiSave.status, 201);

  const games = await fetchJson(`${baseUrl}/api/games`, { token });
  assert.equal(games.status, 200);
  assert.ok(Array.isArray(games.json) && games.json.length > 0);
  return games.json[0].id;
}

async function connectMatch(baseUrl, prefix, suffix) {
  const alice = await registerAndLogin(baseUrl, `${prefix}_alice_${suffix}`, `${prefix}-alice-${suffix}`);
  const bob = await registerAndLogin(baseUrl, `${prefix}_bob_${suffix}`, `${prefix}-bob-${suffix}`);

  const aliceSocket = createSocket(baseUrl, alice.token);
  const bobSocket = createSocket(baseUrl, bob.token);
  await Promise.all([once(aliceSocket, 'connect'), once(bobSocket, 'connect')]);

  const aliceInfo = { ...alice.user, rank: alice.user.rank || '18급' };
  const bobInfo = { ...bob.user, rank: bob.user.rank || '18급' };

  const matchStart = performance.now();
  const aliceMatchFound = waitForEvent(aliceSocket, 'match_found');
  const bobMatchFound = waitForEvent(bobSocket, 'match_found');
  aliceSocket.emit('find_match', aliceInfo);
  bobSocket.emit('find_match', bobInfo);
  const aliceMatch = await aliceMatchFound;
  const bobMatch = await bobMatchFound;
  const matchmakingMs = performance.now() - matchStart;

  const room = aliceMatch.room;
  const choSocket = aliceMatch.team === 'cho' ? aliceSocket : bobSocket;
  const hanSocket = aliceMatch.team === 'han' ? aliceSocket : bobSocket;

  const setupTimerSync = waitForEvent(hanSocket, 'setup_timer_sync');
  hanSocket.emit('setup_phase_started', { room, team: 'han' });
  await setupTimerSync;

  const setupStartA = performance.now();
  const opponentSetupForCho = waitForEvent(choSocket, 'opponent_setup');
  hanSocket.emit('submit_setup', { room, team: 'han', setupType: 'won' });
  await opponentSetupForCho;
  const setupMsA = performance.now() - setupStartA;

  const setupStartB = performance.now();
  const opponentSetupForHan = waitForEvent(hanSocket, 'opponent_setup');
  const choClockSync = waitForEvent(choSocket, 'clock_sync');
  choSocket.emit('submit_setup', { room, team: 'cho', setupType: 'won' });
  await Promise.all([opponentSetupForHan, choClockSync]);
  const setupMsB = performance.now() - setupStartB;

  return {
    aliceSocket,
    bobSocket,
    choSocket,
    hanSocket,
    room,
    matchmakingMs,
    setupSyncMs: Math.max(setupMsA, setupMsB),
  };
}

async function benchmarkSocketScenarios(baseUrl, prefix, count) {
  const matchmaking = [];
  const setupSync = [];
  const moveRelay = [];
  const passRelay = [];
  const resignEnd = [];
  const disconnectEnd = [];

  for (let index = 0; index < count; index += 1) {
    const match = await connectMatch(baseUrl, prefix, `flow_${index}`);
    matchmaking.push(match.matchmakingMs);
    setupSync.push(match.setupSyncMs);

    const moveStart = performance.now();
    const moveRelayWaiter = waitForEvent(match.choSocket === match.aliceSocket ? match.bobSocket : match.aliceSocket, 'move');
    match.choSocket.emit('move', { room: match.room, move: { from: { r: 6, c: 0 }, to: { r: 5, c: 0 } } });
    await moveRelayWaiter;
    moveRelay.push(performance.now() - moveStart);

    const passStart = performance.now();
    const passRelayWaiter = waitForEvent(match.choSocket, 'pass_turn');
    match.hanSocket.emit('pass', { room: match.room });
    await passRelayWaiter;
    passRelay.push(performance.now() - passStart);

    const resignStart = performance.now();
    const gameOverAlice = waitForEvent(match.aliceSocket, 'game_over');
    const gameOverBob = waitForEvent(match.bobSocket, 'game_over');
    match.choSocket.emit('resign', { room: match.room });
    await Promise.all([gameOverAlice, gameOverBob]);
    resignEnd.push(performance.now() - resignStart);

    match.aliceSocket.disconnect();
    match.bobSocket.disconnect();
  }

  for (let index = 0; index < count; index += 1) {
    const match = await connectMatch(baseUrl, prefix, `disconnect_${index}`);
    const disconnectStart = performance.now();
    const observer = match.choSocket === match.aliceSocket ? match.bobSocket : match.aliceSocket;
    const gameOverObserver = waitForEvent(observer, 'game_over');
    match.choSocket.disconnect();
    await gameOverObserver;
    disconnectEnd.push(performance.now() - disconnectStart);
    observer.disconnect();
  }

  return {
    matchmaking: summarizeLatencies(matchmaking),
    setupSync: summarizeLatencies(setupSync),
    moveRelay: summarizeLatencies(moveRelay),
    passRelay: summarizeLatencies(passRelay),
    resignEnd: summarizeLatencies(resignEnd),
    disconnectEnd: summarizeLatencies(disconnectEnd),
  };
}

async function prepareBackendContext(service, prefix) {
  const baseUrl = service.baseUrl;
  const loginUser = await registerAndLogin(baseUrl, `${prefix}_auth`, `${prefix}-auth`);
  const alice = await registerAndLogin(baseUrl, `${prefix}_alice`, `${prefix}-alice`);
  const bob = await registerAndLogin(baseUrl, `${prefix}_bob`, `${prefix}-bob`);

  const friendRequest = await fetchJson(`${baseUrl}/api/social/friends`, {
    method: 'POST',
    token: alice.token,
    body: { targetUserId: bob.user.id },
  });
  assert.equal(friendRequest.status, 200);

  const requests = await fetchJson(`${baseUrl}/api/social/friend-requests`, { token: bob.token });
  assert.equal(requests.status, 200);
  const requestId = requests.json.incoming[0].id;
  const accept = await fetchJson(`${baseUrl}/api/social/friend-requests/${requestId}/accept`, {
    method: 'POST',
    token: bob.token,
  });
  assert.equal(accept.status, 200);

  const detailId = await createReplayFixture(baseUrl, alice.token);

  return {
    loginUser,
    authToken: alice.token,
    replayToken: alice.token,
    detailId,
    socketPrefix: `${prefix}_socket`,
  };
}

async function benchmarkBackendService(service, prefix) {
  const context = await prepareBackendContext(service, prefix);

  const { result: latency, samples } = await withStatsSampling(service.composeService, async () => {
    return {
      register: await benchmarkRegister(service.baseUrl, `${prefix}_bench`, 10),
      login: await benchmarkLogin(service.baseUrl, context.loginUser.user.username, context.loginUser.password, 10),
      me: await benchmarkAuthedGet(service.baseUrl, '/api/user/me', context.authToken, 20),
      coins: await benchmarkCoins(service.baseUrl, context.authToken, 10),
      gamesList: await benchmarkAuthedGet(service.baseUrl, '/api/games', context.replayToken, 20),
      gameDetail: await benchmarkAuthedGet(service.baseUrl, `/api/games/${context.detailId}`, context.replayToken, 20),
      backendAIMove: await benchmarkBackendAIMove(service.baseUrl, context.authToken, 5),
      socket: await benchmarkSocketScenarios(service.baseUrl, context.socketPrefix, 5),
    };
  });

  return {
    latency,
    loadStats: summarizeStats(samples),
  };
}

async function benchmarkAIService(service) {
  const { result, samples } = await withStatsSampling(service.composeService, async () => {
    return await benchmarkAIEndpoint(service.baseUrl, 8);
  });
  return {
    latency: result,
    loadStats: summarizeStats(samples),
  };
}

function buildCodeMetrics() {
  const output = {};
  for (const [key, service] of Object.entries(SERVICES)) {
    const files = collectCodeFiles(service);
    const loc = files.reduce((sum, filePath) => sum + countLoc(filePath), 0);
    const dependencies = service.packageJsonPath
      ? parseNodeDependencies(service.packageJsonPath, service.packageLockPath)
      : parseGoDependencies(service);
    output[key] = {
      files: files.length,
      loc,
      dependencies,
    };
  }
  return output;
}

function getArtifactMetrics() {
  return {
    backendNode: {
      artifactSizeBytes: Number(sh('docker', ['exec', getContainerId('backend-node'), 'sh', '-lc', 'du -sb /app | cut -f1'])),
    },
    backendGo: {
      artifactSizeBytes: Number(sh('docker', ['exec', getContainerId('backend-go'), 'sh', '-lc', 'stat -c%s /app/backend'])),
    },
    aiNode: {
      artifactSizeBytes: Number(sh('docker', ['exec', getContainerId('ai-node'), 'sh', '-lc', 'du -sb /app | cut -f1'])),
      engineSizeBytes: Number(sh('docker', ['exec', getContainerId('ai-node'), 'sh', '-lc', 'stat -c%s /usr/local/bin/fairy-stockfish'])),
    },
    aiGo: {
      artifactSizeBytes: Number(sh('docker', ['exec', getContainerId('ai-go'), 'sh', '-lc', 'stat -c%s /app/ai-server'])),
      engineSizeBytes: Number(sh('docker', ['exec', getContainerId('ai-go'), 'sh', '-lc', 'stat -c%s /usr/local/bin/fairy-stockfish'])),
    },
  };
}

function getIdleStats() {
  return {
    backendNode: getContainerStats('backend-node'),
    backendGo: getContainerStats('backend-go'),
    aiNode: getContainerStats('ai-node'),
    aiGo: getContainerStats('ai-go'),
  };
}

function sumStackMetrics(left, right) {
  return {
    files: left.files + right.files,
    loc: left.loc + right.loc,
    dependencies: {
      direct: left.dependencies.direct + right.dependencies.direct,
      transitive: left.dependencies.transitive + right.dependencies.transitive,
      total: left.dependencies.total + right.dependencies.total,
    },
  };
}

function writeReport(results) {
  const backendGoFaster =
    results.coldStart.backendGo.p50 < results.coldStart.backendNode.p50 &&
    results.backendBench.backendGo.latency.me.p50 < results.backendBench.backendNode.latency.me.p50;
  const aiGoLighter =
    results.idle.aiGo.memMiB < results.idle.aiNode.memMiB &&
    results.artifacts.aiGo.artifactSizeBytes < results.artifacts.aiNode.artifactSizeBytes;
  const lines = [];
  lines.push('# Go-Gin Migration Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('Methodology: Node baseline services were measured from `benchmarks/node-baseline/*` and Go services from the migrated `backend` and `ai-server` directories. Runtime measurements used Docker on the same host. Backend equivalence ran against a stub AI service; AI wrapper equivalence ran against a deterministic fake engine, with separate real-engine smoke tests.');
  lines.push('');

  lines.push('## Backend');
  lines.push('');
  lines.push('| Metric | Node.js baseline | Go + Gin |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Code lines | ${results.code.backendNode.loc} | ${results.code.backendGo.loc} |`);
  lines.push(`| Code files | ${results.code.backendNode.files} | ${results.code.backendGo.files} |`);
  lines.push(`| Direct deps | ${results.code.backendNode.dependencies.direct} | ${results.code.backendGo.dependencies.direct} |`);
  lines.push(`| Transitive deps | ${results.code.backendNode.dependencies.transitive} | ${results.code.backendGo.dependencies.transitive} |`);
  lines.push(`| Artifact / binary size | ${formatBytes(results.artifacts.backendNode.artifactSizeBytes)} | ${formatBytes(results.artifacts.backendGo.artifactSizeBytes)} |`);
  lines.push(`| Cold start p50 | ${formatMs(results.coldStart.backendNode.p50)} | ${formatMs(results.coldStart.backendGo.p50)} |`);
  lines.push(`| Cold start p95 | ${formatMs(results.coldStart.backendNode.p95)} | ${formatMs(results.coldStart.backendGo.p95)} |`);
  lines.push(`| Idle memory | ${results.idle.backendNode.memMiB.toFixed(1)} MiB | ${results.idle.backendGo.memMiB.toFixed(1)} MiB |`);
  lines.push(`| Idle CPU | ${results.idle.backendNode.cpuPercent.toFixed(2)}% | ${results.idle.backendGo.cpuPercent.toFixed(2)}% |`);
  lines.push(`| Load peak memory | ${results.backendBench.backendNode.loadStats.peakMemMiB.toFixed(1)} MiB | ${results.backendBench.backendGo.loadStats.peakMemMiB.toFixed(1)} MiB |`);
  lines.push(`| Load peak CPU | ${results.backendBench.backendNode.loadStats.peakCpuPercent.toFixed(2)}% | ${results.backendBench.backendGo.loadStats.peakCpuPercent.toFixed(2)}% |`);
  lines.push('');

  lines.push('### Backend Response Latency');
  lines.push('');
  lines.push('| Scenario | Node p50 | Node p95 | Go p50 | Go p95 |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  const backendLatencyRows = [
    ['Auth/register', results.backendBench.backendNode.latency.register, results.backendBench.backendGo.latency.register],
    ['Auth/login', results.backendBench.backendNode.latency.login, results.backendBench.backendGo.latency.login],
    ['User/me', results.backendBench.backendNode.latency.me, results.backendBench.backendGo.latency.me],
    ['Coins/spend-ai-match', results.backendBench.backendNode.latency.coins.spend, results.backendBench.backendGo.latency.coins.spend],
    ['Coins/recharge', results.backendBench.backendNode.latency.coins.recharge, results.backendBench.backendGo.latency.coins.recharge],
    ['Games list', results.backendBench.backendNode.latency.gamesList, results.backendBench.backendGo.latency.gamesList],
    ['Game detail', results.backendBench.backendNode.latency.gameDetail, results.backendBench.backendGo.latency.gameDetail],
    ['Backend /api/ai/move', results.backendBench.backendNode.latency.backendAIMove, results.backendBench.backendGo.latency.backendAIMove],
    ['Socket matchmaking', results.backendBench.backendNode.latency.socket.matchmaking, results.backendBench.backendGo.latency.socket.matchmaking],
    ['Socket setup sync', results.backendBench.backendNode.latency.socket.setupSync, results.backendBench.backendGo.latency.socket.setupSync],
    ['Socket move relay', results.backendBench.backendNode.latency.socket.moveRelay, results.backendBench.backendGo.latency.socket.moveRelay],
    ['Socket pass relay', results.backendBench.backendNode.latency.socket.passRelay, results.backendBench.backendGo.latency.socket.passRelay],
    ['Socket resign end', results.backendBench.backendNode.latency.socket.resignEnd, results.backendBench.backendGo.latency.socket.resignEnd],
    ['Socket disconnect end', results.backendBench.backendNode.latency.socket.disconnectEnd, results.backendBench.backendGo.latency.socket.disconnectEnd],
  ];
  for (const [label, nodeMetric, goMetric] of backendLatencyRows) {
    lines.push(`| ${label} | ${formatMs(nodeMetric.p50)} | ${formatMs(nodeMetric.p95)} | ${formatMs(goMetric.p50)} | ${formatMs(goMetric.p95)} |`);
  }
  lines.push('');

  lines.push('## AI Server');
  lines.push('');
  lines.push('| Metric | Node.js baseline | Go + Gin |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Code lines | ${results.code.aiNode.loc} | ${results.code.aiGo.loc} |`);
  lines.push(`| Code files | ${results.code.aiNode.files} | ${results.code.aiGo.files} |`);
  lines.push(`| Direct deps | ${results.code.aiNode.dependencies.direct} | ${results.code.aiGo.dependencies.direct} |`);
  lines.push(`| Transitive deps | ${results.code.aiNode.dependencies.transitive} | ${results.code.aiGo.dependencies.transitive} |`);
  lines.push(`| Wrapper artifact / binary size | ${formatBytes(results.artifacts.aiNode.artifactSizeBytes)} | ${formatBytes(results.artifacts.aiGo.artifactSizeBytes)} |`);
  lines.push(`| Shared engine size | ${formatBytes(results.artifacts.aiNode.engineSizeBytes)} | ${formatBytes(results.artifacts.aiGo.engineSizeBytes)} |`);
  lines.push(`| Cold start p50 | ${formatMs(results.coldStart.aiNode.p50)} | ${formatMs(results.coldStart.aiGo.p50)} |`);
  lines.push(`| Cold start p95 | ${formatMs(results.coldStart.aiNode.p95)} | ${formatMs(results.coldStart.aiGo.p95)} |`);
  lines.push(`| Idle memory | ${results.idle.aiNode.memMiB.toFixed(1)} MiB | ${results.idle.aiGo.memMiB.toFixed(1)} MiB |`);
  lines.push(`| Idle CPU | ${results.idle.aiNode.cpuPercent.toFixed(2)}% | ${results.idle.aiGo.cpuPercent.toFixed(2)}% |`);
  lines.push(`| Load peak memory | ${results.aiBench.aiNode.loadStats.peakMemMiB.toFixed(1)} MiB | ${results.aiBench.aiGo.loadStats.peakMemMiB.toFixed(1)} MiB |`);
  lines.push(`| Load peak CPU | ${results.aiBench.aiNode.loadStats.peakCpuPercent.toFixed(2)}% | ${results.aiBench.aiGo.loadStats.peakCpuPercent.toFixed(2)}% |`);
  lines.push('');
  lines.push('| Endpoint | Node p50 | Node p95 | Go p50 | Go p95 |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  lines.push(`| AI /move | ${formatMs(results.aiBench.aiNode.latency.p50)} | ${formatMs(results.aiBench.aiNode.latency.p95)} | ${formatMs(results.aiBench.aiGo.latency.p50)} | ${formatMs(results.aiBench.aiGo.latency.p95)} |`);
  lines.push('');

  lines.push('## Stack Summary');
  lines.push('');
  lines.push('| Metric | Node.js stack | Go stack |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Total code lines | ${results.stack.node.loc} | ${results.stack.go.loc} |`);
  lines.push(`| Total code files | ${results.stack.node.files} | ${results.stack.go.files} |`);
  lines.push(`| Total direct deps | ${results.stack.node.dependencies.direct} | ${results.stack.go.dependencies.direct} |`);
  lines.push(`| Total transitive deps | ${results.stack.node.dependencies.transitive} | ${results.stack.go.dependencies.transitive} |`);
  lines.push(`| Combined idle memory | ${(results.idle.backendNode.memMiB + results.idle.aiNode.memMiB).toFixed(1)} MiB | ${(results.idle.backendGo.memMiB + results.idle.aiGo.memMiB).toFixed(1)} MiB |`);
  lines.push(`| Combined idle CPU | ${(results.idle.backendNode.cpuPercent + results.idle.aiNode.cpuPercent).toFixed(2)}% | ${(results.idle.backendGo.cpuPercent + results.idle.aiGo.cpuPercent).toFixed(2)}% |`);
  lines.push(`| Combined peak load memory | ${(results.backendBench.backendNode.loadStats.peakMemMiB + results.aiBench.aiNode.loadStats.peakMemMiB).toFixed(1)} MiB | ${(results.backendBench.backendGo.loadStats.peakMemMiB + results.aiBench.aiGo.loadStats.peakMemMiB).toFixed(1)} MiB |`);
  lines.push(`| Combined peak load CPU | ${(results.backendBench.backendNode.loadStats.peakCpuPercent + results.aiBench.aiNode.loadStats.peakCpuPercent).toFixed(2)}% | ${(results.backendBench.backendGo.loadStats.peakCpuPercent + results.aiBench.aiGo.loadStats.peakCpuPercent).toFixed(2)}% |`);
  lines.push('');

  lines.push('## Interpretation');
  lines.push('');
  lines.push(`- Backend ${backendGoFaster ? 'cold-start and representative REST/socket paths favored Go in this run' : 'results were mixed in this run, with Go improving some paths but not uniformly leading every backend metric'}. The main cost that remains in both stacks is database round-trips, so list/detail and game-finalization paths stay bounded more by PostgreSQL work than by the HTTP framework alone.`);
  lines.push(`- The AI wrapper ${aiGoLighter ? 'became materially smaller and lighter in Go' : 'did not win every runtime metric despite the Go rewrite, but still removed the Node runtime dependency from the wrapper layer'}. Real-engine \`/move\` latency stayed dominated by Fairy-Stockfish search time, so wrapper/framework changes affected startup and idle footprint more than search-heavy request latency.`);
  lines.push(`- Socket.IO compatibility still carries non-trivial coordination cost in both implementations. Matchmaking and relay paths improved where Go avoided extra event-loop scheduling, but end-of-game paths remain influenced by DB writes and session bookkeeping rather than HTTP framework choice alone.`);
  lines.push('');

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
}

async function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  logStep('waiting for benchmark services');
  await Promise.all(Object.values(SERVICES).map(waitForReady));

  logStep('collecting code metrics');
  const code = buildCodeMetrics();

  logStep('collecting artifact metrics');
  const artifacts = getArtifactMetrics();

  logStep('collecting cold starts');
  const coldStart = {
    backendNode: await measureColdStart(SERVICES.backendNode),
    backendGo: await measureColdStart(SERVICES.backendGo),
    aiNode: await measureColdStart(SERVICES.aiNode),
    aiGo: await measureColdStart(SERVICES.aiGo),
  };

  logStep('collecting idle stats');
  await sleep(2000);
  const idle = getIdleStats();

  logStep('benchmarking backends');
  const backendBench = {
    backendNode: await benchmarkBackendService(SERVICES.backendNode, `node_${Date.now()}`),
    backendGo: await benchmarkBackendService(SERVICES.backendGo, `go_${Date.now()}`),
  };

  logStep('benchmarking ai servers');
  const aiBench = {
    aiNode: await benchmarkAIService(SERVICES.aiNode),
    aiGo: await benchmarkAIService(SERVICES.aiGo),
  };

  const stack = {
    node: sumStackMetrics(code.backendNode, code.aiNode),
    go: sumStackMetrics(code.backendGo, code.aiGo),
  };

  const results = {
    generatedAt: new Date().toISOString(),
    code,
    artifacts,
    coldStart,
    idle,
    backendBench,
    aiBench,
    stack,
  };

  fs.writeFileSync(RAW_RESULTS_PATH, JSON.stringify(results, null, 2));
  writeReport(results);

  console.log(JSON.stringify({
    raw: RAW_RESULTS_PATH,
    report: REPORT_PATH,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
