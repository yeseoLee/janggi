package domain

func CalculateMaxWinStreak(gameRows []map[string]any, userID any) int {
	targetID, ok := ToInt(userID)
	if !ok || len(gameRows) == 0 {
		return 0
	}

	currentStreak := 0
	maxStreak := 0
	for _, row := range gameRows {
		winnerID, _ := ToInt(row["winner_id"])
		loserID, _ := ToInt(row["loser_id"])

		if winnerID == targetID {
			currentStreak++
			if currentStreak > maxStreak {
				maxStreak = currentStreak
			}
			continue
		}
		if loserID == targetID {
			currentStreak = 0
		}
	}

	return maxStreak
}
