package domain

import "strings"

func ParseRank(rank string) *ParsedRank {
	if strings.HasSuffix(rank, GupSuffix) {
		value, ok := ToInt(strings.TrimSuffix(rank, GupSuffix))
		if ok && value >= 1 && value <= 18 {
			return &ParsedRank{Type: "gup", Value: value}
		}
	}
	if strings.HasSuffix(rank, DanSuffix) {
		value, ok := ToInt(strings.TrimSuffix(rank, DanSuffix))
		if ok && value >= 1 && value <= 9 {
			return &ParsedRank{Type: "dan", Value: value}
		}
	}
	return nil
}

func RankToTier(rank string) int {
	parsed := ParseRank(rank)
	if parsed == nil {
		return 0
	}
	if parsed.Type == "gup" {
		return 18 - parsed.Value
	}
	return 17 + parsed.Value
}

func TierToRank(tier int) string {
	if tier < 0 {
		tier = 0
	}
	if tier > 26 {
		tier = 26
	}
	if tier <= 17 {
		return Itoa(18-tier) + GupSuffix
	}
	return Itoa(tier-17) + DanSuffix
}

func GetRankThreshold(rank string) int {
	parsed := ParseRank(rank)
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

func CanPromote(rank string) bool {
	return RankToTier(rank) < 26
}

func CanDemote(rank string) bool {
	return RankToTier(rank) > 0
}

func PromoteRank(rank string) string {
	return TierToRank(RankToTier(rank) + 1)
}

func DemoteRank(rank string) string {
	return TierToRank(RankToTier(rank) - 1)
}

func NormalizeCounter(value any) int {
	parsed, ok := ToInt(value)
	if !ok || parsed < 0 {
		return 0
	}
	return parsed
}

func ResolveRankAfterResult(rank string, rankWins, rankLosses any, result string) RankState {
	nextRank := rank
	if ParseRank(nextRank) == nil {
		nextRank = "18" + GupSuffix
	}

	wins := NormalizeCounter(rankWins)
	losses := NormalizeCounter(rankLosses)

	if result == "win" {
		wins++
	}
	if result == "loss" {
		losses++
	}

	threshold := GetRankThreshold(nextRank)
	if wins >= threshold && CanPromote(nextRank) {
		nextRank = PromoteRank(nextRank)
		wins = 0
		losses = 0
	} else if losses >= threshold && CanDemote(nextRank) {
		nextRank = DemoteRank(nextRank)
		wins = 0
		losses = 0
	} else {
		if !CanPromote(nextRank) && wins > threshold {
			wins = threshold
		}
		if !CanDemote(nextRank) && losses > threshold {
			losses = threshold
		}
	}

	return RankState{
		Rank:       nextRank,
		RankWins:   wins,
		RankLosses: losses,
	}
}
