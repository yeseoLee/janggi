package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestClampSkillLevel(t *testing.T) {
	if got := clampSkillLevel(nil, 0); got != 0 {
		t.Fatalf("expected fallback 0, got %d", got)
	}
	if got := clampSkillLevel(-50, 0); got != -20 {
		t.Fatalf("expected -20, got %d", got)
	}
	if got := clampSkillLevel(25, 0); got != 20 {
		t.Fatalf("expected 20, got %d", got)
	}
}

func TestClampUCIElo(t *testing.T) {
	if got := clampUCIElo(nil, 1500); got != 1500 {
		t.Fatalf("expected fallback 1500, got %d", got)
	}
	if got := clampUCIElo(500, 1500); got != 1000 {
		t.Fatalf("expected 1000, got %d", got)
	}
	if got := clampUCIElo(4000, 1500); got != 3200 {
		t.Fatalf("expected 3200, got %d", got)
	}
}

func TestEngineGetBestMove(t *testing.T) {
	tmpDir := t.TempDir()
	scriptPath := filepath.Join(tmpDir, "fake-engine.sh")
	script := `#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    uci)
      echo "uciok"
      ;;
    isready)
      echo "readyok"
      ;;
    go*)
      echo "bestmove a10a9 ponder a1a2"
      ;;
  esac
done
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write script: %v", err)
	}

	engine := newFairyStockfishEngine(engineConfig{
		StockfishPath:     scriptPath,
		Variant:           "janggi",
		DefaultMoveTimeMS: 700,
		DefaultSkillLevel: 0,
		DefaultUCIElo:     1500,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := engine.GetBestMove(ctx, moveRequest{
		FEN:        "rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1",
		MoveTime:   500,
		Depth:      4,
		UCIElo:     1500,
		SkillLevel: 0,
	})
	if err != nil {
		t.Fatalf("GetBestMove returned error: %v", err)
	}
	if result.BestMove != "a10a9" {
		t.Fatalf("expected bestmove a10a9, got %s", result.BestMove)
	}
	if result.Ponder != "a1a2" {
		t.Fatalf("expected ponder a1a2, got %v", result.Ponder)
	}
}
