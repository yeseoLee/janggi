package dataaccess

import (
	"context"
	"fmt"

	"github.com/yeseolee/janggi/api-server/internal/domain"
)

func InitDB(ctx context.Context, db DBQuerier) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
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
                ai_unlocked_tier INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
		`CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                winner_id INTEGER REFERENCES users(id),
                loser_id INTEGER REFERENCES users(id),
                game_mode VARCHAR(20) DEFAULT 'online',
                winner_team VARCHAR(10),
                loser_team VARCHAR(10),
                moves TEXT,
                cho_setup VARCHAR(50),
                han_setup VARCHAR(50),
                move_log JSONB,
                result_type VARCHAR(20),
                move_count INTEGER DEFAULT 0,
                started_at TIMESTAMP,
                ended_at TIMESTAMP,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
		`CREATE TABLE IF NOT EXISTS friendships (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, friend_id),
                CHECK (user_id <> friend_id)
            )`,
		`CREATE TABLE IF NOT EXISTS villains (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, target_user_id),
                CHECK (user_id <> target_user_id)
            )`,
		`CREATE TABLE IF NOT EXISTS friend_requests (
                id SERIAL PRIMARY KEY,
                requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CHECK (requester_id <> addressee_id)
            )`,
		`ALTER TABLE games ADD COLUMN IF NOT EXISTS cho_setup VARCHAR(50)`,
		`ALTER TABLE games ADD COLUMN IF NOT EXISTS han_setup VARCHAR(50)`,
		`ALTER TABLE games ADD COLUMN IF NOT EXISTS move_log JSONB`,
		`ALTER TABLE games ADD COLUMN IF NOT EXISTS game_mode VARCHAR(20) DEFAULT 'online'`,
		`ALTER TABLE games ADD COLUMN IF NOT EXISTS result_type VARCHAR(20)`,
		`ALTER TABLE games ADD COLUMN IF NOT EXISTS move_count INTEGER DEFAULT 0`,
		`ALTER TABLE games ADD COLUMN IF NOT EXISTS started_at TIMESTAMP`,
		`ALTER TABLE games ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP`,
		`UPDATE games SET game_mode = 'online' WHERE game_mode IS NULL`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_wins INTEGER DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_losses INTEGER DEFAULT 0`,
		fmt.Sprintf(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_unlocked_tier INTEGER DEFAULT %d`, domain.DefaultAITier),
		fmt.Sprintf(`UPDATE users SET ai_unlocked_tier = LEAST(%d, GREATEST(%d, COALESCE(ai_unlocked_tier, %d)))`, domain.MaxAITier(), domain.DefaultAITier, domain.DefaultAITier),
		`UPDATE users SET rank_wins = COALESCE(rank_wins, 0), rank_losses = COALESCE(rank_losses, 0)`,
		fmt.Sprintf(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT %d`, domain.EloDefaultRating),
		fmt.Sprintf(`UPDATE users SET rating = %d WHERE rating IS NULL OR rating = 0`, domain.EloDefaultRating),
		`CREATE INDEX IF NOT EXISTS idx_games_played_at ON games (played_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_games_move_count ON games (move_count DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_friendships_friend_id ON friendships (friend_id)`,
		`CREATE INDEX IF NOT EXISTS idx_villains_target_user_id ON villains (target_user_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_friend_requests_pair ON friend_requests (requester_id, addressee_id)`,
		`CREATE INDEX IF NOT EXISTS idx_friend_requests_addressee_pending ON friend_requests (addressee_id, status, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_friend_requests_requester_pending ON friend_requests (requester_id, status, created_at DESC)`,
	}

	for _, query := range queries {
		if _, err := db.Exec(ctx, query); err != nil {
			return err
		}
	}
	return nil
}
