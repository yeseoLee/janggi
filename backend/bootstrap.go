package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func newServerState() *serverState {
	return &serverState{
		activeSessions:         make(map[string]*sessionRecord),
		activeGames:            make(map[string]*gameState),
		pendingFriendlyInvites: make(map[string]*pendingFriendlyInvite),
		pendingFriendlyMatches: make(map[string]*pendingFriendlyMatch),
		matchQueue:             []*queueEntry{},
	}
}

func connectDatabaseWithRetry(ctx context.Context, cfg *config) (*pgxpool.Pool, error) {
	dbConfig, err := pgxpool.ParseConfig("")
	if err != nil {
		return nil, err
	}
	dbConfig.ConnConfig.Host = cfg.DBHost
	dbConfig.ConnConfig.User = cfg.DBUser
	dbConfig.ConnConfig.Password = cfg.DBPassword
	dbConfig.ConnConfig.Database = cfg.DBName
	dbConfig.ConnConfig.Port = uint16(clampToPort(cfg.DBPort))

	var lastErr error
	for attempt := 1; attempt <= 30; attempt++ {
		dbPool, err := pgxpool.NewWithConfig(ctx, dbConfig)
		if err == nil {
			if pingErr := dbPool.Ping(ctx); pingErr == nil {
				return dbPool, nil
			} else {
				lastErr = pingErr
			}
			dbPool.Close()
		} else {
			lastErr = err
		}

		if attempt == 30 {
			break
		}
		log.Printf("database not ready (attempt %d/30): %v", attempt, lastErr)
		time.Sleep(2 * time.Second)
	}

	return nil, fmt.Errorf("database connection failed after retries: %w", lastErr)
}

func loadConfig() *config {
	return &config{
		Port:          getenvDefault("PORT", "3000"),
		DBUser:        getenvDefault("DB_USER", "janggi_user"),
		DBHost:        getenvDefault("DB_HOST", "localhost"),
		DBName:        getenvDefault("DB_NAME", "janggi_db"),
		DBPassword:    getenvDefault("DB_PASSWORD", "janggi_password"),
		DBPort:        getenvDefault("DB_PORT", "5432"),
		JWTSecret:     getenvDefault("JWT_SECRET", "secret_key"),
		AIServiceURL:  getenvDefault("AI_SERVICE_URL", "http://localhost:4000"),
		AIMoveTimeMS:  clampMoveTime(getenvDefault("AI_MOVE_TIME_MS", "700"), 700),
		AISearchDepth: clampDepth(getenvDefault("AI_SEARCH_DEPTH", "8"), 8),
	}
}

func getenvDefault(key, fallback string) string {
	value := stringsTrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func clampToPort(value string) int {
	parsed, ok := toInt(value)
	if !ok || parsed <= 0 || parsed > 65535 {
		return 5432
	}
	return parsed
}
