package main

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func calculateElo(winnerRating, loserRating int) (int, int, int) {
	rW := winnerRating
	if rW <= 0 {
		rW = eloDefaultRating
	}
	rL := loserRating
	if rL <= 0 {
		rL = eloDefaultRating
	}

	expectedWinner := 1 / (1 + math.Pow(10, float64(rL-rW)/400))
	expectedLoser := 1 / (1 + math.Pow(10, float64(rW-rL)/400))
	ratingChange := int(math.Round(float64(eloKFactor) * (1 - expectedWinner)))

	newWinnerRating := maxInt(eloMinRating, int(math.Round(float64(rW)+float64(eloKFactor)*(1-expectedWinner))))
	newLoserRating := maxInt(eloMinRating, int(math.Round(float64(rL)+float64(eloKFactor)*(0-expectedLoser))))
	return newWinnerRating, newLoserRating, ratingChange
}

func getRankScore(rank string) int {
	if stringsContains(rank, gupSuffix) {
		value, ok := toInt(stringsTrimSuffix(rank, gupSuffix))
		if ok {
			return 20 - value
		}
	}
	if stringsContains(rank, danSuffix) {
		value, ok := toInt(stringsTrimSuffix(rank, danSuffix))
		if ok {
			return 20 + value
		}
	}
	return 0
}

func getWinRate(user map[string]any) float64 {
	if user == nil {
		return 0
	}
	wins, _ := toInt(user["wins"])
	losses, _ := toInt(user["losses"])
	total := wins + losses
	if total == 0 {
		return 0
	}
	return float64(wins) / float64(total)
}

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
	return calculateMaxWinStreak(items, userID), nil
}

func isValidTeam(team string) bool {
	return team == teamCho || team == teamHan
}

func getOpponentTeam(team string) string {
	if team == teamCho {
		return teamHan
	}
	return teamCho
}

func isValidPosition(pos position) bool {
	return pos.R >= 0 && pos.R < boardRows && pos.C >= 0 && pos.C < boardCols
}

func normalizeResultType(resultType string) string {
	value := stringsToLower(stringsTrimSpace(resultType))
	switch value {
	case "resign", "time", "piece", "checkmate", "score":
		return value
	default:
		return "unknown"
	}
}

func normalizeMoveLog(moveLog []moveLogEvent) []moveLogEvent {
	return normalizeMoveLogWithClock(moveLog, time.Now)
}

func normalizeMoveLogWithClock(moveLog []moveLogEvent, now func() time.Time) []moveLogEvent {
	if len(moveLog) == 0 {
		return []moveLogEvent{}
	}
	if now == nil {
		now = time.Now
	}

	normalized := make([]moveLogEvent, 0, len(moveLog))
	for _, event := range moveLog {
		if !isValidTeam(event.Turn) {
			continue
		}

		at := event.At
		if stringsTrimSpace(at) == "" {
			at = now().UTC().Format(time.RFC3339Nano)
		}

		switch event.Type {
		case "move":
			if event.From == nil || event.To == nil || !isValidPosition(*event.From) || !isValidPosition(*event.To) {
				continue
			}
			from := *event.From
			to := *event.To
			normalized = append(normalized, moveLogEvent{
				Type: "move",
				Turn: event.Turn,
				From: &from,
				To:   &to,
				At:   at,
			})
		case "pass":
			normalized = append(normalized, moveLogEvent{
				Type: "pass",
				Turn: event.Turn,
				At:   at,
			})
		}
	}

	return normalized
}

func normalizeTimestamp(timestamp string, fallback time.Time) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err == nil {
		return parsed
	}
	parsed, err = time.Parse(time.RFC3339, timestamp)
	if err == nil {
		return parsed
	}
	return fallback
}

func cloneUserInfo(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func stringsContains(value, suffix string) bool {
	return strings.Index(value, suffix) >= 0
}

func stringsTrimSuffix(value, suffix string) string {
	return strings.TrimSuffix(value, suffix)
}

func stringsTrimSpace(value string) string {
	return strings.TrimSpace(value)
}

func stringsToLower(value string) string {
	return strings.ToLower(value)
}

func errorsIs(err, target error) bool {
	return errors.Is(err, target)
}
