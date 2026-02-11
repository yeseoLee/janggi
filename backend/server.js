const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

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
      'INSERT INTO users (username, password, nickname, coins) VALUES ($1, $2, $3, $4) RETURNING id, username, nickname, rank, coins',
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
    const result = await pool.query('SELECT id, username, nickname, rank, wins, losses, coins FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.sendStatus(404);
    res.json(result.rows[0]);
  } catch (err) {
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
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                winner_id INTEGER REFERENCES users(id),
                loser_id INTEGER REFERENCES users(id),
                winner_team VARCHAR(10),
                loser_team VARCHAR(10),
                moves TEXT, -- JSON string of move history (Gibo)
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("DB: Games table checked/created");
    } catch (err) {
        console.error("DB Init Error:", err);
    }
};
initDB();

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

// Game State Memory
const activeGames = new Map(); // roomId -> { cho: {id, socketId}, han: {id, socketId}, history: [] }

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
          startTime: new Date()
      });

      console.log(`Match: [Cho] ${choPlayer.userInfo.nickname} vs [Han] ${hanPlayer.userInfo.nickname}`);

      activeGames.set(roomId, {
          cho: { id: choPlayer.userInfo.id, socketId: choPlayer.socket.id },
          han: { id: hanPlayer.userInfo.id, socketId: hanPlayer.socket.id },
          startTime: new Date()
      });

      // Notify match found - Clients enters Setup Phase
      choPlayer.socket.emit('match_found', { room: roomId, team: 'cho', opponent: hanPlayer.userInfo });
      hanPlayer.socket.emit('match_found', { room: roomId, team: 'han', opponent: choPlayer.userInfo });
    }
  });

  // Setup Sync
  socket.on('submit_setup', (data) => {
      // data: { room, team, setupType }
      // Relay to opponent
      socket.to(data.room).emit('opponent_setup', { team: data.team, setupType: data.setupType });
  });

  socket.on('move', (data) => {
    socket.to(data.room).emit('move', data.move);
    // Optional: Store move in history in activeGames for Gibo consistency
  });
  
  socket.on('pass', (data) => {
      socket.to(data.room).emit('pass_turn');
  });
  
  socket.on('resign', (data) => {
      const winnerTeam = data.team === 'cho' ? 'han' : 'cho';
      io.to(data.room).emit('game_over', { winner: winnerTeam, type: 'resign' });
      processGameEnd(data.room, winnerTeam, data.history);
  });
  
  socket.on('checkmate', (data) => {
      io.to(data.room).emit('game_over', { winner: data.winner, type: 'checkmate' });
      processGameEnd(data.room, data.winner, data.history);
  });

  socket.on('disconnect', () => {
    // Handle disconnection
    matchQueue = matchQueue.filter(u => u.socket.id !== socket.id);
    // If in game, logic (optional MVP: Auto resign?)
  });
});

async function processGameEnd(roomId, winnerTeam, history) {
    const game = activeGames.get(roomId);
    if (!game) return;

    const winnerId = winnerTeam === 'cho' ? game.cho.id : game.han.id;
    const loserId = winnerTeam === 'cho' ? game.han.id : game.cho.id;
    const winnerRole = winnerTeam;
    const loserRole = winnerTeam === 'cho' ? 'han' : 'cho';

    try {
        // Update Stats
        await pool.query('UPDATE users SET wins = wins + 1, coins = coins + 5 WHERE id = $1', [winnerId]);
        await pool.query('UPDATE users SET losses = losses + 1 WHERE id = $1', [loserId]);
        
        // Save Game Record
        await pool.query(
            'INSERT INTO games (winner_id, loser_id, winner_team, loser_team, moves) VALUES ($1, $2, $3, $4, $5)',
            [winnerId, loserId, winnerRole, loserRole, JSON.stringify(history)]
        );
        console.log(`Game ${roomId} ended. Winner: ${winnerId}, Saved to DB.`);
        
        activeGames.delete(roomId);
    } catch (err) {
        console.error("Error processing game end:", err);
    }
}


// --- Replay / Game History API ---
app.get('/api/games', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT g.id, g.played_at, g.winner_team, g.loser_team,
                   u1.nickname as winner_name, u2.nickname as loser_name
            FROM games g
            JOIN users u1 ON g.winner_id = u1.id
            JOIN users u2 ON g.loser_id = u2.id
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
            SELECT g.*, 
                   u1.nickname as winner_name, u2.nickname as loser_name
            FROM games g
            JOIN users u1 ON g.winner_id = u1.id
            JOIN users u2 ON g.loser_id = u2.id
            WHERE g.id = $1
        `, [req.params.id]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        res.json(result.rows[0]);
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
