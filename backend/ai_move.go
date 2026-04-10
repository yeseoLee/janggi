package main

import (
	"errors"
	"regexp"
	"strings"
)

const (
	boardRows = 10
	boardCols = 9
)

var (
	validTeams      = map[string]struct{}{teamCho: {}, teamHan: {}}
	validPieceTypes = map[string]struct{}{"cha": {}, "ma": {}, "sang": {}, "sa": {}, "wang": {}, "po": {}, "jol": {}}
	pieceTypeToFEN  = map[string]string{
		"cha":  "r",
		"ma":   "n",
		"sang": "b",
		"sa":   "a",
		"wang": "k",
		"po":   "c",
		"jol":  "p",
	}
	files           = "abcdefghi"
	engineMoveRegex = regexp.MustCompile(`^([a-i])(10|[1-9])([a-i])(10|[1-9])$`)
)

type piece struct {
	Team string `json:"team"`
	Type string `json:"type"`
}

func isValidPiece(value any) bool {
	p, ok := value.(map[string]any)
	if !ok {
		return false
	}

	team, ok := p["team"].(string)
	if !ok {
		return false
	}
	pieceType, ok := p["type"].(string)
	if !ok {
		return false
	}
	_, teamOK := validTeams[team]
	_, typeOK := validPieceTypes[pieceType]
	return teamOK && typeOK
}

func isValidBoardState(board any) bool {
	rows, ok := board.([]any)
	if !ok || len(rows) != boardRows {
		return false
	}

	for _, rowValue := range rows {
		row, ok := rowValue.([]any)
		if !ok || len(row) != boardCols {
			return false
		}
		for _, pieceValue := range row {
			if pieceValue == nil {
				continue
			}
			if !isValidPiece(pieceValue) {
				return false
			}
		}
	}

	return true
}

func boardToJanggiFEN(board [][]map[string]any, turn string) (string, error) {
	if !isValidTeam(turn) {
		return "", errors.New("invalid turn")
	}
	if len(board) != boardRows {
		return "", errors.New("invalid board shape")
	}

	rows := make([]string, 0, len(board))
	for _, row := range board {
		if len(row) != boardCols {
			return "", errors.New("invalid board shape")
		}

		emptyCount := 0
		var builder strings.Builder
		for _, sq := range row {
			if sq == nil {
				emptyCount++
				continue
			}

			if emptyCount > 0 {
				builder.WriteString(itoa(emptyCount))
				emptyCount = 0
			}

			baseChar, ok := pieceTypeToFEN[toString(sq["type"])]
			if !ok {
				return "", errors.New("unsupported piece type")
			}
			if toString(sq["team"]) == teamCho {
				builder.WriteString(strings.ToUpper(baseChar))
			} else {
				builder.WriteString(baseChar)
			}
		}

		if emptyCount > 0 {
			builder.WriteString(itoa(emptyCount))
		}
		rows = append(rows, builder.String())
	}

	activeColor := "w"
	if turn == teamHan {
		activeColor = "b"
	}
	return strings.Join(rows, "/") + " " + activeColor + " - - 0 1", nil
}

func parseEngineMove(bestMove string) *movePayload {
	move := strings.TrimSpace(bestMove)
	if move == "" || move == "(none)" || move == "none" || move == "0000" {
		return nil
	}

	match := engineMoveRegex.FindStringSubmatch(strings.ToLower(move))
	if len(match) != 5 {
		return nil
	}

	fromFile := strings.IndexRune(files, rune(match[1][0]))
	fromRank, okFrom := toInt(match[2])
	toFile := strings.IndexRune(files, rune(match[3][0]))
	toRank, okTo := toInt(match[4])
	if fromFile < 0 || toFile < 0 || !okFrom || !okTo {
		return nil
	}
	if fromRank < 1 || fromRank > boardRows || toRank < 1 || toRank > boardRows {
		return nil
	}

	return &movePayload{
		From: position{R: boardRows - fromRank, C: fromFile},
		To:   position{R: boardRows - toRank, C: toFile},
	}
}

func clampMoveTime(value any, fallback int) int {
	parsed, ok := toInt(value)
	if !ok {
		parsed = fallback
	}
	if parsed < 100 {
		return 100
	}
	if parsed > 5000 {
		return 5000
	}
	return parsed
}

func clampDepth(value any, fallback int) int {
	parsed, ok := toInt(value)
	if !ok {
		parsed = fallback
	}
	if parsed < 1 {
		return 1
	}
	if parsed > 30 {
		return 30
	}
	return parsed
}
