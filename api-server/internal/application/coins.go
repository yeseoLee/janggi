package application

import (
	"context"
	"errors"
)

const (
	aiMatchEntryCost   = 1
	manualRechargeCoin = 10
)

var (
	errNotEnoughCoins = errors.New("Not enough coins")
	errUserNotFound   = errors.New("User not found")
)

func spendCoinsForAIMatch(ctx context.Context, db dbQuerier, userID int, cost int) (map[string]any, error) {
	if cost <= 0 {
		cost = aiMatchEntryCost
	}

	rows, err := db.Query(ctx, `UPDATE users
     SET coins = coins - $2
     WHERE id = $1
       AND coins >= $2
     RETURNING id, username, nickname, rank, wins, losses, coins, rank_wins, rank_losses`, userID, cost)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, errNotEnoughCoins
	}

	return map[string]any{
		"spent": cost,
		"user":  items[0],
	}, nil
}

func rechargeCoins(ctx context.Context, db dbQuerier, userID int, amount int) (map[string]any, error) {
	if amount <= 0 {
		amount = manualRechargeCoin
	}

	rows, err := db.Query(ctx, `UPDATE users
     SET coins = coins + $2
     WHERE id = $1
     RETURNING id, username, nickname, rank, wins, losses, coins, rank_wins, rank_losses`, userID, amount)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, errUserNotFound
	}

	return map[string]any{
		"added": amount,
		"user":  items[0],
	}, nil
}
