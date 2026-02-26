const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const {
  NotEnoughCoinsError,
  UserNotFoundError,
  spendCoinsForAiMatch,
  rechargeCoins,
} = require('./src/coinService');
const {
  boardToJanggiFen,
  clampDepth,
  clampMoveTime,
  isValidBoardState,
  parseEngineMove,
} = require('./src/aiMove');
const { resolveRankAfterResult, normalizeCounter } = require('./src/rank');
const { calculateMaxWinStreak } = require('./src/streak');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:4000';

// Database Connection
const pool = new Pool({
  user: process.env.DB_USER || 'janggi_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'janggi_db',
  password: process.env.DB_PASSWORD || 'janggi_password',
  port: process.env.DB_PORT || 5432,
});

// Test DB Connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack);
  }
  console.log('Connected to Database');
  release();
});

const io = new Server(server, {
  cors: {
    origin: "*", // Improve security in production
    methods: ["GET", "POST"]
  }
});

// userId(string) -> { sessionId: string, sockets: Set<string> }
const activeSessions = new Map();

function getSessionKey(userId) {
  return String(userId);
}

function isSessionActive(userId, sessionId) {
  if (!userId || !sessionId) return false;
  const key = getSessionKey(userId);
  const existing = activeSessions.get(key);
  if (!existing) {
    activeSessions.set(key, { sessionId, sockets: new Set() });
    return true;
  }
  return existing.sessionId === sessionId;
}

app.use(cors());
app.use(express.json());

// Serve static files from frontend build (production)
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET || 'secret_key', (err, user) => {
    if (err) return res.sendStatus(403);
    if (!user?.id || !user?.sid) {
      return res.status(401).json({ error: 'Invalid session', code: 'SESSION_INVALID' });
    }
    if (!isSessionActive(user.id, user.sid)) {
      return res.status(401).json({ error: 'Duplicate login detected', code: 'DUPLICATE_LOGIN' });
    }
    req.user = user;
    next();
  });
};

// --- Auth Routes ---

