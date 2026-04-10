package main

import (
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	socketio "github.com/zishang520/socket.io/servers/socket/v3"
)

func extractBearerToken(header string) string {
	if !strings.HasPrefix(header, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}

func buildSessionRecord(sessionID string) *sessionRecord {
	return &sessionRecord{
		SessionID: sessionID,
		Sockets:   make(map[string]*socketio.Socket),
	}
}

func signAuthToken(secret string, now time.Time, userID int, username, sessionID string) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, authClaims{
		ID:       userID,
		Username: username,
		SID:      sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}).SignedString([]byte(secret))
}
