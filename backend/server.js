const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // Allow Vite dev server
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Serve static files from frontend build (production)
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// API Endpoints (Placeholder)
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', players: io.engine.clientsCount });
});

// Socket.io Logic
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join_game', (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room ${room}`);
  });

  socket.on('move', (data) => {
    // Broadcast move to others in room
    socket.to(data.room).emit('move', data.move);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Handle React routing, return all requests to React app
app.get(/.*/, (req, res) => {
  // If in production/build mode:
  const indexFile = path.join(__dirname, '../frontend/dist', 'index.html');
  // Check if file exists, else send basic message or 404 (in dev mode)
  res.sendFile(indexFile, (err) => {
      if (err) {
          res.status(500).send("Server is running. Frontend build not found. Run 'npm run build' in frontend/.");
      }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
