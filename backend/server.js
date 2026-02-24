const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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
    res.status(201).json({ message: 'User registered', user: result.rows[0] });
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

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'secret_key', { expiresIn: '1h' });
    
    // Return user info without password
    const { password: _, ...userInfo } = user;
    res.json({ token, user: userInfo });
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
    res.json(result.rows[0]);
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
        // Forward-only, idempotent migration for existing installations.
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS cho_setup VARCHAR(50);`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS han_setup VARCHAR(50);`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS move_log JSONB;`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS result_type VARCHAR(20);`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS move_count INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;`);
        await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP;`);

        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_wins INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_losses INTEGER DEFAULT 0;`);
        await pool.query(`UPDATE users SET rank_wins = COALESCE(rank_wins, 0), rank_losses = COALESCE(rank_losses, 0);`);

        // ELO rating column — default 1000 for all new and existing users.
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT ${ELO_DEFAULT_RATING};`);
        await pool.query(`UPDATE users SET rating = ${ELO_DEFAULT_RATING} WHERE rating IS NULL OR rating = 0;`);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_games_played_at ON games (played_at DESC);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_games_move_count ON games (move_count DESC);`);

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

const TEAM_CHO = 'cho';
const TEAM_HAN = 'han';

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

function getTeamBySocketId(game, socketId) {
    if (!game) return null;
    if (game.cho?.socketId === socketId) return TEAM_CHO;
    if (game.han?.socketId === socketId) return TEAM_HAN;
    return null;
}

// Game State Memory
// roomId -> { cho, han, choSetup, hanSetup, moveLog, nextTurn, startTime, finished }
const activeGames = new Map();

// Socket.io Logic
let matchQueue = [];

io.on('connection', (socket) => {
  // ... (connection log)
  socket._userInfo = null; 

  socket.on('find_match', (userInfo) => {
    socket._userInfo = userInfo; 
    console.log(`User ${socket.id} (${userInfo?.nickname}) looking for match`);
    
    if (matchQueue.find(u => u.id === socket.id)) return;
    matchQueue.push({ socket, userInfo });

    if (matchQueue.length >= 2) {
      const p1 = matchQueue.shift();
      const p2 = matchQueue.shift();
      
      const score1 = getRankScore(p1.userInfo?.rank);
      const score2 = getRankScore(p2.userInfo?.rank);
      
      let choPlayer, hanPlayer;
      
      if (score1 < score2) {
          choPlayer = p1; hanPlayer = p2;
      } else if (score2 < score1) {
          choPlayer = p2; hanPlayer = p1;
      } else {
          // Rank Tied -> Check Win Rate
          const rate1 = getWinRate(p1.userInfo);
          const rate2 = getWinRate(p2.userInfo);
          if (rate1 < rate2) {
              choPlayer = p1; hanPlayer = p2;
          } else if (rate2 < rate1) {
              choPlayer = p2; hanPlayer = p1;
          } else {
              // Tied -> Random
              if (Math.random() < 0.5) {
                  choPlayer = p1; hanPlayer = p2;
              } else {
                  choPlayer = p2; hanPlayer = p1;
              }
          }
      }

      const roomId = `game_${choPlayer.socket.id}_${hanPlayer.socket.id}`;
      choPlayer.socket.join(roomId);
      hanPlayer.socket.join(roomId);
      
      // Store Game State
      activeGames.set(roomId, {
          cho: { id: choPlayer.userInfo.id, socketId: choPlayer.socket.id },
          han: { id: hanPlayer.userInfo.id, socketId: hanPlayer.socket.id },
          choSetup: null,
          hanSetup: null,
          moveLog: [],
          nextTurn: TEAM_CHO,
          startTime: new Date(),
          finished: false,
      });

      console.log(`Match: [Cho] ${choPlayer.userInfo.nickname} vs [Han] ${hanPlayer.userInfo.nickname}`);

      // Notify match found - Clients enters Setup Phase
      choPlayer.socket.emit('match_found', { room: roomId, team: 'cho', opponent: hanPlayer.userInfo });
      hanPlayer.socket.emit('match_found', { room: roomId, team: 'han', opponent: choPlayer.userInfo });
    }
  });

  // Setup Sync
  socket.on('submit_setup', (data) => {
      // data: { room, team, setupType }
      const game = activeGames.get(data.room);
      if (game && isValidTeam(data.team)) {
          if (data.team === TEAM_CHO) game.choSetup = data.setupType;
          if (data.team === TEAM_HAN) game.hanSetup = data.setupType;
      }
      // Relay to opponent
      socket.to(data.room).emit('opponent_setup', { team: data.team, setupType: data.setupType });
  });

  socket.on('move', (data) => {
    const game = activeGames.get(data.room);
    if (!game || game.finished) return;

    const actorTeam = getTeamBySocketId(game, socket.id);
    if (!actorTeam) return;
    if (game.nextTurn !== actorTeam) return;
    if (!data?.move || !isValidPosition(data.move.from) || !isValidPosition(data.move.to)) return;

    game.moveLog.push({
        type: 'move',
        turn: actorTeam,
        from: data.move.from,
        to: data.move.to,
        at: new Date().toISOString(),
    });
    game.nextTurn = getOpponentTeam(actorTeam);

    socket.to(data.room).emit('move', data.move);
  });
  
  socket.on('pass', (data) => {
      const game = activeGames.get(data.room);
      if (!game || game.finished) return;

      const actorTeam = getTeamBySocketId(game, socket.id);
      if (!actorTeam) return;
      if (game.nextTurn !== actorTeam) return;

      game.moveLog.push({
          type: 'pass',
          turn: actorTeam,
          at: new Date().toISOString(),
      });
      game.nextTurn = getOpponentTeam(actorTeam);

      socket.to(data.room).emit('pass_turn');
  });
  
  socket.on('resign', (data) => {
      const game = activeGames.get(data.room);
      if (!game || game.finished) return;

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

      const senderTeam = getTeamBySocketId(game, socket.id);
      if (!senderTeam) return;

      const expectedWinner = getOpponentTeam(game.nextTurn);
      if (data.winner !== expectedWinner) return;
      if (senderTeam !== game.nextTurn && senderTeam !== expectedWinner) return;

      io.to(data.room).emit('game_over', { winner: data.winner, type: 'checkmate' });
      processGameEnd(data.room, data.winner, 'checkmate');
  });

  socket.on('disconnect', () => {
    // Handle disconnection
    matchQueue = matchQueue.filter(u => u.socket.id !== socket.id);

    for (const [roomId, game] of activeGames.entries()) {
        const disconnectedTeam = getTeamBySocketId(game, socket.id);
        if (!disconnectedTeam || game.finished) continue;

        const winnerTeam = getOpponentTeam(disconnectedTeam);
        io.to(roomId).emit('game_over', { winner: winnerTeam, type: 'disconnect' });
        processGameEnd(roomId, winnerTeam, 'disconnect');
        break;
    }
  });
});

async function processGameEnd(roomId, winnerTeam, resultType = 'unknown') {
    const game = activeGames.get(roomId);
    if (!game || game.finished || !isValidTeam(winnerTeam)) return;
    game.finished = true;

    const winnerId = winnerTeam === TEAM_CHO ? game.cho.id : game.han.id;
    const loserId = winnerTeam === TEAM_CHO ? game.han.id : game.cho.id;
    const loserTeam = getOpponentTeam(winnerTeam);

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
                winner_id, loser_id, winner_team, loser_team,
                moves, cho_setup, han_setup, move_log, result_type, move_count, started_at, ended_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
            [
                winnerId,
                loserId,
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
    } catch (err) {
        await client.query('ROLLBACK');
        game.finished = false;
        console.error("Error processing game end:", err);
    } finally {
        client.release();
    }
}


// --- Replay / Game History API ---
app.get('/api/games', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                g.id,
                g.played_at,
                g.started_at,
                g.ended_at,
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
                u1.nickname AS winner_name,
                u2.nickname AS loser_name,
                CASE WHEN g.winner_team = 'cho' THEN u1.nickname ELSE u2.nickname END AS cho_name,
                CASE WHEN g.winner_team = 'han' THEN u1.nickname ELSE u2.nickname END AS han_name
            FROM games g
            LEFT JOIN users u1 ON g.winner_id = u1.id
            LEFT JOIN users u2 ON g.loser_id = u2.id
            ORDER BY g.played_at DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'DB Error' });
    }
});

app.get('/api/games/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                g.*,
                u1.nickname AS winner_name,
                u2.nickname AS loser_name,
                CASE WHEN g.winner_team = 'cho' THEN u1.nickname ELSE u2.nickname END AS cho_name,
                CASE WHEN g.winner_team = 'han' THEN u1.nickname ELSE u2.nickname END AS han_name
            FROM games g
            LEFT JOIN users u1 ON g.winner_id = u1.id
            LEFT JOIN users u2 ON g.loser_id = u2.id
            WHERE g.id = $1
        `, [req.params.id]);
        
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
