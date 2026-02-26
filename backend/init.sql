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
    rating INTEGER DEFAULT 1000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

CREATE INDEX IF NOT EXISTS idx_games_played_at ON games (played_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_move_count ON games (move_count DESC);
