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


// Socket.io Logic
let matchQueue = [];

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('find_match', (userInfo) => {
    console.log(`User ${socket.id} (Rank: ${userInfo?.rank}) looking for match`);
    
    // Check if user is already in queue
    if (matchQueue.find(u => u.id === socket.id)) return;

    matchQueue.push({ socket, userInfo });

    if (matchQueue.length >= 2) {
      const player1 = matchQueue.shift();
      const player2 = matchQueue.shift();

      const roomId = `game_${player1.socket.id}_${player2.socket.id}`;
      
      player1.socket.join(roomId);
      player2.socket.join(roomId);

      // Assign teams: Player 1 = Cho (Blue, First), Player 2 = Han (Red, Second)
      // In Janggi, Cho moves first.
      
      console.log(`Match found: ${player1.socket.id} vs ${player2.socket.id} in ${roomId}`);

      player1.socket.emit('start_game', { room: roomId, team: 'cho', opponent: player2.userInfo });
      player2.socket.emit('start_game', { room: roomId, team: 'han', opponent: player1.userInfo });
    }
  });

  socket.on('move', (data) => {
    // data: { room, move: { from, to }, turn }
    // Relay move to the other player in the room
    socket.to(data.room).emit('move', data.move);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Remove from queue if waiting
    matchQueue = matchQueue.filter(u => u.socket.id !== socket.id);
  });
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
