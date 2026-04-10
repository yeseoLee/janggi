package application

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/yeseolee/janggi/api-server/internal/domain"
)

func (app *app) fetchUserPublicInfo(ctx context.Context, userID int) (map[string]any, error) {
	if userID <= 0 {
		return nil, nil
	}
	row, err := queryOneMap(ctx, app.db, `SELECT id, username, nickname, rank, wins, losses, rating
         FROM users
         WHERE id = $1`, userID)
	if errorsIs(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return row, err
}

func (app *app) areUsersBlocked(ctx context.Context, userAID, userBID int) (bool, error) {
	if userAID <= 0 || userBID <= 0 {
		return false, nil
	}
	var exists int
	err := app.db.QueryRow(ctx, `SELECT 1
         FROM villains
         WHERE (user_id = $1 AND target_user_id = $2)
            OR (user_id = $2 AND target_user_id = $1)
         LIMIT 1`, userAID, userBID).Scan(&exists)
	if errorsIs(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (app *app) areUsersFriends(ctx context.Context, userAID, userBID int) (bool, error) {
	if userAID <= 0 || userBID <= 0 {
		return false, nil
	}
	var exists int
	err := app.db.QueryRow(ctx, `SELECT 1
         FROM friendships
         WHERE user_id = $1
           AND friend_id = $2
         LIMIT 1`, userAID, userBID).Scan(&exists)
	if errorsIs(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (app *app) fetchMaxWinStreak(ctx context.Context, userID int) (int, error) {
	items, err := queryMaps(ctx, app.db, `SELECT winner_id, loser_id
         FROM games
         WHERE (winner_id = $1 OR loser_id = $1)
           AND COALESCE(game_mode, 'online') = 'online'
         ORDER BY COALESCE(ended_at, played_at, started_at) ASC, id ASC`, userID)
	if err != nil {
		return 0, err
	}
	return domain.CalculateMaxWinStreak(items, userID), nil
}

func errorsIs(err, target error) bool {
	return errors.Is(err, target)
}
