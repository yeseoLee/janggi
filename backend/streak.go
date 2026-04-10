package main

func calculateMaxWinStreak(gameRows []map[string]any, userID any) int {
	targetID, ok := toInt(userID)
	if !ok || len(gameRows) == 0 {
		return 0
	}

	currentStreak := 0
	maxStreak := 0
	for _, row := range gameRows {
		winnerID, _ := toInt(row["winner_id"])
		loserID, _ := toInt(row["loser_id"])

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
