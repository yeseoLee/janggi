package application

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/yeseolee/janggi/api-server/internal/dataaccess"
	"github.com/yeseolee/janggi/api-server/internal/domain"
)

func itoa(value int) string {
	return domain.Itoa(value)
}

func toString(value any) string {
	return domain.ToString(value)
}

func toInt(value any) (int, bool) {
	return domain.ToInt(value)
}

func clampMoveTime(value any, fallback int) int {
	return domain.ClampMoveTime(value, fallback)
}

func clampDepth(value any, fallback int) int {
	return domain.ClampDepth(value, fallback)
}

func clampAITier(value any, fallback int) int {
	return domain.ClampAITier(value, fallback)
}

func getAILevel(tier any) domain.AILevel {
	return domain.GetAILevel(tier)
}

func resolveAIUnlockAfterWin(unlockedTier, wonTier any) domain.AIUnlockState {
	return domain.ResolveAIUnlockAfterWin(unlockedTier, wonTier)
}

func boardToJanggiFEN(board [][]map[string]any, turn string) (string, error) {
	return domain.BoardToJanggiFEN(board, turn)
}

func parseEngineMove(bestMove string) *domain.MovePayload {
	return domain.ParseEngineMove(bestMove)
}

func isValidBoardState(board any) bool {
	return domain.IsValidBoardState(board)
}

func calculateElo(winnerRating, loserRating int) (int, int, int) {
	return domain.CalculateElo(winnerRating, loserRating)
}

func getRankScore(rank string) int {
	return domain.GetRankScore(rank)
}

func getWinRate(user map[string]any) float64 {
	return domain.GetWinRate(user)
}

func isValidTeam(team string) bool {
	return domain.IsValidTeam(team)
}

func getOpponentTeam(team string) string {
	return domain.OpponentTeam(team)
}

func isValidPosition(pos position) bool {
	return domain.IsValidPosition(pos)
}

func normalizeResultType(resultType string) string {
	return domain.NormalizeResultType(resultType)
}

func normalizeMoveLog(moveLog []moveLogEvent) []moveLogEvent {
	return domain.NormalizeMoveLog(moveLog)
}

func normalizeMoveLogWithClock(moveLog []moveLogEvent, now func() time.Time) []moveLogEvent {
	return domain.NormalizeMoveLogWithClock(moveLog, now)
}

func normalizeTimestamp(timestamp string, fallback time.Time) time.Time {
	return domain.NormalizeTimestamp(timestamp, fallback)
}

func cloneUserInfo(input map[string]any) map[string]any {
	return domain.CloneUserInfo(input)
}

func maxInt(left, right int) int {
	return domain.MaxInt(left, right)
}

func calculateMaxWinStreak(rows []map[string]any, userID any) int {
	return domain.CalculateMaxWinStreak(rows, userID)
}

func normalizeCounter(value any) int {
	return domain.NormalizeCounter(value)
}

func resolveRankAfterResult(rank string, rankWins, rankLosses any, result string) domain.RankState {
	return domain.ResolveRankAfterResult(rank, rankWins, rankLosses, result)
}

func calculateAIMoveTimeout(moveTimeMS int) time.Duration {
	return time.Duration(domain.MaxInt(15000, moveTimeMS*8)) * time.Millisecond
}

func requestAIResult(ctx context.Context, client httpDoer, serviceURL, fen string, level domain.AILevel) (map[string]any, error) {
	encoded, err := json.Marshal(map[string]any{
		"fen":              fen,
		"movetime":         level.MoveTimeMS,
		"depth":            level.Depth,
		"skillLevel":       level.SkillLevel,
		"useLimitStrength": level.UseLimitStrength,
		"uciElo":           level.UCIElo,
	})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL+"/move", bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("ai service returned status %d", response.StatusCode)
	}
	var result map[string]any
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result, nil
}

func queryMaps(ctx context.Context, db database, sql string, args ...any) ([]map[string]any, error) {
	return dataaccess.QueryMaps(ctx, db, sql, args...)
}

func queryOneMap(ctx context.Context, db database, sql string, args ...any) (map[string]any, error) {
	return dataaccess.QueryOneMap(ctx, db, sql, args...)
}

func isUniqueViolation(err error) bool {
	return dataaccess.IsUniqueViolation(err)
}

func rowsToMaps(rows pgx.Rows) ([]map[string]any, error) {
	return dataaccess.RowsToMaps(rows)
}

func (app *app) buildBoard(raw any) ([][]map[string]any, bool) {
	if !domain.IsValidBoardState(raw) {
		return nil, false
	}

	rawRows := raw.([]any)
	board := make([][]map[string]any, 0, len(rawRows))
	for _, rowValue := range rawRows {
		rowValues := rowValue.([]any)
		row := make([]map[string]any, 0, len(rowValues))
		for _, pieceValue := range rowValues {
			if pieceValue == nil {
				row = append(row, nil)
				continue
			}
			pieceMap, _ := pieceValue.(map[string]any)
			row = append(row, map[string]any{
				"team": domain.ToString(pieceMap["team"]),
				"type": domain.ToString(pieceMap["type"]),
			})
		}
		board = append(board, row)
	}
	return board, true
}

func stringsTrimSpace(value string) string {
	return strings.TrimSpace(value)
}

func stringsTrimSuffix(value, suffix string) string {
	return strings.TrimSuffix(value, suffix)
}

func stringsContains(value, suffix string) bool {
	return strings.Contains(value, suffix)
}

func stringsToLower(value string) string {
	return strings.ToLower(value)
}
