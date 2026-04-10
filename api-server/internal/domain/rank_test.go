package domain

import "testing"

func TestParseRank(t *testing.T) {
	tests := map[string]*ParsedRank{
		"18급": {Type: "gup", Value: 18},
		"1급":  {Type: "gup", Value: 1},
		"1단":  {Type: "dan", Value: 1},
		"9단":  {Type: "dan", Value: 9},
	}
	for input, want := range tests {
		got := ParseRank(input)
		if got == nil || *got != *want {
			t.Fatalf("parseRank(%q) = %#v, want %#v", input, got, want)
		}
	}
	if got := ParseRank("invalid"); got != nil {
		t.Fatalf("expected nil, got %#v", got)
	}
}

func TestRankThresholds(t *testing.T) {
	expectations := map[string]int{
		"18급": 3,
		"10급": 3,
		"9급":  5,
		"1급":  5,
		"1단":  7,
		"9단":  7,
	}
	for rank, want := range expectations {
		if got := GetRankThreshold(rank); got != want {
			t.Fatalf("GetRankThreshold(%q) = %d, want %d", rank, got, want)
		}
	}
}

func TestResolveRankAfterResult(t *testing.T) {
	if next := ResolveRankAfterResult("18급", 2, 0, "win"); next.Rank != "17급" || next.RankWins != 0 || next.RankLosses != 0 {
		t.Fatalf("unexpected state: %#v", next)
	}
	if next := ResolveRankAfterResult("18급", 0, 2, "loss"); next.Rank != "18급" || next.RankWins != 0 || next.RankLosses != 3 {
		t.Fatalf("unexpected state: %#v", next)
	}
	if next := ResolveRankAfterResult("9급", 4, 0, "win"); next.Rank != "8급" || next.RankWins != 0 || next.RankLosses != 0 {
		t.Fatalf("unexpected state: %#v", next)
	}
	if next := ResolveRankAfterResult("1단", 0, 6, "loss"); next.Rank != "1급" || next.RankWins != 0 || next.RankLosses != 0 {
		t.Fatalf("unexpected state: %#v", next)
	}
	if next := ResolveRankAfterResult("9단", 7, 2, "win"); next.Rank != "9단" || next.RankWins != 7 || next.RankLosses != 2 {
		t.Fatalf("unexpected state: %#v", next)
	}
	if next := ResolveRankAfterResult("broken-rank", 2, 0, "win"); next.Rank != "17급" || next.RankWins != 0 || next.RankLosses != 0 {
		t.Fatalf("unexpected state: %#v", next)
	}
}
