package domain

import (
	"math"
	"strings"
	"time"
)

func CalculateElo(winnerRating, loserRating int) (int, int, int) {
	rW := winnerRating
	if rW <= 0 {
		rW = EloDefaultRating
	}
	rL := loserRating
	if rL <= 0 {
		rL = EloDefaultRating
	}

	expectedWinner := 1 / (1 + math.Pow(10, float64(rL-rW)/400))
	expectedLoser := 1 / (1 + math.Pow(10, float64(rW-rL)/400))
	ratingChange := int(math.Round(float64(EloKFactor) * (1 - expectedWinner)))

	newWinnerRating := MaxInt(EloMinRating, int(math.Round(float64(rW)+float64(EloKFactor)*(1-expectedWinner))))
	newLoserRating := MaxInt(EloMinRating, int(math.Round(float64(rL)+float64(EloKFactor)*(0-expectedLoser))))
	return newWinnerRating, newLoserRating, ratingChange
}

func GetRankScore(rank string) int {
	if strings.Contains(rank, GupSuffix) {
		value, ok := ToInt(strings.TrimSuffix(rank, GupSuffix))
		if ok {
			return 20 - value
		}
	}
	if strings.Contains(rank, DanSuffix) {
		value, ok := ToInt(strings.TrimSuffix(rank, DanSuffix))
		if ok {
			return 20 + value
		}
	}
	return 0
}

func GetWinRate(user map[string]any) float64 {
	if user == nil {
		return 0
	}
	wins, _ := ToInt(user["wins"])
	losses, _ := ToInt(user["losses"])
	total := wins + losses
	if total == 0 {
		return 0
	}
	return float64(wins) / float64(total)
}

func IsValidTeam(team string) bool {
	return team == TeamCho || team == TeamHan
}

func OpponentTeam(team string) string {
	if team == TeamCho {
		return TeamHan
	}
	return TeamCho
}

func IsValidPosition(pos Position) bool {
	return pos.R >= 0 && pos.R < BoardRows && pos.C >= 0 && pos.C < BoardCols
}

func NormalizeResultType(resultType string) string {
	value := strings.ToLower(strings.TrimSpace(resultType))
	switch value {
	case "resign", "time", "piece", "checkmate", "score":
		return value
	default:
		return "unknown"
	}
}

func NormalizeMoveLog(moveLog []MoveLogEvent) []MoveLogEvent {
	return NormalizeMoveLogWithClock(moveLog, time.Now)
}

func NormalizeMoveLogWithClock(moveLog []MoveLogEvent, now func() time.Time) []MoveLogEvent {
	if len(moveLog) == 0 {
		return []MoveLogEvent{}
	}
	if now == nil {
		now = time.Now
	}

	normalized := make([]MoveLogEvent, 0, len(moveLog))
	for _, event := range moveLog {
		if !IsValidTeam(event.Turn) {
			continue
		}

		at := event.At
		if strings.TrimSpace(at) == "" {
			at = now().UTC().Format(time.RFC3339Nano)
		}

		switch event.Type {
		case "move":
			if event.From == nil || event.To == nil || !IsValidPosition(*event.From) || !IsValidPosition(*event.To) {
				continue
			}
			from := *event.From
			to := *event.To
			normalized = append(normalized, MoveLogEvent{
				Type: "move",
				Turn: event.Turn,
				From: &from,
				To:   &to,
				At:   at,
			})
		case "pass":
			normalized = append(normalized, MoveLogEvent{
				Type: "pass",
				Turn: event.Turn,
				At:   at,
			})
		}
	}

	return normalized
}

func NormalizeTimestamp(timestamp string, fallback time.Time) time.Time {
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

func CloneUserInfo(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func MaxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
