package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/yeseolee/janggi/api-server/internal/domain"
)

type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

func CalculateAIMoveTimeout(moveTimeMS int) time.Duration {
	return time.Duration(domain.MaxInt(15000, moveTimeMS*8)) * time.Millisecond
}

func BuildAIMovePayload(fen string, level domain.AILevel) map[string]any {
	return map[string]any{
		"fen":              fen,
		"movetime":         level.MoveTimeMS,
		"depth":            level.Depth,
		"skillLevel":       level.SkillLevel,
		"useLimitStrength": level.UseLimitStrength,
		"uciElo":           level.UCIElo,
	}
}

func RequestAIResult(ctx context.Context, client HTTPDoer, serviceURL, fen string, level domain.AILevel) (map[string]any, error) {
	encoded, err := json.Marshal(BuildAIMovePayload(fen, level))
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
