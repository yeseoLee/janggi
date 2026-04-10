package main

const (
	gupSuffix = "\uAE09"
	danSuffix = "\uB2E8"

	defaultAITier = 0
)

type aiLevel struct {
	Tier             int    `json:"tier"`
	Label            string `json:"label"`
	SkillLevel       int    `json:"skillLevel"`
	UseLimitStrength bool   `json:"useLimitStrength"`
	UCIElo           *int   `json:"uciElo"`
	MoveTimeMS       int    `json:"moveTimeMs"`
	Depth            int    `json:"depth"`
}

var aiLevels = func() []aiLevel {
	type gupLevel struct {
		Number     int
		SkillLevel int
		MoveTimeMS int
		Depth      int
	}
	type danLevel struct {
		Number     int
		UCIElo     int
		MoveTimeMS int
		Depth      int
	}

	gupLevels := []gupLevel{
		{18, -20, 60, 2},
		{17, -19, 80, 2},
		{16, -18, 100, 3},
		{15, -17, 120, 3},
		{14, -16, 150, 3},
		{13, -15, 180, 3},
		{12, -13, 220, 4},
		{11, -12, 260, 4},
		{10, -11, 300, 4},
		{9, -9, 360, 5},
		{8, -8, 430, 5},
		{7, -7, 520, 5},
		{6, -5, 620, 6},
		{5, -4, 750, 6},
		{4, -2, 900, 7},
		{3, 0, 1050, 7},
		{2, 2, 1250, 8},
		{1, 4, 1500, 8},
	}
	danLevels := []danLevel{
		{1, 1500, 1800, 9},
		{2, 1650, 2100, 10},
		{3, 1800, 2400, 10},
		{4, 1950, 2800, 11},
		{5, 2100, 3200, 12},
		{6, 2250, 3600, 13},
		{7, 2400, 4000, 14},
		{8, 2550, 4500, 15},
		{9, 2700, 5000, 16},
	}

	levels := make([]aiLevel, 0, len(gupLevels)+len(danLevels))
	for idx, level := range gupLevels {
		levels = append(levels, aiLevel{
			Tier:             idx,
			Label:            itoa(level.Number) + gupSuffix,
			SkillLevel:       level.SkillLevel,
			UseLimitStrength: false,
			UCIElo:           nil,
			MoveTimeMS:       level.MoveTimeMS,
			Depth:            level.Depth,
		})
	}
	for idx, level := range danLevels {
		uciElo := level.UCIElo
		levels = append(levels, aiLevel{
			Tier:             len(gupLevels) + idx,
			Label:            itoa(level.Number) + danSuffix,
			SkillLevel:       20,
			UseLimitStrength: true,
			UCIElo:           &uciElo,
			MoveTimeMS:       level.MoveTimeMS,
			Depth:            level.Depth,
		})
	}
	return levels
}()

var maxAITier = len(aiLevels) - 1

type aiUnlockState struct {
	PreviousUnlockedTier int  `json:"previousUnlockedTier"`
	UnlockedTier         int  `json:"unlockedTier"`
	Unlocked             bool `json:"unlocked"`
	JustUnlockedTier     *int `json:"justUnlockedTier"`
}

func clampAITier(value any, fallback int) int {
	parsed, ok := toInt(value)
	if !ok {
		parsed = fallback
	}
	if parsed < defaultAITier {
		return defaultAITier
	}
	if parsed > maxAITier {
		return maxAITier
	}
	return parsed
}

func getAILevel(tier any) aiLevel {
	return aiLevels[clampAITier(tier, defaultAITier)]
}

func resolveAIUnlockAfterWin(unlockedTier, wonTier any) aiUnlockState {
	previousUnlockedTier := clampAITier(unlockedTier, defaultAITier)
	selectedTier := clampAITier(wonTier, defaultAITier)

	if selectedTier != previousUnlockedTier || previousUnlockedTier >= maxAITier {
		return aiUnlockState{
			PreviousUnlockedTier: previousUnlockedTier,
			UnlockedTier:         previousUnlockedTier,
			Unlocked:             false,
			JustUnlockedTier:     nil,
		}
	}

	nextUnlockedTier := previousUnlockedTier + 1
	return aiUnlockState{
		PreviousUnlockedTier: previousUnlockedTier,
		UnlockedTier:         nextUnlockedTier,
		Unlocked:             true,
		JustUnlockedTier:     &nextUnlockedTier,
	}
}