// Register
app.post('/api/auth/register', async (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password || !nickname) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    // Grant 10 coins by default (schema default)
    const result = await pool.query(
      'INSERT INTO users (username, password, nickname, coins) VALUES ($1, $2, $3, $4) RETURNING id, username, nickname, rank, wins, losses, coins, rank_wins, rank_losses, rating',
      [username, hashedPassword, nickname, 10]
    );
    res.status(201).json({ message: 'User registered', user: { ...result.rows[0], max_win_streak: 0 } });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') { // Unique violation
        return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Fields required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const userKey = getSessionKey(user.id);
    const previousSession = activeSessions.get(userKey);
    if (previousSession) {
      terminateSessionSockets(user.id, previousSession, 'duplicate_login');
    }

    const sessionId = randomUUID();
    activeSessions.set(userKey, { sessionId, sockets: new Set() });

    const token = jwt.sign(
      { id: user.id, username: user.username, sid: sessionId },
      process.env.JWT_SECRET || 'secret_key',
      { expiresIn: '1h' },
    );
    const maxWinStreak = await fetchMaxWinStreak(user.id);
    
    // Return user info without password
    const { password: _, ...userInfo } = user;
    res.json({ token, user: { ...userInfo, max_win_streak: maxWinStreak } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get User Info
app.get('/api/user/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, nickname, rank, wins, losses, coins, rank_wins, rank_losses, rating FROM users WHERE id = $1',
      [req.user.id],
    );
    if (result.rows.length === 0) return res.sendStatus(404);
    const userInfo = result.rows[0];
    const maxWinStreak = await fetchMaxWinStreak(userInfo.id);
    res.json({ ...userInfo, max_win_streak: maxWinStreak });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/social/users/search', authenticateToken, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);

  try {
    const like = `%${q}%`;
    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.nickname,
         u.rank,
         u.wins,
         u.losses,
         u.rating,
         EXISTS (
           SELECT 1 FROM friendships f
           WHERE f.user_id = $1
             AND f.friend_id = u.id
         ) AS is_friend,
         EXISTS (
           SELECT 1 FROM villains v
           WHERE v.user_id = $1
             AND v.target_user_id = u.id
         ) AS is_villain
       FROM users u
       WHERE u.id <> $1
         AND (u.nickname ILIKE $2 OR u.username ILIKE $2)
       ORDER BY u.nickname ASC, u.username ASC
       LIMIT 20`,
      [req.user.id, like],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/social/friends', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.nickname, u.rank, u.wins, u.losses, u.rating, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1
       ORDER BY u.nickname ASC, u.username ASC`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/social/friends', authenticateToken, async (req, res) => {
  const targetUserId = Number(req.body?.targetUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ error: 'Invalid target user' });
  }
  if (targetUserId === Number(req.user.id)) {
    return res.status(400).json({ error: 'Cannot add yourself' });
  }

  try {
    const targetInfo = await fetchUserPublicInfo(targetUserId);
    if (!targetInfo) return res.status(404).json({ error: 'User not found' });

    const blocked = await areUsersBlocked(req.user.id, targetUserId);
    if (blocked) {
      return res.status(409).json({ error: 'Cannot add this user due to villain relation' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO friendships (user_id, friend_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, friend_id) DO NOTHING`,
        [req.user.id, targetUserId],
      );
      await client.query(
        `INSERT INTO friendships (user_id, friend_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, friend_id) DO NOTHING`,
        [targetUserId, req.user.id],
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/social/friends/:friendId', authenticateToken, async (req, res) => {
  const friendId = Number(req.params.friendId);
  if (!Number.isInteger(friendId) || friendId <= 0) {
    return res.status(400).json({ error: 'Invalid friend id' });
  }

  try {
    await pool.query(
      `DELETE FROM friendships
       WHERE (user_id = $1 AND friend_id = $2)
          OR (user_id = $2 AND friend_id = $1)`,
      [req.user.id, friendId],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/social/villains', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.nickname, u.rank, u.wins, u.losses, u.rating, v.created_at
       FROM villains v
       JOIN users u ON u.id = v.target_user_id
       WHERE v.user_id = $1
       ORDER BY v.created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/social/villains', authenticateToken, async (req, res) => {
  const targetUserId = Number(req.body?.targetUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ error: 'Invalid target user' });
  }
  if (targetUserId === Number(req.user.id)) {
    return res.status(400).json({ error: 'Cannot villain yourself' });
  }

  try {
    const targetInfo = await fetchUserPublicInfo(targetUserId);
    if (!targetInfo) return res.status(404).json({ error: 'User not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM friendships
         WHERE (user_id = $1 AND friend_id = $2)
            OR (user_id = $2 AND friend_id = $1)`,
        [req.user.id, targetUserId],
      );
      await client.query(
        `INSERT INTO villains (user_id, target_user_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, target_user_id) DO NOTHING`,
        [req.user.id, targetUserId],
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/social/villains/:targetUserId', authenticateToken, async (req, res) => {
  const targetUserId = Number(req.params.targetUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ error: 'Invalid target user id' });
  }

  try {
    await pool.query(
      `DELETE FROM villains
       WHERE user_id = $1
         AND target_user_id = $2`,
      [req.user.id, targetUserId],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/social/friends/:friendId/games', authenticateToken, async (req, res) => {
  const friendId = Number(req.params.friendId);
  if (!Number.isInteger(friendId) || friendId <= 0) {
    return res.status(400).json({ error: 'Invalid friend id' });
  }

  try {
    const friendResult = await pool.query(
      `SELECT id, username, nickname, rank, wins, losses, rating
       FROM users
       WHERE id = $1`,
      [friendId],
    );
    if (friendResult.rows.length === 0) return res.status(404).json({ error: 'Friend not found' });

    const friendship = await pool.query(
      `SELECT 1
       FROM friendships
       WHERE user_id = $1
         AND friend_id = $2
       LIMIT 1`,
      [req.user.id, friendId],
    );
    if (friendship.rows.length === 0) return res.status(403).json({ error: 'Not a friend' });

    const gamesResult = await pool.query(
      `SELECT
          g.id,
          g.played_at,
          g.started_at,
          g.ended_at,
          COALESCE(g.game_mode, 'online') AS game_mode,
          g.winner_team,
          g.loser_team,
          COALESCE(g.result_type, 'unknown') AS result_type,
          COALESCE(
              g.move_count,
              CASE
                  WHEN g.move_log IS NOT NULL AND jsonb_typeof(g.move_log) = 'array'
                      THEN jsonb_array_length(g.move_log)
                  ELSE 0
              END
          ) AS move_count,
          COALESCE(
              u1.nickname,
              CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
          ) AS winner_name,
          COALESCE(
              u2.nickname,
              CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
          ) AS loser_name,
          CASE
              WHEN g.winner_team = 'cho'
                  THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
              ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
          END AS cho_name,
          CASE
              WHEN g.winner_team = 'han'
                  THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
              ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
          END AS han_name,
          CASE
              WHEN g.winner_id = $1 THEN 'win'
              WHEN g.loser_id = $1 THEN 'loss'
              ELSE 'draw'
          END AS my_result,
          CASE
              WHEN g.winner_id = $1 THEN g.winner_team
              WHEN g.loser_id = $1 THEN g.loser_team
              ELSE NULL
          END AS my_team,
          CASE
              WHEN g.winner_id = $1
                  THEN COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
              WHEN g.loser_id = $1
                  THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
              ELSE NULL
          END AS opponent_name
       FROM games g
       LEFT JOIN users u1 ON g.winner_id = u1.id
       LEFT JOIN users u2 ON g.loser_id = u2.id
       WHERE g.winner_id = $1 OR g.loser_id = $1
       ORDER BY g.played_at DESC
       LIMIT 50`,
      [friendId],
    );

    res.json({
      friend: friendResult.rows[0],
      games: gamesResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Spend coins when entering an AI match.
app.post('/api/coins/spend-ai-match', authenticateToken, async (req, res) => {
  try {
    const payload = await spendCoinsForAiMatch(pool, req.user.id);
    res.json(payload);
  } catch (err) {
    if (err instanceof NotEnoughCoinsError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Compute AI move through Fairy-Stockfish service.
app.post('/api/ai/move', authenticateToken, async (req, res) => {
  const { board, turn, movetime, depth } = req.body || {};
  if (!isValidBoardState(board) || (turn !== TEAM_CHO && turn !== TEAM_HAN)) {
    return res.status(400).json({ error: 'Invalid board state or turn' });
  }

  let fen;
  try {
    fen = boardToJanggiFen(board, turn);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid board state' });
  }

  const requestedMoveTime = clampMoveTime(
    movetime,
    clampMoveTime(process.env.AI_MOVE_TIME_MS, 700),
  );
  const requestedDepth = clampDepth(
    depth,
    clampDepth(process.env.AI_SEARCH_DEPTH, 8),
  );

  const timeoutMs = Math.max(15000, requestedMoveTime * 8);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${AI_SERVICE_URL}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen,
        movetime: requestedMoveTime,
        depth: requestedDepth,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error('AI service error:', response.status, errorBody);
      return res.status(502).json({ error: 'AI service error' });
    }

    const aiResult = await response.json();
    const bestmove = aiResult?.bestmove;
    const move = parseEngineMove(bestmove);
    if (!move) {
      return res.json({
        pass: true,
        bestmove: bestmove || '(none)',
      });
    }

    return res.json({
      pass: false,
      bestmove,
      move,
    });
  } catch (err) {
    console.error('Failed to request AI move:', err);
    return res.status(502).json({ error: 'Failed to request AI move' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.post('/api/games/ai', authenticateToken, async (req, res) => {
  const {
    myTeam,
    winnerTeam,
    choSetup,
    hanSetup,
    moveLog,
    resultType,
    startedAt,
    endedAt,
  } = req.body || {};

  if (!isValidTeam(myTeam) || !isValidTeam(winnerTeam)) {
    return res.status(400).json({ error: 'Invalid team payload' });
  }

  const normalizedMoveLog = normalizeMoveLog(moveLog);
  const normalizedResultType = normalizeResultType(resultType);
  const safeChoSetup = typeof choSetup === 'string' && choSetup.length <= 50 ? choSetup : null;
  const safeHanSetup = typeof hanSetup === 'string' && hanSetup.length <= 50 ? hanSetup : null;
  const startTime = normalizeTimestamp(startedAt);
  let endTime = normalizeTimestamp(endedAt);
  if (endTime < startTime) endTime = startTime;

  const didUserWin = winnerTeam === myTeam;
  const winnerId = didUserWin ? req.user.id : null;
  const loserId = didUserWin ? null : req.user.id;
  const loserTeam = getOpponentTeam(winnerTeam);
  const replayPayload = {
    version: 2,
    choSetup: safeChoSetup,
    hanSetup: safeHanSetup,
    moveLog: normalizedMoveLog,
  };

  try {
    await pool.query(
      `INSERT INTO games (
          winner_id, loser_id, game_mode, winner_team, loser_team,
          moves, cho_setup, han_setup, move_log, result_type, move_count, started_at, ended_at
      ) VALUES ($1, $2, 'ai', $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
      [
        winnerId,
        loserId,
        winnerTeam,
        loserTeam,
        JSON.stringify(replayPayload),
        safeChoSetup,
        safeHanSetup,
        JSON.stringify(normalizedMoveLog),
        normalizedResultType,
        normalizedMoveLog.length,
        startTime,
        endTime,
      ],
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Failed to save AI game replay:', err);
    res.status(500).json({ error: 'Failed to save AI replay' });
  }
});

// Temporary manual recharge endpoint (+10 coins).
app.post('/api/coins/recharge', authenticateToken, async (req, res) => {
  try {
    // TODO(next): Require successful ad-view validation before payout.
    // TODO(next): Add per-user daily recharge limit and persist usage counters.
    const payload = await rechargeCoins(pool, req.user.id);
    res.json(payload);
  } catch (err) {
    if (err instanceof UserNotFoundError) return res.sendStatus(404);
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Withdrawal (Delete Account)
app.delete('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const sessionKey = getSessionKey(req.user.id);
        const sessionRecord = activeSessions.get(sessionKey);
        if (sessionRecord) {
            terminateSessionSockets(req.user.id, sessionRecord, 'account_deleted');
            activeSessions.delete(sessionKey);
        }
        await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
        res.json({ message: 'Account deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});


// --- Database Schema Init (Ensure games table exists) ---
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                nickname VARCHAR(50),
                rank VARCHAR(20) DEFAULT '18급',
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                coins INTEGER DEFAULT 10,
                rank_wins INTEGER DEFAULT 0,
                rank_losses INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                winner_id INTEGER REFERENCES users(id),
                loser_id INTEGER REFERENCES users(id),
                game_mode VARCHAR(20) DEFAULT 'online',
                winner_team VARCHAR(10),
                loser_team VARCHAR(10),
                moves TEXT, -- backward compatibility payload
                cho_setup VARCHAR(50),
                han_setup VARCHAR(50),
                move_log JSONB,
                result_type VARCHAR(20),
                move_count INTEGER DEFAULT 0,
                started_at TIMESTAMP,
                ended_at TIMESTAMP,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS friendships (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, friend_id),
                CHECK (user_id <> friend_id)
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS villains (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, target_user_id),
                CHECK (user_id <> target_user_id)
            );
        `);
        // Forward-only, idempotent migration for existing installations.
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS cho_setup VARCHAR(50);`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS han_setup VARCHAR(50);`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS move_log JSONB;`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS game_mode VARCHAR(20) DEFAULT 'online';`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS result_type VARCHAR(20);`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS move_count INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP;`);
        await pool.query(`UPDATE games SET game_mode = 'online' WHERE game_mode IS NULL;`);

        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_wins INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_losses INTEGER DEFAULT 0;`);
        await pool.query(`UPDATE users SET rank_wins = COALESCE(rank_wins, 0), rank_losses = COALESCE(rank_losses, 0);`);

        // ELO rating column — default 1000 for all new and existing users.
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT ${ELO_DEFAULT_RATING};`);
        await pool.query(`UPDATE users SET rating = ${ELO_DEFAULT_RATING} WHERE rating IS NULL OR rating = 0;`);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_games_played_at ON games (played_at DESC);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_games_move_count ON games (move_count DESC);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_friendships_friend_id ON friendships (friend_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_villains_target_user_id ON villains (target_user_id);`);

        console.log("DB: Games table checked/created");
    } catch (err) {
        console.error("DB Init Error:", err);
    }
};
initDB();

// --- ELO Rating System ---
const ELO_K_FACTOR = 32;
const ELO_DEFAULT_RATING = 1000;
const ELO_MIN_RATING = 100;

/**
 * Calculate new ELO ratings after a game result.
 * @param {number} winnerRating - Current rating of the winner
 * @param {number} loserRating  - Current rating of the loser
 * @returns {{ newWinnerRating: number, newLoserRating: number, ratingChange: number }}
 */
function calculateElo(winnerRating, loserRating) {
    const rW = winnerRating || ELO_DEFAULT_RATING;
    const rL = loserRating  || ELO_DEFAULT_RATING;

    // Expected scores
    const expectedWinner = 1 / (1 + Math.pow(10, (rL - rW) / 400));
    const expectedLoser  = 1 / (1 + Math.pow(10, (rW - rL) / 400));

    const ratingChange = Math.round(ELO_K_FACTOR * (1 - expectedWinner));

    const newWinnerRating = Math.max(ELO_MIN_RATING, Math.round(rW + ELO_K_FACTOR * (1 - expectedWinner)));
    const newLoserRating  = Math.max(ELO_MIN_RATING, Math.round(rL + ELO_K_FACTOR * (0 - expectedLoser)));

    return { newWinnerRating, newLoserRating, ratingChange };
}

// --- Matchmaking Helpers ---
function getRankScore(rankStr) {
    if (!rankStr) return 0;
    // Format: "18급", "1단"
    // Gup: 18 (Lowest) -> 1 (Highest Gup). let's say score = 20 - Gup. (18급=2, 1급=19)
    // Dan: 1 (Lowest Dan) -> 9. let's say score = 20 + Dan. (1단=21, 9단=29)
    
    if (rankStr.includes('급')) {
        const num = parseInt(rankStr.replace('급', ''));
        return 20 - num; 
    } else if (rankStr.includes('단')) {
        const num = parseInt(rankStr.replace('단', ''));
        return 20 + num;
    }
    return 0; // Default
}

function getWinRate(user) {
    if (!user) return 0;
    const total = (user.wins || 0) + (user.losses || 0);
    if (total === 0) return 0;
    return (user.wins / total);
}

async function fetchUserPublicInfo(userId) {
    if (!userId) return null;
    const result = await pool.query(
        `SELECT id, username, nickname, rank, wins, losses, rating
         FROM users
         WHERE id = $1`,
        [userId],
    );
    return result.rows[0] || null;
}

async function areUsersBlocked(userAId, userBId) {
    if (!userAId || !userBId) return false;
    const result = await pool.query(
        `SELECT 1
         FROM villains
         WHERE (user_id = $1 AND target_user_id = $2)
            OR (user_id = $2 AND target_user_id = $1)
         LIMIT 1`,
        [userAId, userBId],
    );
    return result.rows.length > 0;
}

async function areUsersFriends(userAId, userBId) {
    if (!userAId || !userBId) return false;
    const result = await pool.query(
        `SELECT 1
         FROM friendships
         WHERE user_id = $1
           AND friend_id = $2
         LIMIT 1`,
        [userAId, userBId],
    );
    return result.rows.length > 0;
}

const TEAM_CHO = 'cho';
const TEAM_HAN = 'han';
const MAIN_THINKING_TIME_MS = 5 * 60 * 1000;
const BYOYOMI_TIME_MS = 30 * 1000;
const BYOYOMI_PERIODS = 3;

async function fetchMaxWinStreak(userId) {
    const result = await pool.query(
        `SELECT winner_id, loser_id
         FROM games
         WHERE (winner_id = $1 OR loser_id = $1)
           AND COALESCE(game_mode, 'online') = 'online'
         ORDER BY COALESCE(ended_at, played_at, started_at) ASC, id ASC`,
        [userId],
    );
    return calculateMaxWinStreak(result.rows, userId);
}

function isValidTeam(team) {
    return team === TEAM_CHO || team === TEAM_HAN;
}

function getOpponentTeam(team) {
    return team === TEAM_CHO ? TEAM_HAN : TEAM_CHO;
}

function isValidPosition(pos) {
    return (
        pos &&
        Number.isInteger(pos.r) &&
        Number.isInteger(pos.c) &&
        pos.r >= 0 &&
        pos.r < 10 &&
        pos.c >= 0 &&
        pos.c < 9
    );
}

function normalizeResultType(resultType) {
    const value = typeof resultType === 'string' ? resultType.trim().toLowerCase() : '';
    if (value === 'resign' || value === 'time' || value === 'piece' || value === 'checkmate' || value === 'score') {
        return value;
    }
    return 'unknown';
}

function normalizeMoveLog(moveLog) {
    if (!Array.isArray(moveLog)) return [];
    const normalized = [];

    for (const event of moveLog) {
        if (!event || typeof event !== 'object') continue;
        const turn = isValidTeam(event.turn) ? event.turn : null;
        const at = typeof event.at === 'string' && event.at.trim() ? event.at : new Date().toISOString();

        if (event.type === 'move' && isValidPosition(event.from) && isValidPosition(event.to) && turn) {
            normalized.push({
                type: 'move',
                turn,
                from: { r: event.from.r, c: event.from.c },
                to: { r: event.to.r, c: event.to.c },
                at,
            });
            continue;
        }

        if (event.type === 'pass' && turn) {
            normalized.push({
                type: 'pass',
                turn,
                at,
            });
        }
    }

    return normalized;
}

function normalizeTimestamp(timestamp, fallback = new Date()) {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return parsed;
}

function getTeamBySocketId(game, socketId) {
    if (!game) return null;
    if (game.cho?.socketId === socketId) return TEAM_CHO;
    if (game.han?.socketId === socketId) return TEAM_HAN;
    return null;
}

function getSocketAuthToken(socket) {
    const authToken = socket?.handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();

    const authHeader = socket?.handshake?.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }

    const queryToken = socket?.handshake?.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
    return null;
}

// Game State Memory
// roomId -> { cho, han, mode, choSetup, hanSetup, moveLog, nextTurn, startTime, finished }
const activeGames = new Map();
const pendingFriendlyInvites = new Map();
const pendingFriendlyMatches = new Map();

// Socket.io Logic
let matchQueue = [];
let matchmakingInProgress = false;

function hasGameStarted(game) {
    return Boolean(game?.choSetup && game?.hanSetup);
}

function createInitialTeamClock() {
    return {
        mainMs: MAIN_THINKING_TIME_MS,
        byoyomiPeriods: BYOYOMI_PERIODS,
    };
}

function getNormalizedClock(clock) {
    return {
        mainMs: Math.max(0, Math.floor(Number(clock?.mainMs) || 0)),
        byoyomiPeriods: Math.max(0, Math.floor(Number(clock?.byoyomiPeriods) || 0)),
    };
}

function getInitialByoyomiForTurn(game) {
    const activeTeam = game?.nextTurn;
    if (!isValidTeam(activeTeam)) return null;
    const activeClock = getNormalizedClock(game?.clocks?.[activeTeam]);
    if (activeClock.mainMs > 0) return null;
    if (activeClock.byoyomiPeriods <= 0) return 0;
    return BYOYOMI_TIME_MS;
}

function getTurnLossBudgetMs(clock, turnByoyomiRemainingMs) {
    const normalizedClock = getNormalizedClock(clock);
    if (normalizedClock.mainMs > 0) {
        return normalizedClock.mainMs + (normalizedClock.byoyomiPeriods * BYOYOMI_TIME_MS);
    }
    if (normalizedClock.byoyomiPeriods <= 0) return 0;

    const firstByoyomiMsRaw = Number.isFinite(Number(turnByoyomiRemainingMs))
        ? Number(turnByoyomiRemainingMs)
        : BYOYOMI_TIME_MS;
    const firstByoyomiMs = Math.max(0, Math.min(BYOYOMI_TIME_MS, Math.floor(firstByoyomiMsRaw)));
    return firstByoyomiMs + ((normalizedClock.byoyomiPeriods - 1) * BYOYOMI_TIME_MS);
}

function projectClockAfterElapsed(clock, turnByoyomiRemainingMs, elapsedMs) {
    const normalizedClock = getNormalizedClock(clock);
    const safeElapsed = Math.max(0, Math.floor(Number(elapsedMs) || 0));
    const turnBudgetMs = getTurnLossBudgetMs(normalizedClock, turnByoyomiRemainingMs);

    if (turnBudgetMs <= 0 || safeElapsed >= turnBudgetMs) {
        return {
            mainMs: 0,
            byoyomiPeriods: 0,
            byoyomiRemainingMs: 0,
            timedOut: true,
        };
    }

    let remainingElapsed = safeElapsed;
    let mainMs = normalizedClock.mainMs;
    let byoyomiPeriods = normalizedClock.byoyomiPeriods;
    let byoyomiRemainingMs = null;

    if (mainMs > 0) {
        if (remainingElapsed < mainMs) {
            mainMs -= remainingElapsed;
            remainingElapsed = 0;
        } else {
            remainingElapsed -= mainMs;
            mainMs = 0;
        }
    }

    if (mainMs <= 0 && byoyomiPeriods > 0) {
        const initialByoyomiMsRaw = Number.isFinite(Number(turnByoyomiRemainingMs))
            ? Number(turnByoyomiRemainingMs)
            : BYOYOMI_TIME_MS;
        byoyomiRemainingMs = Math.max(0, Math.min(BYOYOMI_TIME_MS, Math.floor(initialByoyomiMsRaw)));

        while (remainingElapsed > 0 && byoyomiPeriods > 0) {
            if (remainingElapsed < byoyomiRemainingMs) {
                byoyomiRemainingMs -= remainingElapsed;
                remainingElapsed = 0;
                break;
            }

            remainingElapsed -= byoyomiRemainingMs;
            byoyomiPeriods -= 1;
            byoyomiRemainingMs = byoyomiPeriods > 0 ? BYOYOMI_TIME_MS : 0;
        }
    } else if (mainMs <= 0 && byoyomiPeriods <= 0) {
        byoyomiRemainingMs = 0;
    }

    return {
        mainMs,
        byoyomiPeriods,
        byoyomiRemainingMs: mainMs > 0 ? null : byoyomiRemainingMs,
        timedOut: false,
    };
}

function applyElapsedToActiveTurn(game, nowMs = Date.now()) {
    if (!game?.turnStartedAt || !isValidTeam(game.nextTurn)) return null;

    const activeTeam = game.nextTurn;
    const activeClock = getNormalizedClock(game.clocks?.[activeTeam]);
    const elapsedMs = Math.max(0, nowMs - game.turnStartedAt);
    const projected = projectClockAfterElapsed(activeClock, game.turnByoyomiRemainingMs, elapsedMs);

    game.clocks[activeTeam] = {
        mainMs: projected.mainMs,
        byoyomiPeriods: projected.byoyomiPeriods,
    };
    game.turnByoyomiRemainingMs = projected.byoyomiRemainingMs;
    game.turnStartedAt = nowMs;

    if (projected.timedOut) {
        return activeTeam;
    }
    return null;
}

function buildClockSyncPayload(game, nowMs = Date.now()) {
    const fallbackClock = createInitialTeamClock();
    const projected = {
        cho: {
            ...getNormalizedClock(game?.clocks?.[TEAM_CHO] || fallbackClock),
            byoyomiRemainingMs: null,
            isByoyomi: false,
        },
        han: {
            ...getNormalizedClock(game?.clocks?.[TEAM_HAN] || fallbackClock),
            byoyomiRemainingMs: null,
            isByoyomi: false,
        },
    };

    for (const team of [TEAM_CHO, TEAM_HAN]) {
        const teamClock = projected[team];
        if (teamClock.mainMs <= 0) {
            teamClock.isByoyomi = true;
            teamClock.byoyomiRemainingMs = teamClock.byoyomiPeriods > 0 ? BYOYOMI_TIME_MS : 0;
        }
    }

    if (game?.turnStartedAt && isValidTeam(game?.nextTurn)) {
        const elapsedMs = Math.max(0, nowMs - game.turnStartedAt);
        const activeProjection = projectClockAfterElapsed(
            projected[game.nextTurn],
            game.turnByoyomiRemainingMs,
            elapsedMs,
        );
        projected[game.nextTurn] = {
            mainMs: activeProjection.mainMs,
            byoyomiPeriods: activeProjection.byoyomiPeriods,
            byoyomiRemainingMs: activeProjection.mainMs > 0 ? null : activeProjection.byoyomiRemainingMs,
            isByoyomi: activeProjection.mainMs <= 0,
        };
    }

    return {
        nextTurn: game?.nextTurn || TEAM_CHO,
        updatedAt: nowMs,
        timeControl: {
            mainMs: MAIN_THINKING_TIME_MS,
            byoyomiMs: BYOYOMI_TIME_MS,
            byoyomiPeriods: BYOYOMI_PERIODS,
        },
        clocks: projected,
    };
}

function emitClockSync(roomId, nowMs = Date.now()) {
    const game = activeGames.get(roomId);
    if (!game || game.finished || !hasGameStarted(game)) return;
    io.to(roomId).emit('clock_sync', buildClockSyncPayload(game, nowMs));
}

function clearTurnTimeout(game) {
    if (!game?.turnTimeoutId) return;
    clearTimeout(game.turnTimeoutId);
    game.turnTimeoutId = null;
}

function scheduleTurnTimeout(roomId) {
    const game = activeGames.get(roomId);
    if (!game || game.finished || !hasGameStarted(game) || !isValidTeam(game.nextTurn) || !game.turnStartedAt) return;

    clearTurnTimeout(game);

    const activeClock = game.clocks?.[game.nextTurn];
    const timeoutMs = getTurnLossBudgetMs(activeClock, game.turnByoyomiRemainingMs);
    const safeTimeoutMs = Math.max(0, Math.floor(timeoutMs));

    game.turnTimeoutId = setTimeout(() => {
        const currentGame = activeGames.get(roomId);
        if (!currentGame || currentGame.finished || !hasGameStarted(currentGame)) return;

        const now = Date.now();
        const timeoutTeam = applyElapsedToActiveTurn(currentGame, now);
        if (!timeoutTeam) {
            emitClockSync(roomId, now);
            scheduleTurnTimeout(roomId);
            return;
        }

        emitClockSync(roomId, now);
        const winnerTeam = getOpponentTeam(timeoutTeam);
        io.to(roomId).emit('game_over', {
            winner: winnerTeam,
            type: 'time',
            timeoutTeam,
        });
        processGameEnd(roomId, winnerTeam, 'time');
    }, safeTimeoutMs);
}

function beginNextTurn(game, nextTurn, nowMs = Date.now()) {
    if (!game || !isValidTeam(nextTurn)) return;
    game.nextTurn = nextTurn;
    game.turnStartedAt = nowMs;
    game.turnByoyomiRemainingMs = getInitialByoyomiForTurn(game);
}

function findActiveRoomBySocketId(socketId) {
    for (const [roomId, game] of activeGames.entries()) {
        if (getTeamBySocketId(game, socketId)) {
            return roomId;
        }
    }
    return null;
}

function cancelPreGameMatch(roomId, reason = 'cancelled', cancelledBy = null) {
    const game = activeGames.get(roomId);
    if (!game || game.finished || hasGameStarted(game)) return false;

    io.to(roomId).emit('match_cancelled', { reason, cancelledBy });

    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (roomSockets) {
        for (const socketId of roomSockets) {
            const targetSocket = io.sockets.sockets.get(socketId);
            targetSocket?.leave(roomId);
        }
    }

    clearTurnTimeout(game);
    activeGames.delete(roomId);
    for (const [matchId, pendingMatch] of pendingFriendlyMatches.entries()) {
        if (pendingMatch?.roomId === roomId) {
            pendingFriendlyMatches.delete(matchId);
            break;
        }
    }
    return true;
}

function registerSessionSocket(userId, sessionId, socketId) {
    const key = getSessionKey(userId);
    const record = activeSessions.get(key);
    if (!record || record.sessionId !== sessionId) return false;
    record.sockets.add(socketId);
    return true;
}

function unregisterSessionSocket(userId, sessionId, socketId) {
    const key = getSessionKey(userId);
    const record = activeSessions.get(key);
    if (!record || record.sessionId !== sessionId) return;
    record.sockets.delete(socketId);
}

function forceResignForSocket(socketId) {
    for (const [roomId, game] of activeGames.entries()) {
        const resignTeam = getTeamBySocketId(game, socketId);
        if (!resignTeam || game.finished) continue;

        if (!hasGameStarted(game)) {
            cancelPreGameMatch(roomId, 'duplicate_login_before_start', socketId);
            return true;
        }

        const winnerTeam = getOpponentTeam(resignTeam);
        io.to(roomId).emit('game_over', {
            winner: winnerTeam,
            type: 'resign',
            resignedTeam: resignTeam,
        });
        processGameEnd(roomId, winnerTeam, 'resign');
        return true;
    }
    return false;
}

function terminateSessionSockets(userId, sessionRecord, reason = 'duplicate_login') {
    if (!sessionRecord) return;

    const socketIds = Array.from(sessionRecord.sockets || []);
    for (const socketId of socketIds) {
        forceResignForSocket(socketId);

        const targetSocket = io.sockets.sockets.get(socketId);
        if (!targetSocket) continue;
        targetSocket.emit('session_terminated', { reason });
        targetSocket.disconnect(true);
    }

    sessionRecord.sockets.clear();
}

function getSessionSocketIds(userId) {
    const record = activeSessions.get(getSessionKey(userId));
    if (!record) return [];
    return Array.from(record.sockets || []);
}

function emitToUserSockets(userId, eventName, payload) {
    const socketIds = getSessionSocketIds(userId);
    let emitted = 0;
    for (const socketId of socketIds) {
        const targetSocket = io.sockets.sockets.get(socketId);
        if (!targetSocket) continue;
        targetSocket.emit(eventName, payload);
        emitted += 1;
    }
    return emitted;
}

function buildRealtimeGameState({ roomId, choUser, hanUser, mode }) {
    const gameState = {
        cho: { id: choUser.id, socketId: choUser.socketId || null, userInfo: choUser.userInfo || null },
        han: { id: hanUser.id, socketId: hanUser.socketId || null, userInfo: hanUser.userInfo || null },
        mode,
        choSetup: null,
        hanSetup: null,
        moveLog: [],
        nextTurn: TEAM_CHO,
        clocks: {
            [TEAM_CHO]: createInitialTeamClock(),
            [TEAM_HAN]: createInitialTeamClock(),
        },
        turnStartedAt: null,
        turnByoyomiRemainingMs: null,
        turnTimeoutId: null,
        startTime: null,
        finished: false,
    };
    activeGames.set(roomId, gameState);
    return gameState;
}

function pickChoHanPlayers(p1, p2) {
    const score1 = getRankScore(p1.userInfo?.rank);
    const score2 = getRankScore(p2.userInfo?.rank);

    if (score1 < score2) return { choPlayer: p1, hanPlayer: p2 };
    if (score2 < score1) return { choPlayer: p2, hanPlayer: p1 };

    const rate1 = getWinRate(p1.userInfo);
    const rate2 = getWinRate(p2.userInfo);
    if (rate1 < rate2) return { choPlayer: p1, hanPlayer: p2 };
    if (rate2 < rate1) return { choPlayer: p2, hanPlayer: p1 };

    return Math.random() < 0.5
        ? { choPlayer: p1, hanPlayer: p2 }
        : { choPlayer: p2, hanPlayer: p1 };
}

async function pickOnlineMatchPairFromQueue() {
    if (matchQueue.length < 2) return null;

    for (let i = 0; i < matchQueue.length; i += 1) {
        const left = matchQueue[i];
        if (!left?.socket?.connected) continue;
        for (let j = i + 1; j < matchQueue.length; j += 1) {
            const right = matchQueue[j];
            if (!right?.socket?.connected) continue;

            const blocked = await areUsersBlocked(left.userInfo?.id, right.userInfo?.id);
            if (blocked) continue;

            const [first] = matchQueue.splice(j, 1);
            const [second] = matchQueue.splice(i, 1);
            return [second, first];
        }
    }
    return null;
}

function cleanupQueueDisconnectedSockets() {
    matchQueue = matchQueue.filter((queued) => queued?.socket?.connected);
}

function createOnlineMatch(choPlayer, hanPlayer) {
    const roomId = `game_${choPlayer.socket.id}_${hanPlayer.socket.id}`;
    choPlayer.socket.join(roomId);
    hanPlayer.socket.join(roomId);

    buildRealtimeGameState({
        roomId,
        choUser: { id: choPlayer.userInfo.id, socketId: choPlayer.socket.id, userInfo: choPlayer.userInfo },
        hanUser: { id: hanPlayer.userInfo.id, socketId: hanPlayer.socket.id, userInfo: hanPlayer.userInfo },
        mode: 'online',
    });

    console.log(`Match: [Cho] ${choPlayer.userInfo.nickname} vs [Han] ${hanPlayer.userInfo.nickname}`);
    choPlayer.socket.emit('match_found', { room: roomId, team: TEAM_CHO, opponent: hanPlayer.userInfo });
    hanPlayer.socket.emit('match_found', { room: roomId, team: TEAM_HAN, opponent: choPlayer.userInfo });
}

async function tryMatchQueue() {
    if (matchmakingInProgress) return;
    matchmakingInProgress = true;
    try {
        cleanupQueueDisconnectedSockets();
        while (matchQueue.length >= 2) {
            const pair = await pickOnlineMatchPairFromQueue();
            if (!pair) break;
            const { choPlayer, hanPlayer } = pickChoHanPlayers(pair[0], pair[1]);
            createOnlineMatch(choPlayer, hanPlayer);
            cleanupQueueDisconnectedSockets();
        }
    } finally {
        matchmakingInProgress = false;
    }
}

function cleanupExpiredFriendlyInvites(nowMs = Date.now()) {
    for (const [inviteId, invite] of pendingFriendlyInvites.entries()) {
        const createdAtMs = Number(invite?.createdAtMs) || 0;
        if (nowMs - createdAtMs > 60 * 1000) {
            pendingFriendlyInvites.delete(inviteId);
        }
    }
}

function cleanupExpiredFriendlyMatches(nowMs = Date.now()) {
    for (const [matchId, match] of pendingFriendlyMatches.entries()) {
        const createdAtMs = Number(match?.createdAtMs) || 0;
        if (nowMs - createdAtMs > 5 * 60 * 1000) {
            pendingFriendlyMatches.delete(matchId);
        }
    }
}

io.on('connection', (socket) => {
  // ... (connection log)
  socket._userInfo = null;
  socket._authUserId = null;
  socket._sessionId = null;

  const socketToken = getSocketAuthToken(socket);
  if (!socketToken) {
    socket.disconnect(true);
    return;
  }

  try {
    const decoded = jwt.verify(socketToken, process.env.JWT_SECRET || 'secret_key');
    if (!decoded?.id || !decoded?.sid || !isSessionActive(decoded.id, decoded.sid)) {
      socket.emit('session_terminated', { reason: 'duplicate_login' });
      socket.disconnect(true);
      return;
    }
    socket._authUserId = decoded.id;
    socket._sessionId = decoded.sid;
    registerSessionSocket(decoded.id, decoded.sid, socket.id);
  } catch (_err) {
    socket.disconnect(true);
    return;
  }

  socket.on('find_match', async (userInfo) => {
    if (!socket._authUserId || !socket._sessionId) return;
    if (!isSessionActive(socket._authUserId, socket._sessionId)) {
      socket.emit('session_terminated', { reason: 'duplicate_login' });
      socket.disconnect(true);
      return;
    }
    if (!userInfo || String(userInfo.id) !== String(socket._authUserId)) return;

    socket._userInfo = { ...userInfo, id: socket._authUserId };
    console.log(`User ${socket.id} (${userInfo?.nickname}) looking for match`);

    if (matchQueue.find((u) => u.socket.id === socket.id)) return;
    matchQueue.push({ socket, userInfo: socket._userInfo });
    await tryMatchQueue();
  });

  socket.on('friendly_invite_send', async (data = {}, callback) => {
      const respond = typeof callback === 'function' ? callback : () => {};
      if (!socket._authUserId || !socket._sessionId) return respond({ ok: false, error: 'NOT_AUTHORIZED' });
      if (!isSessionActive(socket._authUserId, socket._sessionId)) {
          socket.emit('session_terminated', { reason: 'duplicate_login' });
          socket.disconnect(true);
          return respond({ ok: false, error: 'SESSION_EXPIRED' });
      }

      const targetUserId = Number(data.targetUserId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0 || targetUserId === Number(socket._authUserId)) {
          return respond({ ok: false, error: 'INVALID_TARGET' });
      }

      try {
          cleanupExpiredFriendlyInvites();
          const isFriend = await areUsersFriends(socket._authUserId, targetUserId);
          if (!isFriend) return respond({ ok: false, error: 'NOT_FRIEND' });

          const blocked = await areUsersBlocked(socket._authUserId, targetUserId);
          if (blocked) return respond({ ok: false, error: 'BLOCKED_USER' });

          const senderInfo = await fetchUserPublicInfo(socket._authUserId);
          const targetInfo = await fetchUserPublicInfo(targetUserId);
          if (!senderInfo || !targetInfo) return respond({ ok: false, error: 'USER_NOT_FOUND' });

          const targetSocketIds = getSessionSocketIds(targetUserId)
              .filter((socketId) => Boolean(io.sockets.sockets.get(socketId)));
          if (targetSocketIds.length === 0) return respond({ ok: false, error: 'TARGET_OFFLINE' });

          const inviteId = randomUUID();
          pendingFriendlyInvites.set(inviteId, {
              inviteId,
              fromUserId: Number(socket._authUserId),
              toUserId: targetUserId,
              fromInfo: senderInfo,
              toInfo: targetInfo,
              createdAtMs: Date.now(),
              status: 'pending',
          });

          emitToUserSockets(targetUserId, 'friendly_invite_received', {
              inviteId,
              from: senderInfo,
          });
          respond({ ok: true, inviteId });
      } catch (err) {
          console.error(err);
          respond({ ok: false, error: 'SERVER_ERROR' });
      }
  });

  socket.on('friendly_invite_decline', (data = {}, callback) => {
      const respond = typeof callback === 'function' ? callback : () => {};
      const inviteId = typeof data.inviteId === 'string' ? data.inviteId : '';
      const invite = pendingFriendlyInvites.get(inviteId);
      if (!invite) return respond({ ok: true });
      if (invite.toUserId !== Number(socket._authUserId)) return respond({ ok: false, error: 'NOT_ALLOWED' });

      pendingFriendlyInvites.delete(inviteId);
      emitToUserSockets(invite.fromUserId, 'friendly_invite_declined', { inviteId, toUserId: invite.toUserId });
      respond({ ok: true });
  });

  socket.on('friendly_invite_accept', async (data = {}, callback) => {
      const respond = typeof callback === 'function' ? callback : () => {};
      if (!socket._authUserId || !socket._sessionId) return respond({ ok: false, error: 'NOT_AUTHORIZED' });

      const inviteId = typeof data.inviteId === 'string' ? data.inviteId : '';
      const invite = pendingFriendlyInvites.get(inviteId);
      if (!invite) return respond({ ok: false, error: 'INVITE_NOT_FOUND' });
      if (invite.toUserId !== Number(socket._authUserId)) return respond({ ok: false, error: 'NOT_ALLOWED' });

      cleanupExpiredFriendlyInvites();
      cleanupExpiredFriendlyMatches();
      if (!pendingFriendlyInvites.has(inviteId)) return respond({ ok: false, error: 'INVITE_EXPIRED' });

      try {
          const blocked = await areUsersBlocked(invite.fromUserId, invite.toUserId);
          if (blocked) {
              pendingFriendlyInvites.delete(inviteId);
              return respond({ ok: false, error: 'BLOCKED_USER' });
          }

          const stillFriends = await areUsersFriends(invite.fromUserId, invite.toUserId);
          if (!stillFriends) {
              pendingFriendlyInvites.delete(inviteId);
              return respond({ ok: false, error: 'NOT_FRIEND' });
          }

          const fromInfo = await fetchUserPublicInfo(invite.fromUserId);
          const toInfo = await fetchUserPublicInfo(invite.toUserId);
          if (!fromInfo || !toInfo) {
              pendingFriendlyInvites.delete(inviteId);
              return respond({ ok: false, error: 'USER_NOT_FOUND' });
          }

          const pair = pickChoHanPlayers({ userInfo: fromInfo }, { userInfo: toInfo });
          const fromIsCho = pair.choPlayer.userInfo.id === fromInfo.id;
          const choInfo = fromIsCho ? fromInfo : toInfo;
          const hanInfo = fromIsCho ? toInfo : fromInfo;
          const matchId = randomUUID();

          pendingFriendlyMatches.set(matchId, {
              matchId,
              roomId: `friendly_${matchId}`,
              choUserId: choInfo.id,
              hanUserId: hanInfo.id,
              choInfo,
              hanInfo,
              createdAtMs: Date.now(),
          });
          pendingFriendlyInvites.delete(inviteId);

          emitToUserSockets(invite.fromUserId, 'friendly_match_ready', {
              matchId,
              opponent: toInfo,
          });
          emitToUserSockets(invite.toUserId, 'friendly_match_ready', {
              matchId,
              opponent: fromInfo,
          });
          respond({ ok: true, matchId });
      } catch (err) {
          console.error(err);
          respond({ ok: false, error: 'SERVER_ERROR' });
      }
  });

  socket.on('join_friendly_match', async (data = {}, callback) => {
      const respond = typeof callback === 'function' ? callback : () => {};
      if (!socket._authUserId || !socket._sessionId) return respond({ ok: false, error: 'NOT_AUTHORIZED' });
      if (!isSessionActive(socket._authUserId, socket._sessionId)) {
          socket.emit('session_terminated', { reason: 'duplicate_login' });
          socket.disconnect(true);
          return respond({ ok: false, error: 'SESSION_EXPIRED' });
      }

      const matchId = typeof data.matchId === 'string' ? data.matchId : '';
      cleanupExpiredFriendlyMatches();
      const pendingMatch = pendingFriendlyMatches.get(matchId);
      if (!pendingMatch) return respond({ ok: false, error: 'MATCH_NOT_FOUND' });

      const currentUserId = Number(socket._authUserId);
      const myTeam = pendingMatch.choUserId === currentUserId
          ? TEAM_CHO
          : pendingMatch.hanUserId === currentUserId
              ? TEAM_HAN
              : null;
      if (!myTeam) return respond({ ok: false, error: 'NOT_ALLOWED' });

      const roomId = pendingMatch.roomId;
      let game = activeGames.get(roomId);
      if (!game) {
          game = buildRealtimeGameState({
              roomId,
              choUser: { id: pendingMatch.choUserId, socketId: null, userInfo: pendingMatch.choInfo },
              hanUser: { id: pendingMatch.hanUserId, socketId: null, userInfo: pendingMatch.hanInfo },
              mode: 'friendly',
          });
      }

      if (myTeam === TEAM_CHO) {
          game.cho.socketId = socket.id;
          game.cho.userInfo = pendingMatch.choInfo;
      } else {
          game.han.socketId = socket.id;
          game.han.userInfo = pendingMatch.hanInfo;
      }
      socket.join(roomId);

      const opponentInfo = myTeam === TEAM_CHO ? pendingMatch.hanInfo : pendingMatch.choInfo;
      socket.emit('match_found', {
          room: roomId,
          team: myTeam,
          opponent: opponentInfo,
          mode: 'friendly',
      });

      if (game.cho?.socketId && game.han?.socketId) {
          pendingFriendlyMatches.delete(matchId);
      }
      respond({ ok: true, roomId, team: myTeam });
  });

  // Setup Sync
  socket.on('submit_setup', (data) => {
      // data: { room, team, setupType }
      const game = activeGames.get(data.room);
      if (game && isValidTeam(data.team)) {
          if (data.team === TEAM_CHO) game.choSetup = data.setupType;
          if (data.team === TEAM_HAN) game.hanSetup = data.setupType;

          if (hasGameStarted(game) && !game.turnStartedAt) {
              game.startTime = new Date();
              beginNextTurn(game, TEAM_CHO, Date.now());
              emitClockSync(data.room);
              scheduleTurnTimeout(data.room);
          }
      }
      // Relay to opponent
      socket.to(data.room).emit('opponent_setup', { team: data.team, setupType: data.setupType });
  });

  socket.on('cancel_match', (data = {}) => {
      matchQueue = matchQueue.filter((u) => u.socket.id !== socket.id);
      const roomId = data.room || findActiveRoomBySocketId(socket.id);
      if (!roomId) return;
      cancelPreGameMatch(roomId, data.reason || 'cancelled', socket.id);
  });

  socket.on('move', (data) => {
    const game = activeGames.get(data.room);
    if (!game || game.finished) return;
    if (!hasGameStarted(game)) return;

    const actorTeam = getTeamBySocketId(game, socket.id);
    if (!actorTeam) return;
    if (game.nextTurn !== actorTeam) return;
    if (!data?.move || !isValidPosition(data.move.from) || !isValidPosition(data.move.to)) return;

    const now = Date.now();
    const timeoutTeam = applyElapsedToActiveTurn(game, now);
    if (timeoutTeam) {
        const winnerTeam = getOpponentTeam(timeoutTeam);
        emitClockSync(data.room, now);
        io.to(data.room).emit('game_over', { winner: winnerTeam, type: 'time', timeoutTeam });
        processGameEnd(data.room, winnerTeam, 'time');
        return;
    }

    const moveTimestamp = new Date(now).toISOString();
    game.moveLog.push({
        type: 'move',
        turn: actorTeam,
        from: data.move.from,
        to: data.move.to,
        at: moveTimestamp,
    });
    beginNextTurn(game, getOpponentTeam(actorTeam), now);

    socket.to(data.room).emit('move', data.move);
    emitClockSync(data.room, now);
    scheduleTurnTimeout(data.room);
  });
  
  socket.on('pass', (data) => {
      const game = activeGames.get(data.room);
      if (!game || game.finished) return;
      if (!hasGameStarted(game)) return;

      const actorTeam = getTeamBySocketId(game, socket.id);
      if (!actorTeam) return;
      if (game.nextTurn !== actorTeam) return;

      const now = Date.now();
      const timeoutTeam = applyElapsedToActiveTurn(game, now);
      if (timeoutTeam) {
          const winnerTeam = getOpponentTeam(timeoutTeam);
          emitClockSync(data.room, now);
          io.to(data.room).emit('game_over', { winner: winnerTeam, type: 'time', timeoutTeam });
          processGameEnd(data.room, winnerTeam, 'time');
          return;
      }

      const passTimestamp = new Date(now).toISOString();
      game.moveLog.push({
          type: 'pass',
          turn: actorTeam,
          at: passTimestamp,
      });
      beginNextTurn(game, getOpponentTeam(actorTeam), now);

      socket.to(data.room).emit('pass_turn', { team: actorTeam, at: passTimestamp });
      emitClockSync(data.room, now);
      scheduleTurnTimeout(data.room);
  });
  
  socket.on('resign', (data) => {
      const game = activeGames.get(data.room);
      if (!game || game.finished) return;

      if (!hasGameStarted(game)) {
          cancelPreGameMatch(data.room, 'cancelled', socket.id);
          return;
      }

      const resignTeam = getTeamBySocketId(game, socket.id);
      if (!resignTeam) return;

      const winnerTeam = getOpponentTeam(resignTeam);
      io.to(data.room).emit('game_over', {
          winner: winnerTeam,
          type: 'resign',
          resignedTeam: resignTeam,
      });
      processGameEnd(data.room, winnerTeam, 'resign');
  });
  
  socket.on('checkmate', (data) => {
      const game = activeGames.get(data.room);
      if (!game || game.finished || !isValidTeam(data.winner)) return;
      if (!hasGameStarted(game)) return;

      const senderTeam = getTeamBySocketId(game, socket.id);
      if (!senderTeam) return;

      const expectedWinner = getOpponentTeam(game.nextTurn);
      if (data.winner !== expectedWinner) return;
      if (senderTeam !== game.nextTurn && senderTeam !== expectedWinner) return;

      io.to(data.room).emit('game_over', { winner: data.winner, type: 'checkmate' });
      processGameEnd(data.room, data.winner, 'checkmate');
  });

  socket.on('finish_by_rule', (data) => {
      const game = activeGames.get(data.room);
      if (!game || game.finished) return;
      if (!hasGameStarted(game)) return;
      if (!isValidTeam(data?.winner)) return;

      const senderTeam = getTeamBySocketId(game, socket.id);
      if (!senderTeam) return;

      const normalizedType = typeof data.type === 'string' ? data.type.trim().toLowerCase() : '';
      if (normalizedType !== 'score') return;

      io.to(data.room).emit('game_over', { winner: data.winner, type: normalizedType });
      processGameEnd(data.room, data.winner, normalizedType);
  });

  socket.on('disconnect', () => {
    // Handle disconnection
    if (socket._authUserId && socket._sessionId) {
        unregisterSessionSocket(socket._authUserId, socket._sessionId, socket.id);
    }
    matchQueue = matchQueue.filter(u => u.socket.id !== socket.id);

    for (const [roomId, game] of activeGames.entries()) {
        const disconnectedTeam = getTeamBySocketId(game, socket.id);
        if (!disconnectedTeam || game.finished) continue;

        if (!hasGameStarted(game)) {
            cancelPreGameMatch(roomId, 'disconnect_before_start', socket.id);
            break;
        }

        const winnerTeam = getOpponentTeam(disconnectedTeam);
        io.to(roomId).emit('game_over', { winner: winnerTeam, type: 'time' });
        processGameEnd(roomId, winnerTeam, 'time');
        break;
    }
  });
});

async function processGameEnd(roomId, winnerTeam, resultType = 'unknown') {
    const game = activeGames.get(roomId);
    if (!game || game.finished || !isValidTeam(winnerTeam)) return;
    game.finished = true;
    clearTurnTimeout(game);

    const winnerId = winnerTeam === TEAM_CHO ? game.cho.id : game.han.id;
    const loserId = winnerTeam === TEAM_CHO ? game.han.id : game.cho.id;
    const loserTeam = getOpponentTeam(winnerTeam);
    const gameMode = game.mode || 'online';

    const moveLog = Array.isArray(game.moveLog) ? game.moveLog : [];
    const replayPayload = {
        version: 2,
        choSetup: game.choSetup,
        hanSetup: game.hanSetup,
        moveLog,
    };
    const startedAt = game.startTime || new Date();
    const endedAt = new Date();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const winnerUserResult = await client.query(
            `SELECT id, rank, wins, losses, rank_wins, rank_losses, rating
             FROM users
             WHERE id = $1
             FOR UPDATE`,
            [winnerId],
        );
        const loserUserResult = await client.query(
            `SELECT id, rank, wins, losses, rank_wins, rank_losses, rating
             FROM users
             WHERE id = $1
             FOR UPDATE`,
            [loserId],
        );

        if (winnerUserResult.rows.length === 0 || loserUserResult.rows.length === 0) {
            throw new Error('Winner or loser user not found');
        }

        const winnerUser = winnerUserResult.rows[0];
        const loserUser = loserUserResult.rows[0];

        const winnerRankState = resolveRankAfterResult(
            winnerUser.rank,
            winnerUser.rank_wins,
            winnerUser.rank_losses,
            'win',
        );
        const loserRankState = resolveRankAfterResult(
            loserUser.rank,
            loserUser.rank_wins,
            loserUser.rank_losses,
            'loss',
        );

        // ELO rating calculation
        const { newWinnerRating, newLoserRating, ratingChange } = calculateElo(
            winnerUser.rating || ELO_DEFAULT_RATING,
            loserUser.rating  || ELO_DEFAULT_RATING,
        );

        // Update total stats, rank progress, and ELO rating.
        await client.query(
            `UPDATE users
             SET wins = $2,
                 losses = $3,
                 rank = $4,
                 rank_wins = $5,
                 rank_losses = $6,
                 rating = $7
             WHERE id = $1`,
            [
                winnerId,
                normalizeCounter(winnerUser.wins) + 1,
                normalizeCounter(winnerUser.losses),
                winnerRankState.rank,
                winnerRankState.rankWins,
                winnerRankState.rankLosses,
                newWinnerRating,
            ],
        );
        await client.query(
            `UPDATE users
             SET wins = $2,
                 losses = $3,
                 rank = $4,
                 rank_wins = $5,
                 rank_losses = $6,
                 rating = $7
             WHERE id = $1`,
            [
                loserId,
                normalizeCounter(loserUser.wins),
                normalizeCounter(loserUser.losses) + 1,
                loserRankState.rank,
                loserRankState.rankWins,
                loserRankState.rankLosses,
                newLoserRating,
            ],
        );

        // Save Game Record
        await client.query(
            `INSERT INTO games (
                winner_id, loser_id, game_mode, winner_team, loser_team,
                moves, cho_setup, han_setup, move_log, result_type, move_count, started_at, ended_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)`,
            [
                winnerId,
                loserId,
                gameMode,
                winnerTeam,
                loserTeam,
                JSON.stringify(replayPayload), // backward compatibility
                game.choSetup,
                game.hanSetup,
                JSON.stringify(moveLog),
                resultType,
                moveLog.length,
                startedAt,
                endedAt,
            ]
        );

        await client.query('COMMIT');
        console.log(
            `Game ${roomId} ended. Winner: ${winnerId}, saved ${moveLog.length} ply. ` +
            `winner rank ${winnerUser.rank} -> ${winnerRankState.rank}, ` +
            `loser rank ${loserUser.rank} -> ${loserRankState.rank}. ` +
            `ELO: winner ${winnerUser.rating} -> ${newWinnerRating} (+${ratingChange}), ` +
            `loser ${loserUser.rating} -> ${newLoserRating} (-${ratingChange})`,
        );
        activeGames.delete(roomId);
        for (const [matchId, pendingMatch] of pendingFriendlyMatches.entries()) {
            if (pendingMatch?.roomId === roomId) {
                pendingFriendlyMatches.delete(matchId);
                break;
            }
        }
    } catch (err) {
        await client.query('ROLLBACK');
        game.finished = false;
        console.error("Error processing game end:", err);
    } finally {
        client.release();
    }
}


// --- Replay / Game History API ---
app.get('/api/games', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                g.id,
                g.played_at,
                g.started_at,
                g.ended_at,
                COALESCE(g.game_mode, 'online') AS game_mode,
                g.winner_team,
                g.loser_team,
                COALESCE(g.result_type, 'unknown') AS result_type,
                COALESCE(
                    g.move_count,
                    CASE
                        WHEN g.move_log IS NOT NULL AND jsonb_typeof(g.move_log) = 'array'
                            THEN jsonb_array_length(g.move_log)
                        ELSE 0
                    END
                ) AS move_count,
                COALESCE(
                    u1.nickname,
                    CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
                ) AS winner_name,
                COALESCE(
                    u2.nickname,
                    CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
                ) AS loser_name,
                CASE
                    WHEN g.winner_team = 'cho'
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                END AS cho_name,
                CASE
                    WHEN g.winner_team = 'han'
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                END AS han_name,
                CASE
                    WHEN g.winner_id = $1 THEN 'win'
                    WHEN g.loser_id = $1 THEN 'loss'
                    ELSE 'draw'
                END AS my_result,
                CASE
                    WHEN g.winner_id = $1 THEN g.winner_team
                    WHEN g.loser_id = $1 THEN g.loser_team
                    ELSE NULL
                END AS my_team,
                CASE
                    WHEN g.winner_id = $1
                        THEN COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    WHEN g.loser_id = $1
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE NULL
                END AS opponent_name
            FROM games g
            LEFT JOIN users u1 ON g.winner_id = u1.id
            LEFT JOIN users u2 ON g.loser_id = u2.id
            WHERE g.winner_id = $1 OR g.loser_id = $1
            ORDER BY g.played_at DESC
            LIMIT 50
        `, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'DB Error' });
    }
});

app.get('/api/games/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                g.*,
                COALESCE(
                    u1.nickname,
                    CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
                ) AS winner_name,
                COALESCE(
                    u2.nickname,
                    CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
                ) AS loser_name,
                CASE
                    WHEN g.winner_team = 'cho'
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                END AS cho_name,
                CASE
                    WHEN g.winner_team = 'han'
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                END AS han_name
            FROM games g
            LEFT JOIN users u1 ON g.winner_id = u1.id
            LEFT JOIN users u2 ON g.loser_id = u2.id
            WHERE g.id = $1
              AND (
                  g.winner_id = $2
                  OR g.loser_id = $2
                  OR EXISTS (
                      SELECT 1
                      FROM friendships f
                      WHERE f.user_id = $2
                        AND (f.friend_id = g.winner_id OR f.friend_id = g.loser_id)
                  )
              )
        `, [req.params.id, req.user.id]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        const game = result.rows[0];

        // Backfill new fields from legacy moves payload if this is an old record.
        if ((!Array.isArray(game.move_log) || game.move_log.length === 0) && game.moves) {
            try {
                const parsed = JSON.parse(game.moves);
                if (parsed && parsed.version === 2 && Array.isArray(parsed.moveLog)) {
                    game.move_log = parsed.moveLog;
                    game.cho_setup = game.cho_setup || parsed.choSetup;
                    game.han_setup = game.han_setup || parsed.hanSetup;
                    game.move_count = game.move_count || parsed.moveLog.length;
                } else if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0].board)) {
                    game.move_count = game.move_count || Math.max(parsed.length - 1, 0);
                }
            } catch (_err) {
                // Keep legacy data as-is; frontend can still parse old frame arrays from `moves`.
            }
        }

        if (game.move_count == null) {
            game.move_count = Array.isArray(game.move_log) ? game.move_log.length : 0;
        }

        res.json(game);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'DB Error' });
    }
});

// Handle React routing
app.get(/.*/, (req, res) => {
    if (req.url.startsWith('/api')) return res.status(404).json({ error: 'API route not found'});

    const indexFile = path.join(__dirname, '../frontend/dist', 'index.html');
    res.sendFile(indexFile, (err) => {
        if (err) {
             // Fallback for dev mode without build
            res.status(500).send("Backend running. Frontend build not found.");
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
