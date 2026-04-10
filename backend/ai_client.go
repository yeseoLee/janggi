package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

func calculateAIMoveTimeout(moveTimeMS int) time.Duration {
	return time.Duration(maxInt(15000, moveTimeMS*8)) * time.Millisecond
}

func buildAIMovePayload(fen string, level aiLevel) map[string]any {
	return map[string]any{
		"fen":              fen,
		"movetime":         level.MoveTimeMS,
		"depth":            level.Depth,
		"skillLevel":       level.SkillLevel,
		"useLimitStrength": level.UseLimitStrength,
		"uciElo":           level.UCIElo,
	}
}

func requestAIResult(ctx context.Context, client httpDoer, serviceURL, fen string, level aiLevel) (map[string]any, error) {
	encoded, err := json.Marshal(buildAIMovePayload(fen, level))
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
