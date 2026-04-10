package domain

var aiLevels = func() []AILevel {
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

	levels := make([]AILevel, 0, len(gupLevels)+len(danLevels))
	for idx, level := range gupLevels {
		levels = append(levels, AILevel{
			Tier:             idx,
			Label:            Itoa(level.Number) + GupSuffix,
			SkillLevel:       level.SkillLevel,
			UseLimitStrength: false,
			UCIElo:           nil,
			MoveTimeMS:       level.MoveTimeMS,
			Depth:            level.Depth,
		})
	}
	for idx, level := range danLevels {
		uciElo := level.UCIElo
		levels = append(levels, AILevel{
			Tier:             len(gupLevels) + idx,
			Label:            Itoa(level.Number) + DanSuffix,
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

func MaxAITier() int {
	return maxAITier
}

func ClampAITier(value any, fallback int) int {
	parsed, ok := ToInt(value)
	if !ok {
		parsed = fallback
	}
	if parsed < DefaultAITier {
		return DefaultAITier
	}
	if parsed > maxAITier {
		return maxAITier
	}
	return parsed
}

func GetAILevel(tier any) AILevel {
	return aiLevels[ClampAITier(tier, DefaultAITier)]
}

func ResolveAIUnlockAfterWin(unlockedTier, wonTier any) AIUnlockState {
	previousUnlockedTier := ClampAITier(unlockedTier, DefaultAITier)
	selectedTier := ClampAITier(wonTier, DefaultAITier)

	if selectedTier != previousUnlockedTier || previousUnlockedTier >= maxAITier {
		return AIUnlockState{
			PreviousUnlockedTier: previousUnlockedTier,
			UnlockedTier:         previousUnlockedTier,
			Unlocked:             false,
			JustUnlockedTier:     nil,
		}
	}

	nextUnlockedTier := previousUnlockedTier + 1
	return AIUnlockState{
		PreviousUnlockedTier: previousUnlockedTier,
		UnlockedTier:         nextUnlockedTier,
		Unlocked:             true,
		JustUnlockedTier:     &nextUnlockedTier,
	}
}
