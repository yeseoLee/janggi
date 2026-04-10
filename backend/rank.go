package main

import "strings"

type parsedRank struct {
	Type  string
	Value int
}

type rankState struct {
	Rank       string `json:"rank"`
	RankWins   int    `json:"rankWins"`
	RankLosses int    `json:"rankLosses"`
}

func parseRank(rank string) *parsedRank {
	if strings.HasSuffix(rank, gupSuffix) {
		value, ok := toInt(strings.TrimSuffix(rank, gupSuffix))
		if ok && value >= 1 && value <= 18 {
			return &parsedRank{Type: "gup", Value: value}
		}
	}
	if strings.HasSuffix(rank, danSuffix) {
		value, ok := toInt(strings.TrimSuffix(rank, danSuffix))
		if ok && value >= 1 && value <= 9 {
			return &parsedRank{Type: "dan", Value: value}
		}
	}
	return nil
}

func rankToTier(rank string) int {
	parsed := parseRank(rank)
	if parsed == nil {
		return 0
	}
	if parsed.Type == "gup" {
		return 18 - parsed.Value
	}
	return 17 + parsed.Value
}

func tierToRank(tier int) string {
	if tier < 0 {
		tier = 0
	}
	if tier > 26 {
		tier = 26
	}
	if tier <= 17 {
		return itoa(18-tier) + gupSuffix
	}
	return itoa(tier-17) + danSuffix
}

func getRankThreshold(rank string) int {
	parsed := parseRank(rank)
	if parsed == nil {
		return 3
	}
	if parsed.Type == "dan" {
		return 7
	}
	if parsed.Value >= 10 {
		return 3
	}
	return 5
}

func canPromote(rank string) bool {
	return rankToTier(rank) < 26
}

func canDemote(rank string) bool {
	return rankToTier(rank) > 0
}

func promoteRank(rank string) string {
	return tierToRank(rankToTier(rank) + 1)
}

func demoteRank(rank string) string {
	return tierToRank(rankToTier(rank) - 1)
}

func normalizeCounter(value any) int {
	parsed, ok := toInt(value)
	if !ok || parsed < 0 {
		return 0
	}
	return parsed
}

func resolveRankAfterResult(rank string, rankWins, rankLosses any, result string) rankState {
	nextRank := rank
	if parseRank(nextRank) == nil {
		nextRank = "18" + gupSuffix
	}

	wins := normalizeCounter(rankWins)
	losses := normalizeCounter(rankLosses)

	if result == "win" {
		wins++
	}
	if result == "loss" {
		losses++
	}

	threshold := getRankThreshold(nextRank)
	if wins >= threshold && canPromote(nextRank) {
		nextRank = promoteRank(nextRank)
		wins = 0
		losses = 0
	} else if losses >= threshold && canDemote(nextRank) {
		nextRank = demoteRank(nextRank)
		wins = 0
		losses = 0
	} else {
		if !canPromote(nextRank) && wins > threshold {
			wins = threshold
		}
		if !canDemote(nextRank) && losses > threshold {
			losses = threshold
		}
	}

	return rankState{
		Rank:       nextRank,
		RankWins:   wins,
		RankLosses: losses,
	}
}
