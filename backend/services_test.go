package main

import (
	"testing"
	"time"
)

func TestNormalizeMoveLogWithClock(t *testing.T) {
	t.Parallel()

	fixed := time.Date(2026, 4, 10, 12, 30, 0, 0, time.UTC)
	now := func() time.Time { return fixed }

	normalized := normalizeMoveLogWithClock([]moveLogEvent{
		{
			Type: "move",
			Turn: teamCho,
			From: &position{R: 9, C: 0},
			To:   &position{R: 8, C: 0},
		},
		{
			Type: "pass",
			Turn: teamHan,
			At:   "2026-04-10T12:00:00Z",
		},
		{
			Type: "move",
			Turn: "invalid",
			From: &position{R: 0, C: 0},
			To:   &position{R: 1, C: 0},
		},
	}, now)

	if len(normalized) != 2 {
		t.Fatalf("expected 2 normalized events, got %d", len(normalized))
	}
	if normalized[0].At != fixed.UTC().Format(time.RFC3339Nano) {
		t.Fatalf("expected generated timestamp %q, got %q", fixed.UTC().Format(time.RFC3339Nano), normalized[0].At)
	}
	if normalized[1].At != "2026-04-10T12:00:00Z" {
		t.Fatalf("expected explicit timestamp to be preserved, got %q", normalized[1].At)
	}
}
